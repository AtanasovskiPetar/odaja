// Chat settings: API keys, local model servers, the default model. Stored on
// this Mac only (never in project folders, which agents and git can read),
// readable by the user alone.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ProviderId = "claude-code" | "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "lmstudio";

export interface ChatSettings {
  keys: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
  defaultModel?: { provider: ProviderId; model: string };
  // Where Claude Code is, when it isn't found by itself.
  claudePath?: string;
}

export const SETTINGS_FILE = process.env.ODAJA_HOME
  ? path.join(path.resolve(process.env.ODAJA_HOME), ".odaja-settings.json")
  : path.join(os.homedir(), ".odaja", "settings.json");

export const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234",
};

export async function readSettings(): Promise<ChatSettings> {
  try {
    const s = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8"));
    return { keys: s.keys ?? {}, baseUrls: s.baseUrls ?? {}, defaultModel: s.defaultModel, claudePath: s.claudePath };
  } catch {
    return { keys: {}, baseUrls: {} };
  }
}

export async function writeSettings(settings: ChatSettings) {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  await fs.chmod(SETTINGS_FILE, 0o600);
}

export function baseUrl(settings: ChatSettings, provider: ProviderId): string {
  return (settings.baseUrls[provider] ?? DEFAULT_BASE_URLS[provider] ?? "").replace(/\/$/, "");
}
