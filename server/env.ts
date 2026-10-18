// What the server needs from the machine it runs on: whether it is the
// packaged binary, a usable PATH, and how to start Claude Code and the MCP server.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

// Modules inside a `bun build --compile` binary live in Bun's virtual file
// system (/$bunfs/… on macOS and Linux, B:\~BUN\… on Windows).
export const isCompiled = import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN");

// Programs started from the Dock or Finder get a bare PATH (/usr/bin:/bin:…),
// not the one your terminal has, so `claude` (and the node it runs on) wouldn't
// be found. Ask your login shell for its PATH once, and add the usual install
// places as a fallback. Windows programs get the full PATH already.
let pathLoaded: Promise<void> | null = null;
export function loadLoginShellPath(): Promise<void> {
  if (process.platform === "win32") return Promise.resolve();
  pathLoaded ??= new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    // Markers, because interactive shells may print greetings around it.
    execFile(shell, ["-ilc", 'printf "__ODAJA_PATH__%s__ODAJA_PATH__" "$PATH"'], { timeout: 5000 }, (_err, stdout) => {
      const fromShell = /__ODAJA_PATH__(.*?)__ODAJA_PATH__/s.exec(String(stdout ?? ""))?.[1].split(":") ?? [];
      const home = os.homedir();
      const usual = [
        path.join(home, ".claude", "local"),
        path.join(home, ".local", "bin"),
        path.join(home, ".bun", "bin"),
        path.join(home, ".npm-global", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ];
      const current = (process.env.PATH ?? "").split(":");
      process.env.PATH = [...new Set([...fromShell, ...current, ...usual])].filter(Boolean).join(":");
      resolve();
    });
  });
  return pathLoaded;
}

// The Claude Code command: ODAJA_CLAUDE if set, else `claude` from the (login
// shell's) PATH.
export async function claudeCommand(): Promise<string> {
  await loadLoginShellPath();
  const chosen = process.env.ODAJA_CLAUDE?.trim() || "claude";
  return chosen.replace(/^~(?=$|[/\\])/, os.homedir());
}

// How Claude Code should start Odaja's MCP server: the packaged binary is its
// own MCP server; from the repo it's mcp/server.ts run with Bun.
export function mcpCommand(): { command: string; args: string[] } {
  if (isCompiled) return { command: process.execPath, args: ["mcp"] };
  return { command: process.execPath.includes("bun") ? process.execPath : "bun", args: [path.resolve(process.env.ODAJA_APP_ROOT ?? ".", "mcp/server.ts")] };
}
