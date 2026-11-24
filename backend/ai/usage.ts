// What Odaja's AI was used for and what it cost (docs/cloud-plan.md, "Usage for
// users" and "Usage for us"), read from `ai_usage` (one row per reply) and the
// credit ledger. Amounts leave here as credits (millicredits / 1000, exact)
// and dollars; the routes in backend/app.ts decide who may see what.
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { CloudDb } from "../db/index";
import { aiUsage, creditAccounts, creditLedger, projects, user, type CreditReason } from "../db/schema";
import { MILLI, type AiConfig } from "./config";

const PAGE = 50;
const asCredits = (milli: number | string | null) => Number(milli ?? 0) / MILLI;
const asUsd = (micro: number | string | null) => Number(micro ?? 0) / 1_000_000;

// The name people know a model by; the provider's id for one no longer offered.
const modelName = (cfg: AiConfig, model: string) => cfg.models.find((m) => m.model === model)?.name ?? model;

export interface ReplyLine {
  id: string;
  at: number;
  home: { id: string; name: string } | null;
  model: string;
  steps: number;
  credits: number;
  // The part of `credits` paid with bought ones.
  bought: number;
  outcome: string;
}

export interface LedgerLine {
  id: string;
  at: number;
  reason: CreditReason;
  credits: number;
  bought: number;
  balanceAfter: number;
  note: string | null;
}

export interface Totals {
  replies: number;
  credits: number;
  bought: number;
  // Our real cost (admin only).
  costUsd?: number;
  accounts?: number;
}

const totalsColumns = {
  replies: sql<number>`count(*)::int`,
  charged: sql<string>`coalesce(sum(${aiUsage.charged}), 0)`,
  chargedBought: sql<string>`coalesce(sum(${aiUsage.chargedBought}), 0)`,
  cost: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)`,
  accounts: sql<number>`count(distinct ${aiUsage.userId})::int`,
};

const toTotals = (r: { replies: number; charged: string; chargedBought: string; cost: string; accounts: number }, withCost: boolean): Totals => ({
  replies: r.replies,
  credits: asCredits(r.charged),
  bought: asCredits(r.chargedBought),
  ...(withCost ? { costUsd: asUsd(r.cost), accounts: r.accounts } : {}),
});

// The first moment of this month and of `n - 1` months before it (UTC).
const monthStart = (now: Date, back = 0) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
const dayStart = (now: Date, back = 0) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));

export function createUsage(db: CloudDb, cfg: AiConfig, clock: () => Date = () => new Date()) {
  // An account's replies, newest first (`before`: older than this time, for the next page).
  async function replies(userId: string | null, opts: { before?: number; since?: Date; limit?: number; byCost?: boolean } = {}) {
    const where = and(
      userId ? eq(aiUsage.userId, userId) : undefined,
      opts.before ? lt(aiUsage.createdAt, new Date(opts.before)) : undefined,
      opts.since ? gte(aiUsage.createdAt, opts.since) : undefined,
    );
    const rows = await db
      .select({
        id: aiUsage.id,
        userId: aiUsage.userId,
        at: aiUsage.createdAt,
        projectId: aiUsage.projectId,
        homeName: projects.name,
        model: aiUsage.model,
        steps: aiUsage.steps,
        charged: aiUsage.charged,
        chargedBought: aiUsage.chargedBought,
        outcome: aiUsage.outcome,
        cost: aiUsage.costMicroUsd,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        cacheReadTokens: aiUsage.cacheReadTokens,
        cacheWriteTokens: aiUsage.cacheWriteTokens,
        email: user.email,
      })
      .from(aiUsage)
      .leftJoin(projects, eq(projects.id, aiUsage.projectId))
      .innerJoin(user, eq(user.id, aiUsage.userId))
      .where(where)
      .orderBy(opts.byCost ? desc(aiUsage.costMicroUsd) : desc(aiUsage.createdAt))
      .limit(opts.limit ?? PAGE);
    return rows.map((r) => ({
      line: {
        id: r.id,
        at: r.at.getTime(),
        home: r.projectId && r.homeName !== null ? { id: r.projectId, name: r.homeName } : null,
        model: modelName(cfg, r.model),
        steps: r.steps,
        credits: asCredits(r.charged),
        bought: asCredits(r.chargedBought),
        outcome: r.outcome,
      } satisfies ReplyLine,
      // For the admin view only.
      admin: {
        userId: r.userId,
        email: r.email,
        costUsd: asUsd(r.cost),
        tokens: { input: r.inputTokens, output: r.outputTokens, cacheRead: r.cacheReadTokens, cacheWrite: r.cacheWriteTokens },
      },
    }));
  }

  // What was added to an account (or taken back), newest first: everything but AI charges.
  async function added(userId: string, before?: number): Promise<LedgerLine[]> {
    const rows = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), ne(creditLedger.reason, "ai"), before ? lt(creditLedger.createdAt, new Date(before)) : undefined))
      .orderBy(desc(creditLedger.createdAt))
      .limit(PAGE);
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt.getTime(),
      reason: r.reason,
      credits: asCredits(r.change),
      bought: asCredits(r.bought),
      balanceAfter: asCredits(r.balanceAfter),
      note: typeof r.detail?.note === "string" ? r.detail.note : null,
    }));
  }

  async function totals(userId: string | null, since: Date, withCost: boolean): Promise<Totals> {
    const [row] = await db
      .select(totalsColumns)
      .from(aiUsage)
      .where(and(userId ? eq(aiUsage.userId, userId) : undefined, gte(aiUsage.createdAt, since)));
    return toTotals(row!, withCost);
  }

  // Totals per day (the last 30) or per month (the last 12), oldest first;
  // days and months with no replies are left out.
  async function series(unit: "day" | "month", userId: string | null) {
    const now = clock();
    const since = unit === "day" ? dayStart(now, 29) : monthStart(now, 11);
    // Written into the query (not as parameters), so GROUP BY matches the
    // column; both come from the two fixed choices above.
    const bucket = sql<string>`to_char(date_trunc('${sql.raw(unit)}', ${aiUsage.createdAt}), '${sql.raw(unit === "day" ? "YYYY-MM-DD" : "YYYY-MM")}')`;
    const rows = await db
      .select({ period: bucket, ...totalsColumns })
      .from(aiUsage)
      .where(and(userId ? eq(aiUsage.userId, userId) : undefined, gte(aiUsage.createdAt, since)))
      .groupBy(bucket)
      .orderBy(bucket);
    return rows.map((r) => ({ period: r.period, ...toTotals(r, true) }));
  }

  // Credits given (by reason) or bought since a time; positive changes only.
  async function given(since: Date, userId?: string) {
    const rows = await db
      .select({ reason: creditLedger.reason, credits: sql<string>`coalesce(sum(${creditLedger.change}), 0)` })
      .from(creditLedger)
      .where(and(gte(creditLedger.createdAt, since), sql`${creditLedger.change} > 0`, ne(creditLedger.reason, "ai"), userId ? eq(creditLedger.userId, userId) : undefined))
      .groupBy(creditLedger.reason);
    const by = Object.fromEntries(rows.map((r) => [r.reason, asCredits(r.credits)])) as Partial<Record<CreditReason, number>>;
    return { starter: by.starter ?? 0, monthly: by.monthly ?? 0, grant: by.grant ?? 0, bought: by["top-up"] ?? 0 };
  }

  return {
    // The Usage page: this month's totals, the replies and what was added.
    async forUser(userId: string, opts: { before?: number } = {}) {
      const [month, lines, adds] = await Promise.all([
        totals(userId, monthStart(clock()), false),
        replies(userId, { before: opts.before }),
        opts.before ? Promise.resolve(null) : added(userId),
      ]);
      return { month, replies: lines.map((l) => l.line), added: adds, more: lines.length === PAGE };
    },

    // The admin view: totals by day and month, the accounts that spent most
    // this period, the dearest replies, and the credits given and bought.
    async overview(period: "month" | "30-days") {
      const now = clock();
      const since = period === "month" ? monthStart(now) : dayStart(now, 29);
      const spend = sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)`;
      const [byDay, byMonth, total, top, dearest, gift] = await Promise.all([
        series("day", null),
        series("month", null),
        totals(null, since, true),
        db
          .select({ userId: aiUsage.userId, ...totalsColumns })
          .from(aiUsage)
          .where(gte(aiUsage.createdAt, since))
          .groupBy(aiUsage.userId)
          .orderBy(desc(spend))
          .limit(PAGE),
        replies(null, { since, limit: 20, byCost: true }),
        given(since),
      ]);
      const ids = top.map((t) => t.userId);
      const people = ids.length
        ? await db
            .select({ id: user.id, email: user.email, name: user.name, balance: creditAccounts.balance, bought: creditAccounts.bought })
            .from(user)
            .leftJoin(creditAccounts, eq(creditAccounts.userId, user.id))
            .where(inArray(user.id, ids))
        : [];
      const byId = new Map(people.map((p) => [p.id, p]));
      return {
        period,
        since: since.getTime(),
        total,
        byDay,
        byMonth,
        accounts: top.map((t) => {
          const p = byId.get(t.userId);
          return {
            id: t.userId,
            email: p?.email ?? "",
            name: p?.name ?? "",
            balance: { free: asCredits((p?.balance ?? 0) - (p?.bought ?? 0)), bought: asCredits(p?.bought ?? 0) },
            ...toTotals(t, true),
          };
        }),
        dearest: dearest.map((r) => ({ ...r.line, ...r.admin })),
        given: gift,
      };
    },

    // One account for the admin view.
    async account(userId: string) {
      const [who] = await db
        .select({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, balance: creditAccounts.balance, bought: creditAccounts.bought })
        .from(user)
        .leftJoin(creditAccounts, eq(creditAccounts.userId, user.id))
        .where(eq(user.id, userId));
      if (!who) return null;
      const [byDay, byMonth, lines, adds] = await Promise.all([series("day", userId), series("month", userId), replies(userId), added(userId)]);
      return {
        id: who.id,
        email: who.email,
        name: who.name,
        since: who.createdAt.getTime(),
        balance: { free: asCredits((who.balance ?? 0) - (who.bought ?? 0)), bought: asCredits(who.bought ?? 0) },
        byDay,
        byMonth,
        replies: lines.map((r) => ({ ...r.line, ...r.admin })),
        added: adds,
      };
    },
  };
}

export type Usage = ReturnType<typeof createUsage>;
