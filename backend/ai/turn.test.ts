// A whole reply from our AI with a scripted model in place of the API, on a
// home in compose.yml's Postgres and S3 (see homeFiles.test.ts). Skipped
// without TEST_DATABASE_URL and TEST_S3_ENDPOINT.
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { newProjectFile, newSceneFile, newShellFile } from "../../src/model/defaults";
import { formatJson } from "../../src/model/format";
import { createDb } from "../db/index";
import { aiUsage, creditAccounts, projects, user } from "../db/schema";
import { createHomeEvents } from "../events";
import { createHomes, newId } from "../homes";
import { createS3BlobStore } from "../storage/s3";
import { aiConfigFrom, MILLI } from "./config";
import { createCredits } from "./credits";
import { homeArea } from "./homeFiles";
import { createScreenshots, runHostedTurn, type TurnEvent } from "./turn";

const dbUrl = process.env.TEST_DATABASE_URL;
const s3 = process.env.TEST_S3_ENDPOINT;
const db = dbUrl && s3 ? createDb(dbUrl) : null;
const blobs = s3
  ? createS3BlobStore({ endpoint: s3, publicEndpoint: s3, region: "us-east-1", bucket: "odaja", accessKeyId: "odaja_access_key", secretAccessKey: "odaja_secret_key" })
  : null;
const users: string[] = [];
afterAll(async () => {
  if (db && users.length) await db.delete(user).where(inArray(user.id, users));
});

const cfg = aiConfigFrom(
  {
    ANTHROPIC_API_KEY: "test",
    AI_MODELS: JSON.stringify([{ id: "standard", name: "Odaja AI", model: "claude-sonnet-5-5", price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } }]),
  },
  { emailConfigured: false },
);

type Scripted = { content: Anthropic.Beta.BetaContentBlock[]; stop: Anthropic.Beta.BetaStopReason; usage: { input: number; output: number } };

// Answers each step with the next scripted message, the way the SDK's stream does.
function fakeClient(script: Scripted[], seen: Anthropic.Beta.MessageCreateParams[]) {
  let i = 0;
  return {
    beta: {
      messages: {
        stream(params: Anthropic.Beta.MessageCreateParams) {
          seen.push(structuredClone(params));
          const step = script[i++]!;
          const handlers: Record<string, ((x: unknown) => void)[]> = {};
          return {
            on(name: string, fn: (x: unknown) => void) {
              (handlers[name] ??= []).push(fn);
              return this;
            },
            async finalMessage() {
              const usage = { input_tokens: step.usage.input, output_tokens: step.usage.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
              handlers.streamEvent?.forEach((h) => h({ type: "message_start", message: { usage } }));
              for (const b of step.content) if (b.type === "text") handlers.text?.forEach((h) => h(b.text));
              return { id: `msg-${i}`, type: "message", role: "assistant", model: params.model, content: step.content, stop_reason: step.stop, usage } as unknown as Anthropic.Beta.BetaMessage;
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
}

async function setUp(credits: number) {
  const homes = createHomes(db!, blobs!);
  await blobs!.ensureBucket();
  const owner = `test-${crypto.randomUUID()}`;
  await db!.insert(user).values({ id: owner, name: "Test", email: `${owner}@example.test` });
  users.push(owner);
  const manifest = await homes.manifestOf({
    "project.json": formatJson(newProjectFile("Test")),
    "shell.json": formatJson(newShellFile({ width: 400, depth: 300, height: 260 })),
    "scenes/current.json": formatJson(newSceneFile("Current")),
  });
  const projectId = newId();
  await db!.insert(projects).values({ id: projectId, ownerId: owner, name: "Test", manifest });
  const ledger = createCredits(db!, cfg);
  await ledger.grant(owner, credits, "grant");
  const area = homeArea({ db: db!, blobs: blobs!, homes, events: createHomeEvents() }, projectId, owner);
  return { owner, projectId, ledger, area };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Anthropic.Beta.BetaContentBlock;
const say = (text: string) => ({ type: "text", text, citations: null }) as Anthropic.Beta.BetaContentBlock;

describe.skipIf(!db)("a reply from our AI", () => {
  test("uses the tools on the home, charges what it cost, and hands back the conversation", async () => {
    const { owner, projectId, ledger, area } = await setUp(10);
    const seen: Anthropic.Beta.MessageCreateParams[] = [];
    const client = fakeClient(
      [
        { content: [say("Adding a sofa."), toolUse("t1", "add_object", { name: "Sofa", template: "sofa", position: [200, 150] })], stop: "tool_use", usage: { input: 20_000, output: 300 } },
        { content: [say("Done: the sofa faces north.")], stop: "end_turn", usage: { input: 20_500, output: 100 } },
      ],
      seen,
    );
    const events: TurnEvent[] = [];
    await runHostedTurn(
      { db: db!, cfg, credits: ledger, screenshots: createScreenshots(), client },
      { userId: owner, projectId, model: cfg.models[0]!, chatId: "c1", history: [], text: "Add a sofa", images: [], photos: [], ui: {}, area },
      (e) => events.push(e),
      new AbortController().signal,
    );

    expect(events.map((e) => e.type)).toEqual(["text", "tool-start", "tool-end", "text", "done"]);
    expect(events[2]).toMatchObject({ type: "tool-end", ok: true });
    const done = events.at(-1) as Extract<TurnEvent, { type: "done" }>;
    expect(done.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect([...area.changed.keys()]).toEqual(["scenes/current.json"]);

    // Cached: the system prompt and the conversation; same tools each step.
    expect(seen[0]!.system).toMatchObject([{ cache_control: { type: "ephemeral" } }]);
    expect((seen[0] as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    expect(seen[1]!.tools).toEqual(seen[0]!.tools);

    // Cost: 40.5k input at $2/M and 400 output at $10/M = $0.085 = 8.5 credits.
    const [usage] = await db!.select().from(aiUsage).where(eq(aiUsage.userId, owner));
    expect(usage).toMatchObject({ steps: 2, inputTokens: 40_500, outputTokens: 400, costMicroUsd: 85_000, charged: 8500, outcome: "done" });
    const [account] = await db!.select().from(creditAccounts).where(eq(creditAccounts.userId, owner));
    expect(account).toMatchObject({ balance: 10 * MILLI - 8500, held: 0 });
    expect(done.balance).toBe(10 * MILLI - 8500);
  });

  test("stops between steps when the credits run out, never below zero", async () => {
    // Enough for one step (the tools and system prompt alone are ~3 credits).
    const { owner, projectId, ledger, area } = await setUp(6);
    const client = fakeClient(
      [
        // The first step costs more than the account had left for a second.
        { content: [toolUse("t1", "get_overview", {})], stop: "tool_use", usage: { input: 30_000, output: 9000 } },
        { content: [say("never reached")], stop: "end_turn", usage: { input: 1, output: 1 } },
      ],
      [],
    );
    const events: TurnEvent[] = [];
    await runHostedTurn(
      { db: db!, cfg, credits: ledger, screenshots: createScreenshots(), client },
      { userId: owner, projectId, model: cfg.models[0]!, chatId: "c2", history: [], text: "Look", images: [], photos: [], ui: {}, area },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(events.map((e) => e.type)).toEqual(["tool-start", "tool-end", "limit", "done"]);
    expect(events.some((e) => e.type === "text" && e.delta === "never reached")).toBe(false);
    // The step cost more than was held for it; only what was held is charged.
    const [account] = await db!.select().from(creditAccounts).where(eq(creditAccounts.userId, owner));
    expect(account).toMatchObject({ balance: 0, held: 0 });
    const [usage] = await db!.select().from(aiUsage).where(eq(aiUsage.userId, owner));
    expect(usage).toMatchObject({ steps: 1, charged: 6 * MILLI, outcome: "no-credits" });
    // The conversation ends with the tool's result, ready to continue.
    const done = events.at(-1) as Extract<TurnEvent, { type: "done" }>;
    expect(done.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  test("a screenshot is asked of the tab, and only its owner can answer", async () => {
    const { owner, projectId, ledger, area } = await setUp(10);
    const screenshots = createScreenshots();
    const client = fakeClient(
      [
        { content: [toolUse("t1", "screenshot", { view: "plan" })], stop: "tool_use", usage: { input: 100, output: 10 } },
        { content: [say("Looks good.")], stop: "end_turn", usage: { input: 100, output: 10 } },
      ],
      [],
    );
    const events: TurnEvent[] = [];
    await runHostedTurn(
      { db: db!, cfg, credits: ledger, screenshots, client },
      { userId: owner, projectId, model: cfg.models[0]!, chatId: "c3", history: [], text: "Show me", images: [], photos: [], ui: {}, area },
      (e) => {
        events.push(e);
        if (e.type === "screenshot") {
          expect(screenshots.answer("someone-else", e.id, { data: "AAAA" })).toBe(false);
          expect(screenshots.answer(owner, e.id, { data: "AAAA", mimeType: "image/jpeg" })).toBe(true);
        }
      },
      new AbortController().signal,
    );
    expect(events.find((e) => e.type === "tool-end")).toMatchObject({ ok: true });
  });
});
