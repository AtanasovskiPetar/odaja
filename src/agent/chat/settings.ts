// Chat settings: API keys, local model servers, the default model. Kept in
// this browser's storage for this site only (never in homes or .odaja files),
// and sent only to the provider each key belongs to.
import { kvGet, kvSet } from "../../browser/kv";
import type { ProviderId } from "./types";

export interface ChatSettings {
  keys: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
  defaultModel?: { provider: ProviderId; model: string };
}

const KEY = "chat-settings";

export const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234",
};

export async function readSettings(): Promise<ChatSettings> {
  const s = await kvGet<Partial<ChatSettings>>(KEY);
  return { keys: s?.keys ?? {}, baseUrls: s?.baseUrls ?? {}, defaultModel: s?.defaultModel };
}

async function update(change: (s: ChatSettings) => void) {
  const settings = await readSettings();
  change(settings);
  await kvSet(KEY, settings);
}

// An empty value removes the setting.
export function saveProviderSettings(provider: ProviderId, patch: { key?: string; baseUrl?: string }) {
  return update((s) => {
    if (patch.key !== undefined) {
      if (patch.key.trim()) s.keys[provider] = patch.key.trim();
      else delete s.keys[provider];
    }
    if (patch.baseUrl !== undefined) {
      if (patch.baseUrl.trim()) s.baseUrls[provider] = patch.baseUrl.trim();
      else delete s.baseUrls[provider];
    }
  });
}

export function saveDefaultModel(provider: ProviderId, model: string) {
  return update((s) => void (s.defaultModel = { provider, model }));
}

export function baseUrl(settings: ChatSettings, provider: ProviderId): string {
  return (settings.baseUrls[provider] ?? DEFAULT_BASE_URLS[provider] ?? "").replace(/\/$/, "");
}
