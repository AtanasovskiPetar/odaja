// Running a chat turn in the page: send the user's message to the model, let
// it use Odaja's tools until it's done, and report what happens as it streams.
//   - Anthropic API: the official Anthropic SDK, streaming tool loop.
//   - OpenAI, Gemini, OpenRouter, Ollama, LM Studio: the Vercel AI SDK.
// Requests go straight from the browser to the provider with the user's own
// key. Tools run in the page (website) or on the companion (src/agent/client.ts).
import Anthropic from "@anthropic-ai/sdk";
import { dynamicTool, jsonSchema, stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { callTool, listTools } from "../client";
import type { ToolResult } from "../tools";
import { transcript } from "./conversations";
import { localServerHelp } from "./models";
import { explainLimit, patientFetch } from "./rateLimits";
import { SYSTEM_PROMPT } from "./prompt";
import { baseUrl, type ChatSettings } from "./settings";
import type { AssistantItem, ChatEvent, Conversation, ImageInput, ProviderId } from "./types";

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

function summarize(result: ToolResult): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "(image)")).join(" ").slice(0, 300);
}

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
  const family = conv.provider === "anthropic" ? "anthropic" : "aisdk";
  // Switching between kinds of connection: carry the conversation over as text.
  const earlier = conv.state.family && conv.state.family !== family ? transcript(conv.turns.slice(0, -1)) : "";
  if (conv.state.family !== family) conv.state = { family };
  try {
    if (family === "anthropic") await runAnthropic(conv, input, c, earlier);
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
  messages.push({
    role: "user",
    content: [
      ...input.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType as "image/png", data: img.data } })),
      { type: "text" as const, text: withEarlier(input.text, earlier) },
    ],
  });
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
        ...(FALLBACK_MODELS.has(conv.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
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
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        is_error: result.isError || undefined,
        content: result.content.map((c) =>
          c.type === "text"
            ? { type: "text" as const, text: c.text }
            : { type: "image" as const, source: { type: "base64" as const, media_type: c.mimeType as "image/jpeg", data: c.data } },
        ),
      });
    }
    // All results go back in a single user message.
    messages.push({ role: "user", content: results });
  }
  ctx.emit({ type: "error", message: `Stopped after ${MAX_STEPS} steps.` });
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
