// Saved conversations, per project, in <project>/.odaja/chats/<id>.json.
// A conversation keeps a display transcript (turns) plus the provider's own
// message history, so it can continue exactly where it left off.
import fs from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelMessage } from "ai";
import type { ProviderId } from "./settings";

export interface ImageInput {
  mimeType: string;
  data: string; // base64
}

export type AssistantItem =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; ok?: boolean; summary?: string };

export type Turn =
  | { role: "user"; text: string; images?: ImageInput[]; at: number }
  | { role: "assistant"; provider: ProviderId; model: string; items: AssistantItem[]; error?: string; at: number };

export interface Conversation {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  // Provider history, in the format each connection needs.
  state: {
    family?: "anthropic" | "aisdk" | "claude-code";
    anthropic?: Anthropic.Beta.BetaMessageParam[];
    aisdk?: ModelMessage[];
    claudeCodeSession?: string;
  };
}

// Conversations currently being answered, so tools can reach their photos
// before the turn is saved.
export const liveConversations = new Map<string, Conversation>();

// Every photo shared in a conversation, in order: photo-1, photo-2, …
export function conversationPhotos(c: Conversation): ImageInput[] {
  return c.turns.flatMap((t) => (t.role === "user" ? (t.images ?? []) : []));
}

const dir = (projectDir: string) => path.join(projectDir, ".odaja", "chats");
const file = (projectDir: string, id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad chat id");
  return path.join(dir(projectDir), `${id}.json`);
};

export async function saveConversation(projectDir: string, c: Conversation) {
  await fs.mkdir(dir(projectDir), { recursive: true });
  await fs.writeFile(file(projectDir, c.id), JSON.stringify(c));
}

export async function loadConversation(projectDir: string, id: string): Promise<Conversation> {
  return JSON.parse(await fs.readFile(file(projectDir, id), "utf8"));
}

export async function deleteConversation(projectDir: string, id: string) {
  await fs.rm(file(projectDir, id), { force: true });
}

export async function listConversations(projectDir: string) {
  const files = await fs.readdir(dir(projectDir)).catch(() => [] as string[]);
  const items = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          const c: Conversation = JSON.parse(await fs.readFile(path.join(dir(projectDir), f), "utf8"));
          return { id: c.id, title: c.title, provider: c.provider, model: c.model, updatedAt: c.updatedAt };
        } catch {
          return null;
        }
      }),
  );
  return items.filter((i) => i !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function newConversation(provider: ProviderId, model: string): Conversation {
  const now = Date.now();
  return { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title: "New chat", provider, model, createdAt: now, updatedAt: now, turns: [], state: {} };
}

// Plain-text version of earlier turns, for continuing a conversation with a
// different kind of connection than it started with.
export function transcript(turns: Turn[]): string {
  return turns
    .map((t) =>
      t.role === "user"
        ? `User: ${t.text}${t.images?.length ? ` [${t.images.length} image(s)]` : ""}`
        : `Assistant: ${t.items.map((i) => (i.type === "text" ? i.text : `(used ${i.name})`)).join(" ")}`,
    )
    .join("\n\n");
}
