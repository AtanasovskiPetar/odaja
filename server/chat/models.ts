// Which model providers are available, and which models each offers.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { claudeCommand } from "../env";
import { baseUrl, type ChatSettings, type ProviderId } from "./settings";

const run = promisify(execFile);

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: "subscription" | "api-key" | "local";
  // Set up enough to use (key present, CLI logged in, server URL known).
  ready: boolean;
  status: string;
  keyHint?: string; // last characters of the saved key
  baseUrl?: string;
  commandPath?: string; // Claude Code: the path set by hand, if any
  defaultModel: string; // "" = first model in the list
}

export interface ModelInfo {
  id: string;
  name: string;
  vision?: boolean; // can see images (photos, screenshots)
  tools?: boolean; // can call Odaja's tools
}

const hint = (key?: string) => (key ? `…${key.slice(-4)}` : undefined);

export async function claudeCodeStatus(): Promise<{ installed: boolean; loggedIn: boolean; detail: string }> {
  const claude = await claudeCommand();
  try {
    const { stdout: version } = await run(claude, ["--version"], { timeout: 10000 });
    try {
      const { stdout } = await run(claude, ["auth", "status"], { timeout: 10000 });
      const status = JSON.parse(stdout);
      if (status.authMethod === "claude.ai") {
        return { installed: true, loggedIn: true, detail: `${version.trim()} · ${status.subscriptionType ?? "subscription"}${status.orgName ? ` · ${status.orgName}` : ""}` };
      }
      return { installed: true, loggedIn: false, detail: `Signed in with ${status.authMethod ?? "unknown"}, not a Claude subscription. Run "claude auth login".` };
    } catch {
      return { installed: true, loggedIn: false, detail: 'Not signed in. Run "claude auth login" in a terminal.' };
    }
  } catch {
    return {
      installed: false,
      loggedIn: false,
      detail: claude === "claude" ? "Claude Code wasn't found. Install it, or set where it is below." : `No Claude Code at ${claude}.`,
    };
  }
}

export async function listProviders(settings: ChatSettings): Promise<ProviderInfo[]> {
  const cc = await claudeCodeStatus();
  const keyed = (id: ProviderId, name: string, defaultModel: string): ProviderInfo => ({
    id,
    name,
    kind: "api-key",
    ready: !!settings.keys[id],
    status: settings.keys[id] ? "API key saved" : "Add an API key in settings",
    keyHint: hint(settings.keys[id]),
    defaultModel,
  });
  return [
    { id: "claude-code", name: "Claude Code (your subscription)", kind: "subscription", ready: cc.loggedIn, status: cc.detail, commandPath: settings.claudePath, defaultModel: "default" },
    keyed("anthropic", "Anthropic API", "claude-opus-5-5"),
    keyed("openai", "OpenAI API", ""),
    keyed("google", "Google Gemini API", ""),
    keyed("openrouter", "OpenRouter", ""),
    { id: "ollama", name: "Ollama (local)", kind: "local", ready: true, status: "Runs models on this Mac", baseUrl: baseUrl(settings, "ollama"), defaultModel: "" },
    { id: "lmstudio", name: "LM Studio (local)", kind: "local", ready: true, status: "Runs models on this Mac", baseUrl: baseUrl(settings, "lmstudio"), defaultModel: "" },
  ];
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
    case "claude-code":
      return [
        { id: "default", name: "Default (your Claude Code setting)", vision: true, tools: true },
        { id: "opus", name: "Opus (latest)", vision: true, tools: true },
        { id: "sonnet", name: "Sonnet (latest)", vision: true, tools: true },
        { id: "haiku", name: "Haiku (latest)", vision: true, tools: true },
        { id: "fable", name: "Fable (if your plan includes it)", vision: true, tools: true },
      ];
    case "anthropic": {
      if (!key) return [];
      const client = new Anthropic({ apiKey: key });
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
      const data = await getJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
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
      const data = await getJson(`${baseUrl(settings, "ollama")}/api/tags`).catch(() => {
        throw new Error(`Ollama isn't running at ${baseUrl(settings, "ollama")}.`);
      });
      return (data.models as { name: string }[]).map((m) => ({ id: m.name, name: m.name }));
    }
    case "lmstudio": {
      const data = await getJson(`${baseUrl(settings, "lmstudio")}/v1/models`).catch(() => {
        throw new Error(`LM Studio's server isn't running at ${baseUrl(settings, "lmstudio")}.`);
      });
      return (data.data as { id: string }[]).map((m) => ({ id: m.id, name: m.id }));
    }
  }
}
