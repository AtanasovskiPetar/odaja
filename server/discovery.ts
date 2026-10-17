// Where a running Odaja can be found. The standalone server writes its
// address to ~/.odaja/server.json when it starts and removes it when it stops,
// so MCP clients (Claude Code, Claude Desktop) reach it whatever port it got.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// A custom ODAJA_HOME (tests) keeps its own file, like the recent-projects state.
export const DISCOVERY_FILE = process.env.ODAJA_HOME
  ? path.join(path.resolve(process.env.ODAJA_HOME), ".odaja-server.json")
  : path.join(os.homedir(), ".odaja", "server.json");

interface Announcement {
  url: string;
  pid: number;
  startedAt: string;
}

export async function announce(url: string) {
  const entry: Announcement = { url, pid: process.pid, startedAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(DISCOVERY_FILE), { recursive: true });
  await fs.writeFile(DISCOVERY_FILE, JSON.stringify(entry, null, 2) + "\n");
}

// Only removes the file if it is still ours (another Odaja may have started since).
export async function retract() {
  const current = await read();
  if (current?.pid === process.pid) await fs.rm(DISCOVERY_FILE, { force: true });
}

async function read(): Promise<Announcement | null> {
  try {
    return JSON.parse(await fs.readFile(DISCOVERY_FILE, "utf8"));
  } catch {
    return null;
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else, still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// The address of the Odaja running on this machine, if any.
export async function findRunningOdaja(): Promise<string | null> {
  const entry = await read();
  return entry && alive(entry.pid) ? entry.url : null;
}
