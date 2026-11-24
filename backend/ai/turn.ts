// One reply from our AI on a home in the account: the same tool loop as the
// page's Anthropic runner (src/agent/chat/runners.ts), run here, where the
// credits are checked and the tools reach the home in storage. Events stream
// back to the tab that asked (see backend/app.ts), which shows the reply,
// takes screenshots for the tools and opens scenes they create.
//
// Credits (backend/ai/credits.ts): before each model step the step's most
// possible cost is held, with its output limit sized to what the account can
// afford; after it, the real cost is charged and the rest given back.
import Anthropic from "@anthropic-ai/sdk";
import { FALLBACK_BETA, summarize, toolResultBlock, userMessage } from "../../src/agent/chat/anthropic";
import { SYSTEM_PROMPT } from "../../src/agent/chat/prompt";
import type { HostedEvent, ImageInput } from "../../src/agent/chat/types";
import { newEditStore, type EditStore } from "../../src/agent/photos";
import { callTool, inputJsonSchema, TOOLS, type ToolContext } from "../../src/agent/tools";
import type { CloudDb } from "../db/index";
import { aiUsage } from "../db/schema";
import { newId } from "../homes";
import { affordableOutput, chargeFor, costUsd, type AiConfig, type AiModel, type TokenUse } from "./config";
import type { Credits } from "./credits";
import { homeFiles, type HomeArea } from "./homeFiles";

export type Message = Anthropic.Beta.BetaMessageParam;
export type { ImageInput };

// What the app shows, the default for tools (the scene, the level, the
// object open in the shape editor).
export interface UiState {
  scenePath?: string | null;
  level?: string | null;
  editingObject?: string | null;
}

// Events to the tab (defined with the chat's, which the page reads).
export type TurnEvent = HostedEvent;

// The smallest output worth starting a step for.
export const MIN_STEP_OUTPUT = 1024;

const IMAGE_TOKENS = 1800;

// A deliberately high estimate of a request's input tokens (about 2.5
// characters a token; images at their largest), so holds are never too small.
export function estimateTokens(value: unknown): number {
  let chars = 0;
  let images = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") chars += v.length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.type === "image") {
        images++;
        return;
      }
      // Thinking signatures aren't read as tokens.
      for (const [k, x] of Object.entries(o)) if (k !== "signature" && k !== "cache_control") walk(x);
    }
  };
  walk(value);
  return Math.ceil(chars / 2.5) + images * IMAGE_TOKENS;
}

// The tools as the API takes them (built once; same order every time, so the
// prompt cache matches).
let toolDefs: Anthropic.Beta.BetaTool[] | null = null;
export function tools(): Anthropic.Beta.BetaTool[] {
  toolDefs ??= TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: "object", ...inputJsonSchema(t) } as Anthropic.Beta.BetaTool.InputSchema,
  }));
  return toolDefs;
}

// The system prompt and tools, which never change.
let base: number | null = null;
export const baseTokens = () => (base ??= estimateTokens([SYSTEM_PROMPT, tools()]));

// The most a step can cost in dollars: all input at the dearest input rate (a
// cache write), and the whole output limit.
export const mostAStepCosts = (model: AiModel, inputTokens: number, outputTokens: number) =>
  (inputTokens * Math.max(model.price.input, model.price.cacheWrite) + outputTokens * model.price.output) / 1_000_000;

// Photo edits per conversation (edit-1, …): never shared, and few, since a
// decoded edit can be ~10 MB: the last 6 of each conversation, for 30 minutes,
// for at most 100 conversations.
const EDITS_KEPT = 6;
const EDITS_FOR_MS = 30 * 60_000;
const editStores = new Map<string, { store: EditStore; used: number }>();
function editsFor(key: string): EditStore {
  const now = Date.now();
  for (const [k, v] of editStores) if (now - v.used > EDITS_FOR_MS) editStores.delete(k);
  let entry = editStores.get(key);
  if (!entry) {
    entry = { store: newEditStore(EDITS_KEPT), used: now };
    editStores.set(key, entry);
    if (editStores.size > 100) editStores.delete(editStores.keys().next().value!);
  }
  entry.used = now;
  return entry.store;
}

// Screenshots asked of the tab, waiting for its answer.
export function createScreenshots(timeoutMs = 20_000) {
  const pending = new Map<string, { userId: string; resolve(s: ImageInput): void; reject(e: Error): void }>();
  return {
    request(userId: string, emit: (e: TurnEvent) => void, ask: { view: "plan" | "3d"; level?: string; changed: string[] }): Promise<ImageInput> {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.delete(id)) reject(new Error("The app didn't send the screenshot. Is the home still open in the browser?"));
        }, timeoutMs);
        const done = () => clearTimeout(timer);
        pending.set(id, { userId, resolve: (s) => (done(), resolve(s)), reject: (e) => (done(), reject(e)) });
        emit({ type: "screenshot", id, ...ask });
      });
    },
    answer(userId: string, id: string, result: { data?: string; mimeType?: string; error?: string }): boolean {
      const p = pending.get(id);
      if (!p || p.userId !== userId) return false;
      pending.delete(id);
      if (result.error || !result.data) p.reject(new Error(result.error ?? "no screenshot"));
      else p.resolve({ data: result.data, mimeType: result.mimeType ?? "image/jpeg" });
      return true;
    },
  };
}

export type Screenshots = ReturnType<typeof createScreenshots>;

export interface TurnDeps {
  db: CloudDb;
  cfg: AiConfig;
  credits: Credits;
  screenshots: Screenshots;
  client: Anthropic;
}

export interface TurnInput {
  // Already allowed to use the AI (backend/app.ts checks the account first).
  userId: string;
  projectId: string;
  model: AiModel;
  chatId: string;
  history: Message[];
  text: string;
  images: ImageInput[];
  photos: ImageInput[];
  ui: UiState;
  area: HomeArea;
}

const plus = (a: TokenUse, b: TokenUse): TokenUse => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });
const NONE: TokenUse = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const usageOf = (u: Partial<Anthropic.Beta.BetaUsage> | undefined): TokenUse => ({
  input: u?.input_tokens ?? 0,
  output: u?.output_tokens ?? 0,
  cacheRead: u?.cache_read_input_tokens ?? 0,
  cacheWrite: u?.cache_creation_input_tokens ?? 0,
});

export async function runHostedTurn(deps: TurnDeps, input: TurnInput, emit: (e: TurnEvent) => void, signal: AbortSignal): Promise<void> {
  const { db, cfg, credits, screenshots, client } = deps;
  const { model, area, ui } = input;
  const messages: Message[] = [...input.history];
  const start = messages.length;
  messages.push(userMessage(input.images, input.text));
  // What the tab was told to reload for earlier screenshots (path → hash).
  const shown = new Map<string, string | null>();

  const ctx: ToolContext = {
    files: () => homeFiles(area),
    scenePath: () => ui.scenePath ?? null,
    level: () => ui.level ?? null,
    editingObject: () => ui.editingObject ?? null,
    screenshot(view, level) {
      const changed = [...area.changed.keys()].filter((p) => shown.get(p) !== area.changed.get(p));
      for (const p of changed) shown.set(p, area.changed.get(p)!);
      return screenshots.request(input.userId, emit, { view, level, changed });
    },
    openScene(path) {
      ui.scenePath = path;
      emit({ type: "open-scene", path });
    },
    photos: async () => input.photos,
    edits: editsFor(`${input.userId}:${input.chatId}`),
  };

  let total = NONE;
  let charged = 0;
  let chargedBought = 0;
  let balance: number | null = null;
  let steps = 0;
  let outcome = "done";

  try {
    for (;;) {
      if (signal.aborted) {
        outcome = "stopped";
        break;
      }
      if (steps >= cfg.maxSteps) {
        emit({ type: "error", message: `Stopped after ${cfg.maxSteps} steps. Say "continue" to go on.` });
        outcome = "steps";
        break;
      }
      // Hold what this step may cost, at most.
      const inputTokens = baseTokens() + estimateTokens(messages);
      let maxTokens = 0;
      const hold = await credits.reserve(input.userId, true, (available) => {
        maxTokens = affordableOutput(cfg, model, available, inputTokens);
        return maxTokens < MIN_STEP_OUTPUT ? 0 : chargeFor(cfg, model, mostAStepCosts(model, inputTokens, maxTokens));
      });
      if (hold.held === 0) {
        emit({ type: "limit", kind: hold.limitedBy === "ceiling" ? "ceiling" : "no-credits" });
        outcome = "no-credits";
        break;
      }
      steps++;

      // Streamed, so text shows as it comes; what was used so far is known
      // even if the step is stopped or fails part way.
      let used = NONE;
      let outputChars = 0;
      let message: Anthropic.Beta.BetaMessage | null = null;
      try {
        const stream = client.beta.messages.stream(
          {
            model: model.model,
            max_tokens: maxTokens,
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            tools: tools(),
            messages,
            // The conversation so far is cached too (the last block each time).
            cache_control: { type: "ephemeral" },
            metadata: { user_id: input.userId },
            ...(model.effort ? { output_config: { effort: model.effort } } : {}),
            ...(model.fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
          } as Anthropic.Beta.MessageCreateParamsStreaming,
          { signal },
        );
        stream.on("streamEvent", (e) => {
          if (e.type === "message_start") used = usageOf(e.message.usage);
          else if (e.type === "message_delta") used = { ...used, output: e.usage.output_tokens ?? used.output };
          else if (e.type === "content_block_delta") {
            if (e.delta.type === "text_delta") outputChars += e.delta.text.length;
            else if (e.delta.type === "input_json_delta") outputChars += e.delta.partial_json.length;
            else if (e.delta.type === "thinking_delta") outputChars += e.delta.thinking.length;
          }
        });
        stream.on("text", (delta) => emit({ type: "text", delta }));
        message = await stream.finalMessage();
        used = usageOf(message.usage);
      } finally {
        // Stopped or failed part way: the input as the API reported it, and
        // the output streamed so far (about 3 characters a token).
        if (!message) used = { ...used, output: Math.max(used.output, Math.ceil(outputChars / 3)) };
        total = plus(total, used);
        const cost = chargeFor(cfg, model, costUsd(model.price, used));
        const settled = await credits.settle(input.userId, hold, cost, { project: input.projectId, model: model.id, step: steps });
        charged += settled.charged;
        chargedBought += settled.chargedBought;
        balance = settled.balance;
      }
      if (!message) break;

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "The model declined this request." });
        outcome = "refusal";
        break;
      }
      // The full content (thinking and tool blocks) goes back unchanged.
      messages.push({ role: "assistant", content: message.content });
      if (message.stop_reason === "pause_turn") continue;
      const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens") {
        // Cut short by what the credits allowed, or by the output limit itself.
        const short = maxTokens < cfg.maxOutputTokens;
        emit(short ? { type: "limit", kind: "no-credits" } : { type: "error", message: "The reply was cut off (it reached the output limit)." });
        // A cut-off tool call can't run; the conversation ends with the text.
        if (uses.length) messages.pop();
        outcome = short ? "no-credits" : "max-tokens";
        break;
      }
      if (uses.length === 0) break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        emit({ type: "tool-start", id: use.id, name: use.name, input: use.input });
        const result = signal.aborted ? { content: [{ type: "text" as const, text: "Stopped by the user." }], isError: true } : await callTool(use.name, use.input, ctx);
        emit({ type: "tool-end", id: use.id, ok: !result.isError, summary: summarize(result) });
        results.push(toolResultBlock(use.id, result));
      }
      // Every result of a step goes back in one user message.
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    outcome = signal.aborted ? "stopped" : "error";
    if (!signal.aborted) emit({ type: "error", message: explain(err) });
  } finally {
    // A tool call without its result can't be sent again: drop a step left
    // half done (stopped between the call and its result).
    const last = messages.at(-1);
    if (last?.role === "assistant" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_use")) messages.pop();
    await db
      .insert(aiUsage)
      .values({
        id: newId(),
        userId: input.userId,
        projectId: input.projectId,
        model: model.model,
        steps,
        inputTokens: total.input,
        outputTokens: total.output,
        cacheReadTokens: total.cacheRead,
        cacheWriteTokens: total.cacheWrite,
        costMicroUsd: Math.round(costUsd(model.price, total) * 1_000_000),
        charged,
        chargedBought,
        outcome,
      })
      .catch((e) => console.warn("[odaja-cloud] couldn't record AI usage:", (e as Error).message));
    emit({ type: "done", messages: messages.slice(start), balance });
  }
}

// Errors the user can act on, in plain words; the rest as they are.
function explain(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return "Odaja's AI is busy right now. Wait a minute and try again.";
  if (err instanceof Anthropic.InternalServerError || (err instanceof Anthropic.APIError && err.status === 529)) return "The AI service is overloaded or having trouble. Try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Odaja's server couldn't reach the AI service. Try again in a moment.";
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error("[odaja-cloud] the AI provider refused our key:", (err as Error).message);
    return "Odaja's AI isn't available right now (the server's setup needs attention).";
  }
  return err instanceof Error ? err.message : String(err);
}
