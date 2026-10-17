// HTTP routes for the in-app chat, mounted under /api/chat by the dev server.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolContext } from "../tools";
import { conversationPhotos, deleteConversation, listConversations, liveConversations, loadConversation, newConversation, saveConversation, type ImageInput } from "./conversations";
import { listModels, listProviders } from "./models";
import { runTurn, type ChatEvent } from "./runners";
import { readSettings, writeSettings, type ProviderId } from "./settings";

const PROVIDERS: ProviderId[] = ["claude-code", "anthropic", "openai", "google", "openrouter", "ollama", "lmstudio"];
const running = new Map<string, AbortController>();

interface Deps {
  projectDir(): string | null;
  // Tool context for a given chat (so tools can use the chat's photos).
  toolsFor(chatId: string): ToolContext;
  odajaUrl(): string;
  json(): Promise<Record<string, unknown>>;
  send(status: number, body: unknown): void;
}

function requireProject(deps: Deps) {
  const dir = deps.projectDir();
  if (!dir) throw Object.assign(new Error("no project is open"), { status: 409 });
  return dir;
}

function asProvider(value: unknown): ProviderId {
  if (!PROVIDERS.includes(value as ProviderId)) throw Object.assign(new Error(`unknown provider ${String(value)}`), { status: 400 });
  return value as ProviderId;
}

// Returns false if the route isn't a chat route.
export async function handleChat(route: string, url: URL, req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<boolean> {
  switch (route) {
    case "GET /chat/providers": {
      const settings = await readSettings();
      deps.send(200, { providers: await listProviders(settings), defaultModel: settings.defaultModel ?? null });
      return true;
    }
    case "GET /chat/models": {
      const provider = asProvider(url.searchParams.get("provider"));
      try {
        deps.send(200, { models: await listModels(provider, await readSettings()) });
      } catch (err) {
        deps.send(200, { models: [], error: (err as Error).message });
      }
      return true;
    }
    case "PUT /chat/settings": {
      const body = await deps.json();
      const settings = await readSettings();
      if (body.provider) {
        const provider = asProvider(body.provider);
        if (typeof body.key === "string") {
          if (body.key.trim()) settings.keys[provider] = body.key.trim();
          else delete settings.keys[provider];
        }
        if (typeof body.baseUrl === "string") {
          if (body.baseUrl.trim()) settings.baseUrls[provider] = body.baseUrl.trim();
          else delete settings.baseUrls[provider];
        }
      }
      if (body.defaultModel && typeof body.defaultModel === "object") {
        const d = body.defaultModel as { provider: unknown; model: unknown };
        settings.defaultModel = { provider: asProvider(d.provider), model: String(d.model ?? "") };
      }
      await writeSettings(settings);
      deps.send(200, { ok: true });
      return true;
    }
    case "GET /chat/list":
      deps.send(200, { chats: await listConversations(requireProject(deps)) });
      return true;
    case "GET /chat/get":
      deps.send(200, await loadConversation(requireProject(deps), String(url.searchParams.get("id"))));
      return true;
    case "POST /chat/delete": {
      const { id } = await deps.json();
      await deleteConversation(requireProject(deps), String(id));
      deps.send(200, { ok: true });
      return true;
    }
    case "POST /chat/stop": {
      const { id } = await deps.json();
      running.get(String(id))?.abort();
      deps.send(200, { ok: true });
      return true;
    }
    case "POST /chat/send": {
      const projectDir = requireProject(deps);
      const body = await deps.json();
      const provider = asProvider(body.provider);
      const model = String(body.model ?? "");
      const text = String(body.text ?? "").trim();
      const images = (Array.isArray(body.images) ? body.images : []) as ImageInput[];
      if (!text && images.length === 0) return deps.send(400, { error: "empty message" }), true;
      const conv = body.id ? await loadConversation(projectDir, String(body.id)) : newConversation(provider, model);
      if (running.has(conv.id)) return deps.send(409, { error: "this chat is still answering" }), true;
      conv.provider = provider;
      conv.model = model;
      if (conv.turns.length === 0) conv.title = (text || "Image").slice(0, 60);
      // Name new photos so the model can refer to them in tools.
      const before = conversationPhotos(conv).length;
      const names = images.map((_, i) => `photo-${before + i + 1}`);
      conv.turns.push({ role: "user", text, images: images.length ? images : undefined, at: Date.now() });
      liveConversations.set(conv.id, conv);
      const modelText = names.length
        ? `${text}\n\n[Attached: ${names.join(", ")}. To use a photo for a texture, pass these names to edit_photo or save_texture.]`
        : text;

      // Stream events to the app as server-sent events.
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const write = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      write({ type: "chat", id: conv.id, title: conv.title });

      const controller = new AbortController();
      running.set(conv.id, controller);
      req.on("close", () => {
        // The app closed the stream (e.g. reload); keep going and save.
      });
      const errors: string[] = [];
      const emit = (e: ChatEvent) => {
        if (e.type === "error") errors.push(e.message);
        write(e);
      };
      let items: Awaited<ReturnType<typeof runTurn>> = [];
      try {
        items = await runTurn(conv, { text: modelText, images }, {
          emit,
          signal: controller.signal,
          tools: deps.toolsFor(conv.id),
          settings: await readSettings(),
          projectDir,
          odajaUrl: deps.odajaUrl(),
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = (err as Error).message || String(err);
          errors.push(message);
          write({ type: "error", message });
        }
      } finally {
        running.delete(conv.id);
        liveConversations.delete(conv.id);
      }
      conv.turns.push({
        role: "assistant",
        provider,
        model,
        items,
        error: controller.signal.aborted ? "Stopped." : errors.join(" ") || undefined,
        at: Date.now(),
      });
      conv.updatedAt = Date.now();
      await saveConversation(projectDir, conv);
      write({ type: "done" });
      res.end();
      return true;
    }
  }
  return false;
}
