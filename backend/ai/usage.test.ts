// The Usage page and the admin view against a real Postgres (compose.yml, with
// the schema pushed); skipped without TEST_DATABASE_URL. The admin routes are
// called through the app with a stand-in for sign-in.
import { afterAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { createCloudApp, type CloudAi } from "../app";
import { createDb } from "../db/index";
import { aiUsage, projects, user } from "../db/schema";
import { newId } from "../homes";
import { aiConfigFrom } from "./config";
import { createCredits } from "./credits";
import { createUsage } from "./usage";

const url = process.env.TEST_DATABASE_URL;
const db = url ? createDb(url) : null;
const made: string[] = [];
afterAll(async () => {
  if (db && made.length) await db.delete(user).where(inArray(user.id, made));
});

const cfg = aiConfigFrom(
  {
    ANTHROPIC_API_KEY: "test",
    AI_MODELS: JSON.stringify([{ id: "standard", name: "Odaja AI", model: "claude-sonnet-5-5", price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } }]),
  },
  { emailConfigured: false },
);

type Person = { id: string; email: string; name: string; emailVerified: boolean };
async function newUser(verified = true): Promise<Person> {
  const id = `test-${crypto.randomUUID()}`;
  const person = { id, name: "Test", email: `${id}@example.test`, emailVerified: verified };
  await db!.insert(user).values(person);
  made.push(id);
  return person;
}

async function reply(userId: string, projectId: string | null, charged: number, chargedBought: number, costMicroUsd: number) {
  await db!.insert(aiUsage).values({
    id: newId(),
    userId,
    projectId,
    model: "claude-sonnet-5-5",
    steps: 2,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicroUsd,
    charged,
    chargedBought,
    outcome: "done",
  });
}

describe.skipIf(!db)("usage", () => {
  test("an account's replies, with home and model, and what was added", async () => {
    const credits = createCredits(db!, cfg);
    const usage = createUsage(db!, cfg);
    const me = await newUser();
    const pid = newId();
    await db!.insert(projects).values({ id: pid, ownerId: me.id, name: "Flat" });
    await credits.grant(me.id, 5, "grant", { note: "early supporter" });
    await credits.grant(me.id, 20, "top-up");
    await reply(me.id, pid, 1500, 0, 15_000);
    await reply(me.id, null, 4000, 2500, 40_000);

    const mine = await usage.forUser(me.id);
    expect(mine.month).toEqual({ replies: 2, credits: 5.5, bought: 2.5 });
    // Newest first.
    expect(mine.replies.map((r) => [r.home?.name ?? null, r.model, r.credits, r.bought])).toEqual([
      [null, "Odaja AI", 4, 2.5],
      ["Flat", "Odaja AI", 1.5, 0],
    ]);
    expect(mine.added?.map((a) => [a.reason, a.credits, a.bought, a.note])).toEqual([
      ["top-up", 20, 20, null],
      ["grant", 5, 0, "early supporter"],
    ]);
  });

  test("the admin routes answer only admins, and an admin sees every account and can grant", async () => {
    const credits = createCredits(db!, cfg);
    const usage = createUsage(db!, cfg);
    const admin = await newUser();
    const other = await newUser();
    const unconfirmed = await newUser(false);
    await reply(other.id, null, 9000, 0, 90_000);
    const people = new Map([admin, other, unconfirmed].map((p) => [p.id, p]));
    const app = createCloudApp({
      db: db!,
      blobs: {} as never,
      auth: {
        handler: () => new Response(null, { status: 404 }),
        api: { getSession: async ({ headers }: { headers: Headers }) => ({ user: people.get(headers.get("x-test-user") ?? "") }) },
      } as never,
      signInMethods: {} as never,
      homes: {} as never,
      events: {} as never,
      corsOrigins: [],
      ai: { cfg, credits, usage, limits: {}, screenshots: {}, client: {} } as unknown as CloudAi,
      admins: { emails: [admin.email, unconfirmed.email], needVerifiedEmail: true },
    });
    const call = (who: Person | null, path: string, body?: unknown) =>
      app.request(path, {
        method: body ? "POST" : "GET",
        headers: { ...(who ? { "x-test-user": who.id } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });

    for (const who of [null, other, unconfirmed]) {
      expect((await call(who, "/api/v1/admin/usage")).status).toBe(who ? 404 : 401);
      expect((await call(who, `/api/v1/admin/accounts/${other.id}`)).status).toBe(who ? 404 : 401);
      expect((await call(who, "/api/v1/admin/grant", { email: other.email, credits: 10 })).status).toBe(who ? 404 : 401);
    }

    const overview = (await (await call(admin, "/api/v1/admin/usage")).json()) as { total: { costUsd: number }; accounts: { id: string; costUsd: number }[]; byDay: unknown[] };
    expect(overview.accounts.find((a) => a.id === other.id)?.costUsd).toBeCloseTo(0.09);
    expect(overview.total.costUsd).toBeGreaterThanOrEqual(0.09);
    expect(overview.byDay.length).toBeGreaterThan(0);

    const granted = await call(admin, "/api/v1/admin/grant", { email: other.email.toUpperCase(), credits: 10, note: "sorry" });
    expect(await granted.json()).toMatchObject({ ok: true, balance: 10 });
    const account = (await (await call(admin, `/api/v1/admin/accounts/${other.id}`)).json()) as { balance: { free: number }; added: { note: string }[]; replies: unknown[] };
    expect(account.balance.free).toBe(10);
    expect(account.added[0]?.note).toBe("sorry");
    expect(account.replies).toHaveLength(1);

    // Only admins are told they are.
    const status = async (who: Person) => (await (await call(who, "/api/v1/ai")).json()) as { admin?: boolean };
    expect((await status(admin)).admin).toBe(true);
    expect((await status(other)).admin).toBeUndefined();
  });
});
