// Running a chat turn in the page: send the user's message to the model, let
// it use Odaja's tools until it's done, and report what happens as it streams.
//   - Anthropic API: the official Anthropic SDK, streaming tool loop.
//   - OpenAI, Gemini, OpenRouter, Ollama, LM Studio: the Vercel AI SDK.
// Requests go straight from the browser to the provider with the user's own
// key. Tools run in the page (website) or on the companion (src/agent/client.ts).
import Anthropic from "@anthropic-ai/sdk";
import { platform } from "../../platform";
import { dynamicTool, jsonSchema, stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { callTool, listTools } from "../client";
import type { ToolResult } from "../tools";
import { beforeAiLabel, FALLBACK_BETA, summarize, toolResultBlock, userMessage } from "./anthropic";
import { transcript } from "./conversations";
import { localServerHelp } from "./models";
import { explainLimit, patientFetch } from "./rateLimits";
import { SYSTEM_PROMPT } from "./prompt";
import { baseUrl, type ChatSettings } from "./settings";
import type { AssistantItem, ChatEvent, Conversation, HostedEvent, ImageInput, ProviderId } from "./types";

export interface RunContext {
  emit(event: ChatEvent): void;
  signal: AbortSignal;
  settings: ChatSettings;
  // The photos shared in this conversation, for the photo tools.
  photos(): Promise<ImageInput[]>;
  // Requests to the provider (set by runTurn: waits out rate limits).
  fetch?: typeof fetch;
}

export interface UserInput {
  text: string;
  images: ImageInput[];
}

const MAX_STEPS = 30;

const runTool = (name: string, input: unknown, ctx: RunContext) => callTool(name, input, { photos: ctx.photos });

// Collects the assistant's turn for the saved transcript as events stream.
class TurnRecorder {
  items: AssistantItem[] = [];
  text(delta: string) {
    const last = this.items.at(-1);
    if (last?.type === "text") last.text += delta;
    else this.items.push({ type: "text", text: delta });
  }
  toolStart(id: string, name: string, input: unknown) {
    this.items.push({ type: "tool", id, name, input });
  }
  toolEnd(id: string, ok: boolean, summary: string) {
    const item = this.items.find((i) => i.type === "tool" && i.id === id);
    if (item?.type === "tool") Object.assign(item, { ok, summary });
  }
}

function recorded(ctx: RunContext, rec: TurnRecorder): RunContext {
  return {
    ...ctx,
    emit(e) {
      if (e.type === "text") rec.text(e.delta);
      if (e.type === "tool-start") rec.toolStart(e.id, e.name, e.input);
      if (e.type === "tool-end") rec.toolEnd(e.id, e.ok, e.summary);
      ctx.emit(e);
    },
  };
}

// Runs one turn; the items it produced are returned even when it fails part way.
export async function runTurn(conv: Conversation, input: UserInput, ctx: RunContext): Promise<{ items: AssistantItem[]; error?: Error }> {
  const rec = new TurnRecorder();
  const c: RunContext = { ...recorded(ctx, rec), fetch: patientFetch(conv.provider, ctx.signal, (message) => ctx.emit({ type: "status", message })) };
  const family = conv.provider === "anthropic" || conv.provider === "claude-code" || conv.provider === "odaja" ? conv.provider : "aisdk";
  // Switching between kinds of connection: carry the conversation over as text.
  const earlier = conv.state.family && conv.state.family !== family ? transcript(conv.turns.slice(0, -1)) : "";
  if (conv.state.family !== family) conv.state = { family };
  // Cloud homes: keep the home as it is now, so the whole reply can be undone
  // from History (Odaja's AI keeps it on the server itself).
  if (family !== "odaja") await platform.versions?.create(beforeAiLabel(input.text), "before-ai").catch(() => {});
  try {
    if (family === "anthropic") await runAnthropic(conv, input, c, earlier);
    else if (family === "claude-code") await runClaudeCode(conv, input, c, earlier);
    else if (family === "odaja") await runOdaja(conv, input, c, earlier);
    else await runAiSdk(conv, input, c, earlier);
    return { items: rec.items };
  } catch (err) {
    return { items: rec.items, error: explain(conv.provider, err, ctx.settings) };
  }
}

// Browsers report an unreachable server only as "Failed to fetch".
function explain(provider: string, err: unknown, settings: ChatSettings): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  const limit = explainLimit(provider, err);
  if (limit) {
    console.warn("[odaja] chat:", error.message);
    return new Error(limit);
  }
  const unreachable = /failed to fetch|load failed|networkerror|cannot connect/i.test(error.message);
  if (unreachable && (provider === "ollama" || provider === "lmstudio")) return new Error(localServerHelp(provider, baseUrl(settings, provider)));
  return error;
}

const withEarlier = (text: string, earlier: string) => (earlier ? `Our conversation so far:\n\n${earlier}\n\n---\n\n${text}` : text);

// Odaja's tools as JSON schemas (from the page or the companion).
async function toolSchemas() {
  return (await listTools()).map((t) => ({ ...t, inputSchema: { type: "object", ...t.inputSchema } }));
}

// --- Anthropic API (official SDK) ------------------------------------------

// Models that take the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function runAnthropic(conv: Conversation, input: UserInput, ctx: RunContext, earlier: string) {
  // The key is the user's own, typed into this page; nothing else sees it.
  const client = new Anthropic({ apiKey: ctx.settings.keys.anthropic, dangerouslyAllowBrowser: true, fetch: ctx.fetch });
  const messages = (conv.state.anthropic ??= []);
  messages.push(userMessage(input.images, withEarlier(input.text, earlier)));
  const tools: Anthropic.Beta.BetaTool[] = (await toolSchemas()).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    // Stream large inputs (e.g. many parts) as they're generated; inputs are
    // validated against the tool's schema before running (callTool).
    eager_input_streaming: true,
  }));

  let jsonRetries = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.beta.messages.stream(
      {
        model: conv.model,
        max_tokens: 64000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        ...(FALLBACK_MODELS.has(conv.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
      } as Anthropic.Beta.MessageCreateParamsStreaming,
      { signal: ctx.signal },
    );
    stream.on("text", (delta) => ctx.emit({ type: "text", delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Only an unparseable tool input is retried; API errors go to the user.
      if (err instanceof Anthropic.APIError || ctx.signal.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === "refusal") {
      ctx.emit({ type: "error", message: "The model declined this request." });
      return;
    }
    // Keep the full content (thinking, fallback and tool blocks) unchanged.
    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) return;
    if (message.stop_reason === "max_tokens") throw new Error("The reply was cut off in the middle of a tool call (max_tokens).");

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      ctx.emit({ type: "tool-start", id: use.id, name: use.name, input: use.input });
      const result = await runTool(use.name, use.input, ctx);
      ctx.emit({ type: "tool-end", id: use.id, ok: !result.isError, summary: summarize(result) });
      results.push(toolResultBlock(use.id, result));
    }
    // All results go back in a single user message.
    messages.push({ role: "user", content: results });
  }
  ctx.emit({ type: "error", message: `Stopped after ${MAX_STEPS} steps.` });
}

// --- Claude Code (the user's subscription, through the companion) ---------

// The companion runs Claude Code and streams its events back (server/claudeCode.ts);
// Odaja's tools reach the project through Claude Code's MCP connection.
async function runClaudeCode(conv: Conversation, input: UserInput, ctx: RunContext, earlier: string) {
  const stop = () => void fetch("/api/claude-code/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: conv.id }) });
  ctx.signal.addEventListener("abort", stop, { once: true });
  try {
    const res = await fetch("/api/claude-code/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: conv.id,
        model: conv.model,
        session: conv.state.claudeCodeSession,
        text: withEarlier(input.text, earlier),
        images: input.images,
        photos: await ctx.photos(),
      }),
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Claude Code couldn't start (${res.status})`);
    await readEvents<ChatEvent | { type: "done"; session?: string }>(res.body, (event) => {
      if (event.type === "done") {
        if (event.session) conv.state.claudeCodeSession = event.session;
      } else if (!(ctx.signal.aborted && event.type === "error")) ctx.emit(event);
    });
  } finally {
    ctx.signal.removeEventListener("abort", stop);
  }
}

// Server-Sent Events from a fetch response: each `data:` line is one JSON event.
async function readEvents<T>(body: ReadableStream<BufferSource>, onEvent: (event: T) => void) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)) as T);
    }
  }
}

// --- Odaja's AI (credits, on the cloud server) -----------------------------

// The server runs the model and the tools on the home in the account
// (backend/ai/turn.ts); this page shows the reply, takes the screenshots the
// tools ask for and opens the scenes they make. The conversation's history
// is kept here, with the chat, and sent along with each message.
async function runOdaja(conv: Conversation, input: UserInput, ctx: RunContext, earlier: string) {
  const [{ useCloudAuth }, { useCloudAi }, { useOdaja }] = await Promise.all([import("../../cloud/auth"), import("../../cloud/ai"), import("../../store")]);
  const ai = platform.hostedAi;
  if (!ai) {
    ctx.emit({ type: "notice", notice: { kind: useCloudAuth.getState().status === "signed-in" ? "local-home" : "sign-in" } });
    return;
  }
  const app = useOdaja.getState();
  const body = {
    model: conv.model,
    chatId: conv.id,
    messages: conv.state.odaja ?? [],
    text: withEarlier(input.text, earlier),
    images: input.images,
    photos: await ctx.photos(),
    ui: { scenePath: app.scenePath, level: app.level, editingObject: app.editingObjectId },
  };
  type Refusal = { error?: string; code?: string; nextAllowance?: number | null; topUpUrl?: string | null } | null;
  let res = await ai.turn(body);
  let refusal: Refusal = res.ok ? null : await res.json().catch(() => null);
  // A long conversation goes on from a written summary of itself (cheaper).
  if (refusal?.code === "history-too-long") {
    body.messages = [];
    body.text = withEarlier(input.text, earlier || transcript(conv.turns.slice(0, -1)));
    res = await ai.turn(body);
    refusal = res.ok ? null : await res.json().catch(() => null);
  }
  if (!res.ok || !res.body) {
    const code = refusal?.code;
    // The credits shown may be out of date (spent in another tab, or granted).
    void useCloudAi.getState().refresh();
    if (code === "no-credits" || code === "ceiling") return ctx.emit({ type: "notice", notice: { kind: code, nextAllowance: refusal?.nextAllowance, topUpUrl: refusal?.topUpUrl } });
    if (code === "verify-email") return ctx.emit({ type: "notice", notice: { kind: "verify-email" } });
    if (res.status === 401) {
      useCloudAuth.getState().handleUnauthorized();
      return ctx.emit({ type: "notice", notice: { kind: "sign-in" } });
    }
    throw new Error(refusal?.error ?? `Odaja's AI couldn't start (${res.status}).`);
  }

  // Stopping asks the server to stop; it settles what was used and still
  // sends its account of the reply, which is read to the end.
  const stop = () => void ai.stop();
  ctx.signal.addEventListener("abort", stop, { once: true });
  let finished = false;
  try {
    await readEvents<HostedEvent>(res.body, (event) => {
      switch (event.type) {
        case "screenshot":
          // Show what the tools changed first, then take the picture.
          void (async () => {
            try {
              await ai.reload(event.changed);
              const { captureView } = await import("../../three/capture");
              await ai.answerScreenshot(event.id, await captureView(event.view, event.level));
            } catch (err) {
              await ai.answerScreenshot(event.id, { error: (err as Error).message });
            }
          })();
          break;
        case "open-scene":
          ai.openScene(event.path);
          break;
        case "limit": {
          const status = useCloudAi.getState().status;
          ctx.emit({ type: "notice", notice: { kind: event.kind, nextAllowance: status?.nextAllowance, topUpUrl: status?.topUpUrl } });
          break;
        }
        case "done":
          finished = true;
          conv.state.odaja = [...body.messages, ...event.messages];
          if (event.balance !== null) useCloudAi.getState().setBalance(event.balance);
          break;
        default:
          if (!(ctx.signal.aborted && event.type === "error")) ctx.emit(event);
      }
    });
  } finally {
    ctx.signal.removeEventListener("abort", stop);
    // The connection was lost before the end: keep what was asked and that it
    // ended part way, so the next message knows.
    if (!finished) {
      conv.state.odaja = [
        ...body.messages,
        userMessage(input.images, body.text),
        { role: "assistant", content: [{ type: "text", text: "(This reply ended part way. Some of its changes may already be in the home: look before going on.)" }] },
      ];
      void useCloudAi.getState().refresh();
    }
  }
}

// --- OpenAI, Gemini, OpenRouter, local models (Vercel AI SDK) --------------

function aiSdkModel(provider: ProviderId, model: string, settings: ChatSettings, fetch?: typeof globalThis.fetch): LanguageModel {
  const key = settings.keys[provider];
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: key, fetch })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: key, fetch })(model);
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: key, fetch })(model);
    case "ollama":
      return createOpenAICompatible({ name: "ollama", baseURL: `${baseUrl(settings, "ollama")}/v1`, fetch })(model);
    case "lmstudio":
      return createOpenAICompatible({ name: "lmstudio", baseURL: `${baseUrl(settings, "lmstudio")}/v1`, fetch })(model);
    default:
      throw new Error(`not an AI SDK provider: ${provider}`);
  }
}

async function runAiSdk(conv: Conversation, input: UserInput, ctx: RunContext, earlier: string) {
  const messages = (conv.state.aisdk ??= []);
  messages.push({
    role: "user",
    content: [
      ...input.images.map((img) => ({ type: "image" as const, image: img.data, mediaType: img.mimeType })),
      { type: "text" as const, text: withEarlier(input.text, earlier) },
    ],
  });
  const tools: ToolSet = Object.fromEntries(
    (await toolSchemas()).map((t) => [
      t.name,
      dynamicTool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (toolInput) => runTool(t.name, toolInput, ctx),
        toModelOutput: ({ output }) => {
          const result = output as ToolResult;
          return {
            type: "content",
            value: result.content.map((c) =>
              c.type === "text" ? { type: "text" as const, text: c.text } : { type: "file" as const, data: { type: "data" as const, data: c.data }, mediaType: c.mimeType },
            ),
          };
        },
      }),
    ]),
  );
  const result = streamText({
    model: aiSdkModel(conv.provider as ProviderId, conv.model, ctx.settings, ctx.fetch),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: ctx.signal,
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") ctx.emit({ type: "text", delta: part.text });
    else if (part.type === "tool-call") ctx.emit({ type: "tool-start", id: part.toolCallId, name: part.toolName, input: part.input });
    else if (part.type === "tool-result") {
      const output = part.output as ToolResult;
      ctx.emit({ type: "tool-end", id: part.toolCallId, ok: !output.isError, summary: summarize(output) });
    } else if (part.type === "tool-error") ctx.emit({ type: "tool-end", id: part.toolCallId, ok: false, summary: String(part.error) });
    else if (part.type === "error") throw part.error instanceof Error ? part.error : new Error(String(part.error));
  }
  messages.push(...((await result.responseMessages) as ModelMessage[]));
}
