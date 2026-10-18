// State of the in-app chat: providers and models, conversations, and the
// reply being streamed in. The chat runs in the page (src/agent/chat/); the
// model code loads the first time it's needed.
import { create } from "zustand";
import { conversationPhotos, deleteConversation, listConversations, loadConversation, newConversation, saveConversation } from "../../agent/chat/conversations";
import { readSettings } from "../../agent/chat/settings";
import type { AssistantItem, ChatEvent, ChatSummary, ImageInput, ModelInfo, ProviderId, ProviderInfo, Turn } from "../../agent/chat/types";

export type { AssistantItem, ImageInput, ProviderInfo, Turn } from "../../agent/chat/types";

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
  // Text and files to put in the message box (e.g. a floor plan to build from).
  draft: { text: string; files: File[] } | null;
  toggle(): void;
  startDraft(text: string, files: File[]): void;
  takeDraft(): { text: string; files: File[] } | null;
  setSettingsOpen(open: boolean): void;
  init(): Promise<void>;
  loadProviders(): Promise<void>;
  selectProvider(provider: ProviderId): Promise<void>;
  selectModel(model: string): void;
  refreshChats(): Promise<void>;
  openChat(id: string | null): Promise<void>;
  deleteChat(id: string): Promise<void>;
  send(text: string, images: ImageInput[]): Promise<void>;
  stop(): void;
}

const MODEL_KEY = "odaja:chat-model";

function remembered(): { provider: ProviderId; model: string } | null {
  try {
    return JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null");
  } catch {
    return null;
  }
}

const models = () => import("../../agent/chat/models");

// The turn being answered, so it can be stopped.
let running: AbortController | null = null;

export const useChat = create<ChatState>((set, get) => {
  // Apply one streamed event to the reply being built (the last turn).
  function applyEvent(e: ChatEvent) {
    set((s) => {
      const turns = [...s.turns];
      const last = turns.at(-1);
      if (!last || last.role !== "assistant") return s;
      const items = [...last.items];
      if (e.type === "text") {
        const prev = items.at(-1);
        if (prev?.type === "text") items[items.length - 1] = { ...prev, text: prev.text + e.delta };
        else items.push({ type: "text", text: e.delta });
      } else if (e.type === "tool-start") {
        items.push({ type: "tool", id: e.id, name: e.name, input: e.input });
      } else if (e.type === "tool-end") {
        const i = items.findIndex((x) => x.type === "tool" && x.id === e.id);
        if (i !== -1) items[i] = { ...(items[i] as Extract<AssistantItem, { type: "tool" }>), ok: e.ok, summary: e.summary };
      } else if (e.type === "error") {
        turns[turns.length - 1] = { ...last, items, error: [last.error, e.message].filter(Boolean).join(" ") };
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
    draft: null,

    toggle() {
      const open = !get().open;
      set({ open });
      if (open && get().providers.length === 0) get().init();
    },

    startDraft(text, files) {
      set({ open: true, draft: { text, files } });
      if (get().providers.length === 0) get().init();
    },

    takeDraft() {
      const draft = get().draft;
      if (draft) set({ draft: null });
      return draft;
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
      const settings = await readSettings();
      const providers = (await models()).listProviders(settings);
      const changed = get().providers.find((p) => p.id === get().provider)?.ready !== providers.find((p) => p.id === get().provider)?.ready;
      set({ providers });
      // Keep the current choice (reloading its models if it was just set up);
      // otherwise the last used, the saved default, or the first provider
      // that's ready.
      const currentProvider = get().provider;
      if (currentProvider) {
        if (changed) await get().selectProvider(currentProvider);
        return;
      }
      const choice = remembered() ?? settings.defaultModel ?? null;
      const provider = choice && providers.find((p) => p.id === choice.provider)?.ready ? choice.provider : (providers.find((p) => p.ready && p.kind !== "local")?.id ?? providers[0]?.id);
      if (provider) {
        await get().selectProvider(provider);
        if (choice?.provider === provider && choice.model) get().selectModel(choice.model);
      }
    },

    async selectProvider(provider) {
      set({ provider, models: [], modelsError: null });
      let list: ModelInfo[] = [];
      let error: string | null = null;
      try {
        list = await (await models()).listModels(provider, await readSettings());
      } catch (err) {
        error = (err as Error).message;
      }
      if (get().provider !== provider) return;
      const info = get().providers.find((p) => p.id === provider);
      const model = list.find((m) => m.id === info?.defaultModel)?.id ?? list[0]?.id ?? "";
      set({ models: list, modelsError: error });
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
      set({ chats: await listConversations().catch(() => []) });
    },

    async openChat(id) {
      if (!id) {
        set({ chatId: null, turns: [] });
        return;
      }
      const chat = await loadConversation(id);
      if (chat) set({ chatId: chat.id, turns: chat.turns });
    },

    async deleteChat(id) {
      await deleteConversation(id);
      if (get().chatId === id) set({ chatId: null, turns: [] });
      await get().refreshChats();
    },

    async send(text, images) {
      const { provider, model, chatId, busy } = get();
      if (busy || !provider || (!text.trim() && images.length === 0)) return;
      const now = Date.now();
      set((s) => ({
        busy: true,
        turns: [...s.turns, { role: "user", text, images: images.length ? images : undefined, at: now }, { role: "assistant", provider, model, items: [], at: now }],
      }));
      const controller = new AbortController();
      running = controller;
      const errors: string[] = [];
      try {
        const conv = (chatId && (await loadConversation(chatId))) || newConversation(provider, model);
        conv.provider = provider;
        conv.model = model;
        if (conv.turns.length === 0) conv.title = (text || "Image").slice(0, 60);
        // Name new photos so the model can refer to them in tools.
        const before = conversationPhotos(conv).length;
        const names = images.map((_, i) => `photo-${before + i + 1}`);
        conv.turns.push({ role: "user", text, images: images.length ? images : undefined, at: now });
        set({ chatId: conv.id });
        // Saved straight away, so the question isn't lost if the page closes.
        await saveConversation(conv);
        get().refreshChats();
        const modelText = names.length
          ? `${text}\n\n[Attached: ${names.join(", ")}. To use a photo for a texture, pass these names to edit_photo or save_texture.]`
          : text;

        const { runTurn } = await import("../../agent/chat/runners");
        const result = await runTurn(conv, { text: modelText, images }, {
          emit(e) {
            if (e.type === "error") errors.push(e.message);
            if (get().chatId === conv.id) applyEvent(e);
          },
          signal: controller.signal,
          settings: await readSettings(),
          photos: async () => conversationPhotos(conv),
        });
        if (result.error && !controller.signal.aborted) {
          errors.push(result.error.message);
          if (get().chatId === conv.id) applyEvent({ type: "error", message: result.error.message });
        }
        conv.turns.push({
          role: "assistant",
          provider,
          model,
          items: result.items,
          error: controller.signal.aborted ? "Stopped." : errors.join(" ") || undefined,
          at: Date.now(),
        });
        conv.updatedAt = Date.now();
        await saveConversation(conv);
        if (controller.signal.aborted && get().chatId === conv.id) applyEvent({ type: "error", message: "Stopped." });
      } catch (err) {
        applyEvent({ type: "error", message: (err as Error).message });
      } finally {
        running = null;
        set({ busy: false });
        get().refreshChats();
      }
    },

    stop() {
      running?.abort();
    },
  };
});
