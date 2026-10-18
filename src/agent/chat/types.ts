// The in-app chat's data: providers and models, conversations and their turns.
// The chat runs in the page on the website and in the companion alike.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelMessage } from "ai";

export type ProviderId = "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "lmstudio";

export const PROVIDERS: ProviderId[] = ["anthropic", "openai", "google", "openrouter", "ollama", "lmstudio"];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: "api-key" | "local";
  // Set up enough to use (key present, server URL known).
  ready: boolean;
  status: string;
  keyHint?: string; // last characters of the saved key
  baseUrl?: string;
  defaultModel: string; // "" = first model in the list
}

export interface ModelInfo {
  id: string;
  name: string;
  vision?: boolean; // can see images (photos, screenshots)
  tools?: boolean; // can call Odaja's tools
}

export interface ImageInput {
  mimeType: string;
  data: string; // base64
}

export type AssistantItem =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; ok?: boolean; summary?: string };

// `provider` is a string: chats saved by older versions may name connections
// that no longer exist ("claude-code").
export type Turn =
  | { role: "user"; text: string; images?: ImageInput[]; at: number }
  | { role: "assistant"; provider: string; model: string; items: AssistantItem[]; error?: string; at: number };

export interface Conversation {
  id: string;
  title: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  // Provider history, in the format each connection needs.
  state: {
    family?: string;
    anthropic?: Anthropic.Beta.BetaMessageParam[];
    aisdk?: ModelMessage[];
  };
}

export interface ChatSummary {
  id: string;
  title: string;
  provider: string;
  model: string;
  updatedAt: number;
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool-start"; id: string; name: string; input: unknown }
  | { type: "tool-end"; id: string; ok: boolean; summary: string }
  | { type: "error"; message: string }
  // A passing note while the reply waits (e.g. for a rate limit); null clears it.
  | { type: "status"; message: string | null };
