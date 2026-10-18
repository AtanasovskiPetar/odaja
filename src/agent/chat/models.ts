// Which model providers are available, and which models each offers. Called
// from the page, straight to each provider (they all accept browser calls).
import Anthropic from "@anthropic-ai/sdk";
import { baseUrl, type ChatSettings } from "./settings";
import type { ModelInfo, ProviderId, ProviderInfo } from "./types";

const hint = (key?: string) => (key ? `…${key.slice(-4)}` : undefined);

// Whether a local model server answers (quickly: it's on this computer).
async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok;
  } catch {
    return false;
  }
}

// Local servers count as set up only when they answer; a page can't tell
// "not running" from "not allowing this site", so the status says both.
export async function listProviders(settings: ChatSettings): Promise<ProviderInfo[]> {
  const [ollama, lmstudio] = await Promise.all([answers(`${baseUrl(settings, "ollama")}/api/tags`), answers(`${baseUrl(settings, "lmstudio")}/v1/models`)]);
  const keyed = (id: ProviderId, name: string, defaultModel: string): ProviderInfo => ({
    id,
    name,
    kind: "api-key",
    ready: !!settings.keys[id],
    status: settings.keys[id] ? "API key saved" : "No key yet",
    keyHint: hint(settings.keys[id]),
    defaultModel,
  });
  const local = (id: ProviderId, name: string, running: boolean): ProviderInfo => ({
    id,
    name,
    kind: "local",
    ready: running,
    status: running ? `Running at ${baseUrl(settings, id)}` : `No answer at ${baseUrl(settings, id)}: not running, or not allowing this site`,
    baseUrl: baseUrl(settings, id),
    defaultModel: "",
  });
  return [
    keyed("anthropic", "Anthropic API", "claude-opus-5-5"),
    keyed("openai", "OpenAI API", ""),
    keyed("google", "Google Gemini API", ""),
    keyed("openrouter", "OpenRouter", ""),
    local("ollama", "Ollama (local)", ollama),
    local("lmstudio", "LM Studio (local)", lmstudio),
  ];
}

// Why a local server didn't answer. A page can only reach it if the server
// allows the page's address (CORS); localhost addresses are allowed by Ollama
// already, the website isn't.
export function localServerHelp(provider: "ollama" | "lmstudio", url: string): string {
  const origin = location.origin;
  if (provider === "ollama") {
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    return `Ollama didn't answer at ${url}. Is it running?${allowed ? "" : ` It also has to allow this site: quit Ollama, then start it with OLLAMA_ORIGINS=${origin} (on a Mac: launchctl setenv OLLAMA_ORIGINS "${origin}", then reopen Ollama). If the browser asks to access devices on your local network, allow it.`}`;
  }
  return `LM Studio's server didn't answer at ${url}. Start it in LM Studio's Developer tab and turn on "Enable CORS" in its settings. If the browser asks to access devices on your local network, allow it.`;
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Models a provider offers, newest/most relevant first where the API says so.
export async function listModels(provider: ProviderId, settings: ChatSettings): Promise<ModelInfo[]> {
  const key = settings.keys[provider];
  switch (provider) {
    case "anthropic": {
      if (!key) return [];
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      const models: ModelInfo[] = [];
      for await (const m of client.models.list()) models.push({ id: m.id, name: m.display_name, vision: true, tools: true });
      return models;
    }
    case "openai": {
      if (!key) return [];
      const data = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` });
      return (data.data as { id: string; created: number }[])
        .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct)/.test(m.id))
        .sort((a, b) => b.created - a.created)
        .map((m) => ({ id: m.id, name: m.id, tools: true, vision: true }));
    }
    case "google": {
      if (!key) return [];
      const data = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
      return (data.models as { name: string; displayName: string; supportedGenerationMethods: string[] }[])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && m.name.includes("gemini") && !/(embedding|image|tts|audio)/.test(m.name))
        .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName, tools: true, vision: true }));
    }
    case "openrouter": {
      const data = await getJson("https://openrouter.ai/api/v1/models");
      return (data.data as { id: string; name: string; supported_parameters?: string[]; architecture?: { input_modalities?: string[] } }[])
        .filter((m) => m.supported_parameters?.includes("tools"))
        .map((m) => ({ id: m.id, name: m.name, tools: true, vision: m.architecture?.input_modalities?.includes("image") ?? false }));
    }
    case "ollama": {
      const url = baseUrl(settings, "ollama");
      const data = await getJson(`${url}/api/tags`).catch(() => {
        throw new Error(localServerHelp("ollama", url));
      });
      return (data.models as { name: string }[]).map((m) => ({ id: m.name, name: m.name }));
    }
    case "lmstudio": {
      const url = baseUrl(settings, "lmstudio");
      const data = await getJson(`${url}/v1/models`).catch(() => {
        throw new Error(localServerHelp("lmstudio", url));
      });
      return (data.data as { id: string }[]).map((m) => ({ id: m.id, name: m.id }));
    }
  }
}
