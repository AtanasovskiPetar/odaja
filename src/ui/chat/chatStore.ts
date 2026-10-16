// State of the in-app chat: providers and models, conversations, and the
// reply being streamed in.
import { create } from "zustand";

export type ProviderId = "claude-code" | "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "lmstudio";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: "subscription" | "api-key" | "local";
  ready: boolean;
  status: string;
  keyHint?: string;
  baseUrl?: string;
  defaultModel: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  vision?: boolean;
  tools?: boolean;
}

export interface ImageInput {
  mimeType: string;
  data: string;
}

export type AssistantItem =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; ok?: boolean; summary?: string };

export type Turn =
  | { role: "user"; text: string; images?: ImageInput[]; at: number }
  | { role: "assistant"; provider: ProviderId; model: string; items: AssistantItem[]; error?: string; at: number };

export interface ChatSummary {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  updatedAt: number;
}

interface ChatState {
  open: boolean;
  settingsOpen: boolean;
  providers: ProviderInfo[];
  provider: ProviderId | null;
  model: string;
  models: ModelInfo[];
  modelsError: string | null;
  chats: ChatSummary[];
  chatId: string | null;
  turns: Turn[];
  busy: boolean;
  toggle(): void;
  setSettingsOpen(open: boolean): void;
  init(): Promise<void>;
  loadProviders(): Promise<void>;
  selectProvider(provider: ProviderId): Promise<void>;
  selectModel(model: string): void;
  refreshChats(): Promise<void>;
  openChat(id: string | null): Promise<void>;
  deleteChat(id: string): Promise<void>;
  send(text: string, images: ImageInput[]): Promise<void>;
  stop(): Promise<void>;
}

const MODEL_KEY = "odaja:chat-model";

function remembered(): { provider: ProviderId; model: string } | null {
  try {
    return JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null");
  } catch {
    return null;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${res.status}`);
  return res.json();
}

const post = (path: string, body: unknown) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const useChat = create<ChatState>((set, get) => {
  // Apply one streamed event to the reply being built (the last turn).
  function applyEvent(e: { type: string; [k: string]: unknown }) {
    set((s) => {
      const turns = [...s.turns];
      const last = turns.at(-1);
      if (!last || last.role !== "assistant") return s;
      const items = [...last.items];
      if (e.type === "text") {
        const prev = items.at(-1);
        if (prev?.type === "text") items[items.length - 1] = { ...prev, text: prev.text + String(e.delta) };
        else items.push({ type: "text", text: String(e.delta) });
      } else if (e.type === "tool-start") {
        items.push({ type: "tool", id: String(e.id), name: String(e.name), input: e.input });
      } else if (e.type === "tool-end") {
        const i = items.findIndex((x) => x.type === "tool" && x.id === e.id);
        if (i !== -1) items[i] = { ...(items[i] as Extract<AssistantItem, { type: "tool" }>), ok: Boolean(e.ok), summary: String(e.summary) };
      } else if (e.type === "error") {
        turns[turns.length - 1] = { ...last, items, error: [last.error, String(e.message)].filter(Boolean).join(" ") };
        return { turns };
      }
      turns[turns.length - 1] = { ...last, items };
      return { turns };
    });
  }

  return {
    open: false,
    settingsOpen: false,
    providers: [],
    provider: null,
    model: "",
    models: [],
    modelsError: null,
    chats: [],
    chatId: null,
    turns: [],
    busy: false,

    toggle() {
      const open = !get().open;
      set({ open });
      if (open && get().providers.length === 0) get().init();
    },

    setSettingsOpen(settingsOpen) {
      set({ settingsOpen });
      if (!settingsOpen) get().loadProviders();
    },

    async init() {
      await get().loadProviders();
      await get().refreshChats();
    },

    async loadProviders() {
      const { providers, defaultModel } = await api<{ providers: ProviderInfo[]; defaultModel: { provider: ProviderId; model: string } | null }>("/chat/providers");
      set({ providers });
      // Keep the current choice; otherwise the last used, the saved default,
      // or the first provider that's ready (Claude Code if available).
      if (get().provider) return;
      const choice = remembered() ?? defaultModel;
      const provider = choice && providers.find((p) => p.id === choice.provider)?.ready ? choice.provider : providers.find((p) => p.ready && p.kind !== "local")?.id ?? providers[0]?.id;
      if (provider) {
        await get().selectProvider(provider);
        if (choice?.provider === provider && choice.model) get().selectModel(choice.model);
      }
    },

    async selectProvider(provider) {
      set({ provider, models: [], modelsError: null });
      const { models, error } = await api<{ models: ModelInfo[]; error?: string }>(`/chat/models?provider=${provider}`);
      if (get().provider !== provider) return;
      const info = get().providers.find((p) => p.id === provider);
      const model = models.find((m) => m.id === info?.defaultModel)?.id ?? models[0]?.id ?? "";
      set({ models, modelsError: error ?? null });
      get().selectModel(model);
    },

    selectModel(model) {
      set({ model });
      const provider = get().provider;
      try {
        if (provider && model) localStorage.setItem(MODEL_KEY, JSON.stringify({ provider, model }));
      } catch {
        // No storage: just don't remember.
      }
    },

    async refreshChats() {
      try {
        const { chats } = await api<{ chats: ChatSummary[] }>("/chat/list");
        set({ chats });
      } catch {
        set({ chats: [] });
      }
    },

    async openChat(id) {
      if (!id) {
        set({ chatId: null, turns: [] });
        return;
      }
      const chat = await api<{ id: string; turns: Turn[]; provider: ProviderId; model: string }>(`/chat/get?id=${encodeURIComponent(id)}`);
      set({ chatId: chat.id, turns: chat.turns });
    },

    async deleteChat(id) {
      await post("/chat/delete", { id });
      if (get().chatId === id) set({ chatId: null, turns: [] });
      await get().refreshChats();
    },

    async send(text, images) {
      const { provider, model, chatId, busy } = get();
      if (busy || !provider || (!text.trim() && images.length === 0)) return;
      const now = Date.now();
      set((s) => ({
        busy: true,
        turns: [...s.turns, { role: "user", text, images, at: now }, { role: "assistant", provider, model, items: [], at: now }],
      }));
      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: chatId, provider, model, text, images }),
        });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (!chunk.startsWith("data: ")) continue;
            const event = JSON.parse(chunk.slice(6));
            if (event.type === "chat") set({ chatId: event.id });
            else if (event.type !== "done") applyEvent(event);
          }
        }
      } catch (err) {
        applyEvent({ type: "error", message: (err as Error).message });
      } finally {
        set({ busy: false });
        get().refreshChats();
      }
    },

    async stop() {
      const id = get().chatId;
      if (id) await post("/chat/stop", { id });
    },
  };
});

export async function saveProviderSettings(provider: ProviderId, patch: { key?: string; baseUrl?: string }) {
  await api("/chat/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, ...patch }) });
}

export async function saveDefaultModel(provider: ProviderId, model: string) {
  await api("/chat/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultModel: { provider, model } }) });
}
