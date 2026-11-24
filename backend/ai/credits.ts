// Credits for AI on our key (docs/cloud-plan.md, "AI"). Every change happens in
// one transaction that locks the account's row, so replies running in
// parallel can never spend more than the balance or the monthly ceiling:
//   - before each model step, `reserve` moves what the step may cost from the
//     balance to `held` (the step's output limit is sized to what's there);
//   - after it, `settle` charges what it really cost (never more than was
//     held) and gives the rest back, with a line in the ledger.
// Amounts are millicredits (see backend/ai/config.ts).
import { eq, sql } from "drizzle-orm";
import type { CloudDb } from "../db/index";
import { creditAccounts, creditLedger, type CreditReason } from "../db/schema";
import { newId } from "../homes";
import { toMilli, type AiConfig } from "./config";

type Tx = Parameters<Parameters<CloudDb["transaction"]>[0]>[0];
type Account = typeof creditAccounts.$inferSelect;

export const monthOf = (now: Date) => now.toISOString().slice(0, 7);

// The first day of the next month (UTC), when the monthly allowance comes.
export const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export interface CreditStatus {
  // Millicredits that can be spent now: the balance, or less under the ceiling.
  available: number;
  // What limits it: the balance, or the monthly ceiling.
  limitedBy: "balance" | "ceiling";
}

// The account's row, locked until the transaction ends (made the first time).
async function lock(tx: Tx, userId: string): Promise<Account> {
  const locked = () => tx.select().from(creditAccounts).where(eq(creditAccounts.userId, userId)).for("update");
  let [row] = await locked();
  if (!row) {
    await tx.insert(creditAccounts).values({ userId }).onConflictDoNothing();
    [row] = await locked();
  }
  return row!;
}

async function write(tx: Tx, userId: string, set: Partial<Account>) {
  await tx
    .update(creditAccounts)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(creditAccounts.userId, userId));
}

async function log(tx: Tx, userId: string, change: number, balanceAfter: number, reason: CreditReason, detail?: Record<string, unknown>) {
  await tx.insert(creditLedger).values({ id: newId(), userId, change, balanceAfter, reason, detail: detail ?? null });
}

export function createCredits(db: CloudDb, cfg: AiConfig, clock: () => Date = () => new Date()) {
  const spentThisMonth = (a: Account, month: string) => (a.spentMonth === month ? a.spent : 0);
  // What can be spent now, and whether the balance or the ceiling limits it.
  function spendable(a: Account): CreditStatus {
    if (cfg.monthlyCeiling === null) return { available: Math.max(0, a.balance), limitedBy: "balance" };
    const left = Math.max(0, toMilli(cfg.monthlyCeiling) - spentThisMonth(a, monthOf(clock())) - a.held);
    return left < a.balance ? { available: left, limitedBy: "ceiling" } : { available: Math.max(0, a.balance), limitedBy: "balance" };
  }

  // Allowances due: the starter credits once (when the account may have
  // them), and the monthly allowance at the start of each month. The monthly
  // one tops the balance up to the allowance; it doesn't pile up.
  async function allowances(tx: Tx, a: Account, eligible: boolean): Promise<Account> {
    const month = monthOf(clock());
    let account = a;
    if (eligible && !account.starterGranted && cfg.starterCredits > 0) {
      const balance = account.balance + toMilli(cfg.starterCredits);
      await write(tx, account.userId, { balance, starterGranted: true });
      await log(tx, account.userId, toMilli(cfg.starterCredits), balance, "starter");
      account = { ...account, balance, starterGranted: true };
    }
    if (eligible && cfg.monthlyCredits > 0 && account.allowanceMonth !== month) {
      const topUp = Math.max(0, toMilli(cfg.monthlyCredits) - account.balance);
      const balance = account.balance + topUp;
      await write(tx, account.userId, { balance, allowanceMonth: month });
      if (topUp > 0) await log(tx, account.userId, topUp, balance, "monthly", { month });
      account = { ...account, balance, allowanceMonth: month };
    }
    return account;
  }

  return {
    // The account as it is now, after any allowance that's due.
    async status(userId: string, eligible: boolean): Promise<CreditStatus> {
      return db.transaction(async (tx) => spendable(await allowances(tx, await lock(tx, userId), eligible)));
    },

    // Set aside what a step may cost: `decide` gets what can be spent now and
    // says how much to hold (0: not enough, nothing is held).
    async reserve(userId: string, eligible: boolean, decide: (available: number) => number): Promise<CreditStatus & { held: number }> {
      return db.transaction(async (tx) => {
        const a = await allowances(tx, await lock(tx, userId), eligible);
        const { available, limitedBy } = spendable(a);
        const held = Math.min(available, Math.max(0, Math.floor(decide(available))));
        if (held > 0) await write(tx, userId, { balance: a.balance - held, held: a.held + held });
        return { held, available, limitedBy };
      });
    },

    // Charge what a step cost (at most what was held) and give the rest back.
    async settle(userId: string, held: number, cost: number, detail: Record<string, unknown>): Promise<{ charged: number; balance: number }> {
      return db.transaction(async (tx) => {
        const a = await lock(tx, userId);
        const month = monthOf(clock());
        const charged = Math.max(0, Math.min(Math.ceil(cost), held));
        const balance = a.balance + held - charged;
        await write(tx, userId, {
          balance,
          held: Math.max(0, a.held - held),
          spentMonth: month,
          spent: spentThisMonth(a, month) + charged,
        });
        if (charged > 0) await log(tx, userId, -charged, balance, "ai", detail);
        return { charged, balance };
      });
    },

    // Add credits by hand (early supporters, support) or for a purchase.
    async grant(userId: string, credits: number, reason: CreditReason, detail?: Record<string, unknown>): Promise<number> {
      return db.transaction(async (tx) => {
        const a = await lock(tx, userId);
        const balance = a.balance + toMilli(credits);
        await write(tx, userId, { balance });
        await log(tx, userId, toMilli(credits), balance, reason, detail);
        return balance;
      });
    },

    // At start-up: holds belong to replies that were running in this process
    // when it stopped (one server process for now, see docs/cloud-plan.md
    // phase 2), so they go back to their balances.
    async releaseHolds(): Promise<number> {
      const rows = await db
        .update(creditAccounts)
        .set({ balance: sql`${creditAccounts.balance} + ${creditAccounts.held}`, held: 0 })
        .where(sql`${creditAccounts.held} > 0`)
        .returning({ userId: creditAccounts.userId });
      return rows.length;
    },
  };
}

export type Credits = ReturnType<typeof createCredits>;
