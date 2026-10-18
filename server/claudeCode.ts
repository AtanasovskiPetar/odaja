// The chat's "Claude Code (your subscription)" connection, in the companion
// only: a web page can't start programs, so the page asks the companion to
// run the user's own installed, signed-in Claude Code in headless stream-json
// mode, with only Odaja's MCP tools, and streams what happens back.
//
// For personal use: it runs on the user's subscription, on their machine.
// API keys are removed from its environment so the subscription is used.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { SYSTEM_PROMPT } from "../src/agent/chat/prompt";
import type { ChatEvent, ImageInput } from "../src/agent/chat/types";
import { claudeCommand, mcpCommand } from "./env";

const run = promisify(execFile);

export interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  detail: string;
}

export async function claudeCodeStatus(): Promise<ClaudeCodeStatus> {
  const claude = await claudeCommand();
  try {
    const { stdout: version } = await run(claude, ["--version"], { timeout: 10000 });
    try {
      const { stdout } = await run(claude, ["auth", "status"], { timeout: 10000 });
      const status = JSON.parse(stdout);
      if (status.authMethod === "claude.ai") {
        return { installed: true, loggedIn: true, detail: `${version.trim()} · ${status.subscriptionType ?? "subscription"}` };
      }
      return { installed: true, loggedIn: false, detail: `Signed in with ${status.authMethod ?? "something else"}, not a Claude subscription. Run "claude auth login" in a terminal.` };
    } catch {
      return { installed: true, loggedIn: false, detail: 'Not signed in. Run "claude auth login" in a terminal.' };
    }
  } catch {
    return {
      installed: false,
      loggedIn: false,
      detail: claude === "claude" ? "Claude Code wasn't found on this computer. Install it, or set ODAJA_CLAUDE to where it is." : `No Claude Code at ${claude}.`,
    };
  }
}

export interface TurnRequest {
  chatId: string;
  model: string;
  // Claude Code's session for this conversation, to continue it.
  session?: string;
  text: string;
  images: ImageInput[];
}

interface ClaudeProcess {
  proc: ChildProcessWithoutNullStreams;
  model: string;
  lastUsed: number;
  onLine?: (msg: Record<string, unknown>) => void;
  onExit?: (message: string) => void;
}

const processes = new Map<string, ClaudeProcess>();
// Every photo shared in a running conversation, for the photo tools (the MCP
// server passes the chat id along with each tool call).
export const chatPhotos = new Map<string, ImageInput[]>();

// Idle sessions close after a while; they resume when needed.
setInterval(() => {
  for (const [id, p] of processes) {
    if (Date.now() - p.lastUsed > 15 * 60 * 1000) {
      p.proc.kill();
      processes.delete(id);
      chatPhotos.delete(id);
    }
  }
}, 60 * 1000).unref();

export function stopAllClaudeCode() {
  for (const p of processes.values()) p.proc.kill();
  processes.clear();
}

export function stopClaudeCode(chatId: string) {
  processes.get(chatId)?.proc.kill("SIGINT");
}

function start(req: TurnRequest, odajaUrl: string, claude: string): ClaudeProcess {
  const mcpConfig = { mcpServers: { odaja: { ...mcpCommand(), env: { ODAJA_URL: odajaUrl, ODAJA_CHAT_ID: req.chatId } } } };
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
    ...(req.model && req.model !== "default" ? ["--model", req.model] : []),
    ...(req.session ? ["--resume", req.session] : []),
  ];
  // Use the subscription: an API key in the environment would take priority
  // in headless mode and bill the key instead.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const proc = spawn(claude, args, { env, cwd: process.env.HOME });
  const entry: ClaudeProcess = { proc, model: req.model, lastUsed: Date.now() };
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
    if (processes.get(req.chatId) === entry) processes.delete(req.chatId);
    entry.onExit?.(`Claude Code stopped (exit ${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`);
  });
  processes.set(req.chatId, entry);
  return entry;
}

// Runs one turn, reporting events as they happen. Resolves with the session
// id to continue the conversation next time.
export async function runClaudeCodeTurn(req: TurnRequest, odajaUrl: string, emit: (e: ChatEvent) => void): Promise<string | undefined> {
  let entry = processes.get(req.chatId);
  if (entry && entry.model !== req.model) {
    // Model changed: restart, resuming the same session with the new model.
    entry.onExit = undefined;
    entry.proc.kill();
    processes.delete(req.chatId);
    entry = undefined;
  }
  entry ??= start(req, odajaUrl, await claudeCommand());
  const current = entry;
  current.lastUsed = Date.now();
  let session = req.session;

  await new Promise<void>((resolve, reject) => {
    let stopped = false;
    const finish = (err?: Error) => {
      current.onLine = undefined;
      current.onExit = undefined;
      if (err && !stopped) reject(err);
      else resolve();
    };
    current.onExit = (message) => {
      // SIGINT from Stop also ends the process: that's not an error.
      stopped = current.proc.signalCode === "SIGINT";
      finish(new Error(message));
    };
    current.onLine = (msg) => {
      if (typeof msg.session_id === "string") session = msg.session_id;
      if (msg.type === "system" && msg.subtype === "init") {
        const servers = (msg.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
        const odaja = servers.find((s) => s.name === "odaja");
        if (odaja && odaja.status !== "connected") emit({ type: "error", message: `Odaja's tools didn't connect to Claude Code (${odaja.status}).` });
      } else if (msg.type === "stream_event") {
        const event = msg.event as { type: string; delta?: { type: string; text?: string } };
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) emit({ type: "text", delta: event.delta.text });
      } else if (msg.type === "assistant" && !msg.parent_tool_use_id) {
        const content = ((msg.message as { content?: unknown[] })?.content ?? []) as { type: string; id?: string; name?: string; input?: unknown }[];
        for (const block of content) {
          if (block.type === "tool_use") emit({ type: "tool-start", id: block.id!, name: block.name!.replace(/^mcp__odaja__/, ""), input: block.input });
        }
      } else if (msg.type === "user") {
        const content = ((msg.message as { content?: unknown })?.content ?? []) as { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[];
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const text = Array.isArray(block.content)
            ? (block.content as { type: string; text?: string }[]).map((c) => (c.type === "text" ? c.text : "(image)")).join(" ")
            : String(block.content ?? "");
          emit({ type: "tool-end", id: block.tool_use_id!, ok: !block.is_error, summary: text.slice(0, 300) });
        }
      } else if (msg.type === "result") {
        if (msg.is_error) emit({ type: "error", message: String(msg.result ?? msg.subtype ?? "Claude Code reported an error") });
        finish();
      }
    };
    const line = {
      type: "user",
      message: {
        role: "user",
        content: [
          ...req.images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } })),
          { type: "text", text: req.text },
        ],
      },
      parent_tool_use_id: null,
    };
    current.proc.stdin.write(JSON.stringify(line) + "\n");
  });
  return session;
}
