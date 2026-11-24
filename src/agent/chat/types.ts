// The in-app chat's data: providers and models, conversations and their turns.
// The chat runs in the page on the website and in the companion alike.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelMessage } from "ai";

// "claude-code" is the user's Claude subscription, through the companion only.
// "odaja" is Odaja's own AI on the cloud server, paid with credits.
export type ProviderId = "claude-code" | "odaja" | "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "lmstudio";

export const PROVIDERS: ProviderId[] = ["claude-code", "odaja", "anthropic", "openai", "google", "openrouter", "ollama", "lmstudio"];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: "subscription" | "credits" | "api-key" | "local";
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
  | { role: "assistant"; provider: string; model: string; items: AssistantItem[]; error?: string; notice?: AiNotice; at: number };

// Why Odaja's AI couldn't (go on) answering, with what the user can do about it.
export type AiNotice =
  | { kind: "no-credits" | "ceiling"; nextAllowance?: number | null; topUpUrl?: string | null }
  | { kind: "verify-email" | "sign-in" | "local-home" };

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
    // Claude Code keeps the history itself; this continues its session.
    claudeCodeSession?: string;
    // Odaja's AI: the history in the Anthropic format, run by the cloud server.
    odaja?: Anthropic.Beta.BetaMessageParam[];
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
  | { type: "status"; message: string | null }
  | { type: "notice"; notice: AiNotice };

// A reply from Odaja's AI, from the cloud server to the tab that asked
// (backend/ai/turn.ts): the chat's events, plus requests for the tab.
export type HostedEvent =
  | ChatEvent
  // Take a screenshot and answer POST /api/v1/ai/screenshot; `changed`: files
  // changed since the last one, to reload first so the picture is current.
  | { type: "screenshot"; id: string; view: "plan" | "3d"; level?: string; changed: string[] }
  | { type: "open-scene"; path: string }
  // The account ran out of credits (or hit its monthly ceiling) part way.
  | { type: "limit"; kind: "no-credits" | "ceiling" }
  // The end: the messages to add to the conversation, and the credits left.
  | { type: "done"; messages: Anthropic.Beta.BetaMessageParam[]; balance: number | null };
