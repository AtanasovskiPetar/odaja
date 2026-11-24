// Credits against a real Postgres (compose.yml, with the schema pushed):
//   TEST_DATABASE_URL=postgres://odaja:odaja_dev_password@localhost:5432/odaja bun test backend
// Skipped without TEST_DATABASE_URL.
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "../db/index";
import { creditAccounts, creditLedger, user } from "../db/schema";
import { aiConfigFrom, MILLI, type AiConfig } from "./config";
import { createCredits } from "./credits";

const url = process.env.TEST_DATABASE_URL;
const db = url ? createDb(url) : null;
const made: string[] = [];

const config = (env: Record<string, string>): AiConfig => aiConfigFrom(env, { emailConfigured: false });

async function newUser() {
  const id = `test-${crypto.randomUUID()}`;
  await db!.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
  made.push(id);
  return id;
}

const ledger = (userId: string) => db!.select().from(creditLedger).where(eq(creditLedger.userId, userId));

afterAll(async () => {
  if (db && made.length) await db.delete(user).where(inArray(user.id, made));
});

describe.skipIf(!db)("credits", () => {
  test("starter credits once, and only for an eligible account", async () => {
    const credits = createCredits(db!, config({ AI_STARTER_CREDITS: "50" }));
    const id = await newUser();
    expect((await credits.status(id, false)).available).toBe(0);
    expect((await credits.status(id, true)).available).toBe(50 * MILLI);
    expect((await credits.status(id, true)).available).toBe(50 * MILLI);
    expect((await ledger(id)).map((l) => l.reason)).toEqual(["starter"]);
  });

  test("the monthly allowance tops up to the allowance, once a month", async () => {
    let now = new Date(Date.UTC(2026, 10, 3));
    const credits = createCredits(db!, config({ AI_MONTHLY_CREDITS: "20" }), () => now);
    const id = await newUser();
    expect((await credits.status(id, true)).available).toBe(20 * MILLI);
    const r = await credits.reserve(id, true, () => 15 * MILLI);
    await credits.settle(id, r, 15 * MILLI, {});
    expect((await credits.status(id, true)).available).toBe(5 * MILLI);
    now = new Date(Date.UTC(2026, 11, 1));
    expect((await credits.status(id, true)).available).toBe(20 * MILLI);
    expect((await credits.status(id, true)).available).toBe(20 * MILLI);
  });

  test("parallel replies never spend past the balance", async () => {
    const credits = createCredits(db!, config({}));
    const id = await newUser();
    await credits.grant(id, 10, "grant");
    // 25 steps at once, each wanting to hold one credit: ten get it.
    const holds = await Promise.all(Array.from({ length: 25 }, () => credits.reserve(id, true, (available) => (available >= MILLI ? MILLI : 0))));
    expect(holds.filter((h) => h.held > 0)).toHaveLength(10);
    // Each charged more than it held: charged only what it held.
    await Promise.all(holds.filter((h) => h.held).map((h) => credits.settle(id, h, 2 * MILLI, {})));
    const [account] = await db!.select().from(creditAccounts).where(eq(creditAccounts.userId, id));
    expect(account).toMatchObject({ balance: 0, held: 0, spent: 10 * MILLI });
    const lines = await ledger(id);
    expect(lines.reduce((sum, l) => sum + l.change, 0)).toBe(0);
  });

  test("settling gives back what a step didn't use", async () => {
    const credits = createCredits(db!, config({}));
    const id = await newUser();
    await credits.grant(id, 10, "grant");
    const r = await credits.reserve(id, true, () => 4 * MILLI);
    expect((await credits.status(id, true)).available).toBe(6 * MILLI);
    expect(await credits.settle(id, r, 250, {})).toEqual({ charged: 250, chargedBought: 0, balance: 10 * MILLI - 250 });
  });

  test("the monthly ceiling caps spending whatever the balance", async () => {
    const credits = createCredits(db!, config({ AI_MONTHLY_CEILING_CREDITS: "5" }));
    const id = await newUser();
    await credits.grant(id, 100, "grant");
    const first = await credits.reserve(id, true, (available) => available);
    expect(first).toMatchObject({ held: 5 * MILLI, limitedBy: "ceiling" });
    // Held counts against the ceiling until it's settled.
    expect((await credits.reserve(id, true, (a) => a)).held).toBe(0);
    await credits.settle(id, first, 3 * MILLI, {});
    expect((await credits.reserve(id, true, (a) => a)).held).toBe(2 * MILLI);
  });

  test("holds left by a stopped server go back", async () => {
    const credits = createCredits(db!, config({}));
    const id = await newUser();
    await credits.grant(id, 10, "grant");
    await credits.reserve(id, true, () => 7 * MILLI);
    expect(await credits.releaseHolds()).toBeGreaterThanOrEqual(1);
    const [account] = await db!.select().from(creditAccounts).where(eq(creditAccounts.userId, id));
    expect(account).toMatchObject({ balance: 10 * MILLI, held: 0 });
  });

  test("free credits are spent first, and what's given back goes back where it came from", async () => {
    const credits = createCredits(db!, config({}));
    const id = await newUser();
    await credits.grant(id, 3, "grant");
    await credits.grant(id, 10, "top-up", { payment: "test" });
    expect(await credits.status(id, true)).toMatchObject({ available: 13 * MILLI, free: 3 * MILLI, bought: 10 * MILLI });
    // Holds 5: the 3 free ones and 2 bought; uses 4: 3 free and 1 bought.
    const r = await credits.reserve(id, true, () => 5 * MILLI);
    expect(r).toMatchObject({ held: 5 * MILLI, heldBought: 2 * MILLI });
    expect(await credits.settle(id, r, 4 * MILLI, {})).toEqual({ charged: 4 * MILLI, chargedBought: MILLI, balance: 9 * MILLI });
    expect(await credits.status(id, true)).toMatchObject({ free: 0, bought: 9 * MILLI });
    const charge = (await ledger(id)).find((l) => l.reason === "ai")!;
    expect(charge).toMatchObject({ change: -4 * MILLI, bought: -MILLI, balanceAfter: 9 * MILLI });
  });

  test("the monthly allowance tops up free credits only; bought ones don't count against it", async () => {
    const credits = createCredits(db!, config({ AI_MONTHLY_CREDITS: "20" }));
    const id = await newUser();
    await credits.grant(id, 50, "top-up");
    expect(await credits.status(id, true)).toMatchObject({ free: 20 * MILLI, bought: 50 * MILLI });
  });

  test("taking credits back takes at most what that kind has", async () => {
    const credits = createCredits(db!, config({}));
    const id = await newUser();
    await credits.grant(id, 5, "grant");
    await credits.grant(id, 8, "top-up");
    expect(await credits.grant(id, -100, "grant")).toBe(8 * MILLI);
    expect(await credits.status(id, true)).toMatchObject({ free: 0, bought: 8 * MILLI });
  });

  test("bought holds left by a stopped server go back as bought", async () => {
    const credits = createCredits(db!, config({}));
    const id = await newUser();
    await credits.grant(id, 1, "grant");
    await credits.grant(id, 9, "top-up");
    await credits.reserve(id, true, () => 6 * MILLI);
    await credits.releaseHolds();
    const [account] = await db!.select().from(creditAccounts).where(eq(creditAccounts.userId, id));
    expect(account).toMatchObject({ balance: 10 * MILLI, bought: 9 * MILLI, held: 0, heldBought: 0 });
  });
});
