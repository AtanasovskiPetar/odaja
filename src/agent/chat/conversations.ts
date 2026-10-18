// Saved conversations live with the home, in .odaja/chats/<id>.json (through
// the platform: browser storage on the website, the project folder in the
// companion). A conversation keeps a display transcript (turns) plus the
// provider's own message history, so it can continue exactly where it left off.
import { platform } from "../../platform";
import type { ChatSummary, Conversation, ImageInput, Turn } from "./types";

export async function saveConversation(c: Conversation) {
  await platform.chats.write(c.id, JSON.stringify(c));
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  const text = await platform.chats.read(id);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export const deleteConversation = (id: string) => platform.chats.remove(id);

export async function listConversations(): Promise<ChatSummary[]> {
  const ids = await platform.chats.list().catch(() => []);
  const items = await Promise.all(ids.map(loadConversation));
  return items
    .filter((c) => c !== null)
    .map((c) => ({ id: c.id, title: c.title, provider: c.provider, model: c.model, updatedAt: c.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function newConversation(provider: string, model: string): Conversation {
  const now = Date.now();
  return { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title: "New chat", provider, model, createdAt: now, updatedAt: now, turns: [], state: {} };
}

// Every photo shared in a conversation, in order: photo-1, photo-2, …
export function conversationPhotos(c: Conversation): ImageInput[] {
  return c.turns.flatMap((t) => (t.role === "user" ? (t.images ?? []) : []));
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
