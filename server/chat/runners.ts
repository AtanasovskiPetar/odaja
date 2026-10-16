// Running a chat turn: send the user's message to the model, let it use
// Odaja's tools until it's done, and stream what happens to the app.
//   - Anthropic API: the official Anthropic SDK, streaming tool loop.
//   - OpenAI, Gemini, OpenRouter, Ollama, LM Studio: the Vercel AI SDK.
//   - Claude Code: the user's own installed Claude Code (their subscription),
//     driven in headless stream-json mode with Odaja's MCP server.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { dynamicTool, jsonSchema, stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { callTool, inputJsonSchema, TOOLS, type ToolContext, type ToolResult } from "../tools";
import { transcript, type AssistantItem, type Conversation, type ImageInput } from "./conversations";
import { SYSTEM_PROMPT } from "./prompt";
import { baseUrl, type ChatSettings, type ProviderId } from "./settings";

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool-start"; id: string; name: string; input: unknown }
  | { type: "tool-end"; id: string; ok: boolean; summary: string }
  | { type: "error"; message: string };

export interface RunContext {
  emit(event: ChatEvent): void;
  signal: AbortSignal;
  tools: ToolContext;
  settings: ChatSettings;
  projectDir: string;
  odajaUrl: string;
}

export interface UserInput {
  text: string;
  images: ImageInput[];
}

const MAX_STEPS = 30;

function summarize(result: ToolResult): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "(image)")).join(" ").slice(0, 300);
}

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

export async function runTurn(conv: Conversation, input: UserInput, ctx: RunContext): Promise<AssistantItem[]> {
  const rec = new TurnRecorder();
  const c = recorded(ctx, rec);
  const family = conv.provider === "anthropic" ? "anthropic" : conv.provider === "claude-code" ? "claude-code" : "aisdk";
  // Switching between kinds of connection: carry the conversation over as text.
  const earlier = conv.state.family && conv.state.family !== family ? transcript(conv.turns.slice(0, -1)) : "";
  if (conv.state.family !== family) conv.state = { family };
  if (family === "anthropic") await runAnthropic(conv, input, c, earlier);
  else if (family === "aisdk") await runAiSdk(conv, input, c, earlier);
  else await runClaudeCode(conv, input, c, earlier);
  return rec.items;
}

const withEarlier = (text: string, earlier: string) => (earlier ? `Our conversation so far:\n\n${earlier}\n\n---\n\n${text}` : text);

// --- Anthropic API (official SDK) ------------------------------------------

// Models that take the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function runAnthropic(conv: Conversation, input: UserInput, ctx: RunContext, earlier: string) {
  const client = new Anthropic({ apiKey: ctx.settings.keys.anthropic });
  const messages = (conv.state.anthropic ??= []);
  messages.push({
    role: "user",
    content: [
      ...input.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType as "image/png", data: img.data } })),
      { type: "text" as const, text: withEarlier(input.text, earlier) },
    ],
  });
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: "object", ...inputJsonSchema(t) } as Anthropic.Beta.BetaTool.InputSchema,
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
      const result = await callTool(use.name, use.input, ctx.tools);
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

function aiSdkModel(provider: ProviderId, model: string, settings: ChatSettings): LanguageModel {
  const key = settings.keys[provider];
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: key })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: key })(model);
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: key })(model);
    case "ollama":
      return createOpenAICompatible({ name: "ollama", baseURL: `${baseUrl(settings, "ollama")}/v1` })(model);
    case "lmstudio":
      return createOpenAICompatible({ name: "lmstudio", baseURL: `${baseUrl(settings, "lmstudio")}/v1` })(model);
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
    TOOLS.map((t) => [
      t.name,
      dynamicTool({
        description: t.description,
        inputSchema: jsonSchema({ type: "object", ...inputJsonSchema(t) } as Parameters<typeof jsonSchema>[0]),
        execute: async (toolInput) => callTool(t.name, toolInput, ctx.tools),
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
    model: aiSdkModel(conv.provider, conv.model, ctx.settings),
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

// --- Claude Code (the user's subscription) ---------------------------------

interface ClaudeProcess {
  proc: ChildProcessWithoutNullStreams;
  model: string;
  lastUsed: number;
  onLine?: (msg: Record<string, unknown>) => void;
  onExit?: (message: string) => void;
}

const processes = new Map<string, ClaudeProcess>();
const MCP_SERVER = path.resolve("mcp/server.ts");

// Close idle Claude Code sessions after a while; they resume when needed.
setInterval(() => {
  for (const [id, p] of processes) {
    if (Date.now() - p.lastUsed > 15 * 60 * 1000) {
      p.proc.kill();
      processes.delete(id);
    }
  }
}, 60 * 1000).unref();

export function stopAllClaudeCode() {
  for (const p of processes.values()) p.proc.kill();
  processes.clear();
}

function startClaudeCode(conv: Conversation, ctx: RunContext): ClaudeProcess {
  const mcpConfig = { mcpServers: { odaja: { command: "bun", args: [MCP_SERVER], env: { ODAJA_URL: ctx.odajaUrl } } } };
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Only Odaja's tools: no shell or file tools, nothing that needs a prompt.
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify(mcpConfig),
    "--allowedTools", "mcp__odaja__*",
    "--permission-mode", "dontAsk",
    "--append-system-prompt", SYSTEM_PROMPT,
    ...(conv.model && conv.model !== "default" ? ["--model", conv.model] : []),
    ...(conv.state.claudeCodeSession ? ["--resume", conv.state.claudeCodeSession] : []),
  ];
  // Use the subscription: an API key in the environment would take priority
  // in headless mode and bill the key instead.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const proc = spawn("claude", args, { cwd: ctx.projectDir, env });
  const entry: ClaudeProcess = { proc, model: conv.model, lastUsed: Date.now() };
  let buffer = "";
  let stderr = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        entry.onLine?.(JSON.parse(line));
      } catch {
        // Not JSON (shouldn't happen with stream-json); ignore.
      }
    }
  });
  proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  proc.on("exit", (code) => {
    processes.delete(conv.id);
    entry.onExit?.(`Claude Code stopped (exit ${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`);
  });
  processes.set(conv.id, entry);
  return entry;
}

async function runClaudeCode(conv: Conversation, input: UserInput, ctx: RunContext, earlier: string) {
  let entry = processes.get(conv.id);
  if (entry && entry.model !== conv.model) {
    // Model changed: restart, resuming the same session with the new model.
    entry.onExit = undefined;
    entry.proc.kill();
    processes.delete(conv.id);
    entry = undefined;
  }
  entry ??= startClaudeCode(conv, ctx);
  const current = entry;
  current.lastUsed = Date.now();

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => current.proc.kill("SIGINT");
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const finish = (err?: Error) => {
      ctx.signal.removeEventListener("abort", onAbort);
      current.onLine = undefined;
      current.onExit = undefined;
      if (err) reject(err);
      else resolve();
    };
    current.onExit = (message) => finish(ctx.signal.aborted ? undefined : new Error(message));
    current.onLine = (msg) => {
      if (typeof msg.session_id === "string") conv.state.claudeCodeSession = msg.session_id;
      if (msg.type === "system" && msg.subtype === "init") {
        const servers = (msg.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
        const odaja = servers.find((s) => s.name === "odaja");
        if (odaja && odaja.status !== "connected") ctx.emit({ type: "error", message: `Odaja's tools didn't connect (${odaja.status}). Is bun installed?` });
      } else if (msg.type === "stream_event") {
        const event = msg.event as { type: string; delta?: { type: string; text?: string } };
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) ctx.emit({ type: "text", delta: event.delta.text });
      } else if (msg.type === "assistant" && !msg.parent_tool_use_id) {
        const content = ((msg.message as { content?: unknown[] })?.content ?? []) as { type: string; id?: string; name?: string; input?: unknown }[];
        for (const block of content) {
          if (block.type === "tool_use") ctx.emit({ type: "tool-start", id: block.id!, name: block.name!.replace(/^mcp__odaja__/, ""), input: block.input });
        }
      } else if (msg.type === "user") {
        const content = ((msg.message as { content?: unknown })?.content ?? []) as { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[];
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const text = Array.isArray(block.content)
            ? (block.content as { type: string; text?: string }[]).map((c) => (c.type === "text" ? c.text : "(image)")).join(" ")
            : String(block.content ?? "");
          ctx.emit({ type: "tool-end", id: block.tool_use_id!, ok: !block.is_error, summary: text.slice(0, 300) });
        }
      } else if (msg.type === "result") {
        if (msg.is_error && !ctx.signal.aborted) {
          ctx.emit({ type: "error", message: String(msg.result ?? msg.subtype ?? "Claude Code reported an error") });
        }
        finish();
      }
    };
    const line = {
      type: "user",
      message: {
        role: "user",
        content: [
          ...input.images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } })),
          { type: "text", text: withEarlier(input.text, earlier) },
        ],
      },
      parent_tool_use_id: null,
    };
    current.proc.stdin.write(JSON.stringify(line) + "\n");
  });
}
