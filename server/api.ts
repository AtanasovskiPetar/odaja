// Odaja's backend: the bridge between the app and project folders on disk.
// The app reads and writes the open project's files through /api/*, and gets
// a "file-changed" event (over /api/events) whenever one of them changes, so
// edits made by agents (or any editor) show up live. It also lists, creates
// and opens projects, and serves the AI tools and the chat.
//
// It doesn't depend on Vite: the dev server mounts it as middleware
// (server/project-server.ts), and server/main.ts runs it standalone.
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { newProjectFile, newSceneFile, newShellFile, slugify, type StarterRoom } from "../src/model/defaults";
import { formatJson } from "../src/model/format";
import { callTool, inputJsonSchema, TOOLS, type ToolContext } from "./tools";
import { handleChat } from "./chat/routes";
import { conversationPhotos, liveConversations, loadConversation } from "./chat/conversations";
import { stopAllClaudeCode } from "./chat/runners";

// Files that ship with the app: the format docs copied into every project,
// and the sample flat. Resolved from where Odaja runs.
const APP_ROOT = path.resolve(process.env.ODAJA_APP_ROOT ?? ".");
const AGENT_DOC_SOURCE = path.join(APP_ROOT, "docs/project-format.md");
// New projects are created here.
const PROJECTS_ROOT = path.resolve(process.env.ODAJA_HOME ?? path.join(os.homedir(), "Documents", "Odaja"));
// Your furniture library, shared by all projects.
const LIBRARY_ROOT = path.join(PROJECTS_ROOT, "Library");
const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// Remembers recently opened projects between runs. A custom ODAJA_HOME gets
// its own state, so test setups don't touch the real list.
const STATE_FILE = process.env.ODAJA_HOME
  ? path.join(PROJECTS_ROOT, ".odaja-state.json")
  : path.join(os.homedir(), ".odaja", "state.json");
const MAX_RECENT = 12;
// The sample flat in the repo. It is never opened in place: "Try the sample
// flat" copies it into the projects folder, so playing with it never changes
// the repo. Only an explicit ODAJA_PROJECT opens the original (to improve it).
const EXAMPLE_PROJECT = path.join(APP_ROOT, "examples/sample-flat");
const SAMPLE_NAME = "Sample flat";

interface State {
  recent: string[];
}

async function readState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch {
    return { recent: [] };
  }
}

async function writeState(state: State) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function isProject(dir: string) {
  return fs
    .stat(path.join(dir, "project.json"))
    .then((s) => s.isFile())
    .catch(() => false);
}

async function projectSummary(dir: string) {
  try {
    const project = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
    const stat = await fs.stat(dir);
    return { dir, name: String(project.name ?? path.basename(dir)), modified: stat.mtimeMs };
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// The API can change files, delete library items and run models on the
// user's accounts, so only Odaja itself may call it from a browser. Browsers
// attach Origin (and Sec-Fetch-Site) to cross-site requests; other websites
// the user visits are refused. Requests without them (the MCP server, curl)
// come from local programs and are allowed. Hostile domains pointed at this
// machine (DNS rebinding) are refused by the host check (Vite's in dev,
// server/main.ts's standalone).
function isLocalOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function crossSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin) return origin === "null" || !isLocalOrigin(origin);
  return req.headers["sec-fetch-site"] === "cross-site";
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface OdajaApi {
  // Handles a request whose URL is relative to /api (e.g. "/projects").
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  // Stops watching files and any chats still running.
  stop(): void;
}

// `port` is where the app is served, for the MCP server the chat starts.
export async function createOdajaApi({ port }: { port: () => number }): Promise<OdajaApi> {
  let projectDir: string | null = null;
  // The scene open in the app (reported by the app), the default for tools,
  // and the object whose shape is being edited.
  let openScenePath: string | null = null;
  let editingObject: string | null = null;
  // Open /api/events streams. Events go from here to the app; the app
  // answers over ordinary requests (/screenshot-result, /ui-state).
  const listeners = new Set<ServerResponse>();
  function broadcast(event: string, data: unknown) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) res.write(message);
  }
  const keepAlive = setInterval(() => {
    for (const res of listeners) res.write(": keep-alive\n\n");
  }, 25000);

  // Watching the open project. Editors and agents often write a file in
  // several steps, so changes are gathered for a moment and sent once.
  let projectWatcher: FSWatcher | null = null;
  const changed = new Set<string>();
  let flush: ReturnType<typeof setTimeout> | null = null;
  function watchProject(dir: string | null) {
    projectWatcher?.close();
    projectWatcher = null;
    if (!dir) return;
    projectWatcher = watch(dir, { recursive: true }, (_type, name) => {
      if (!name) return;
      changed.add(String(name).split(path.sep).join("/"));
      flush ??= setTimeout(() => {
        flush = null;
        for (const rel of changed) broadcast("file-changed", { path: rel });
        changed.clear();
      }, 40);
    });
    projectWatcher.on("error", (err) => console.warn(`[odaja] watching ${dir}: ${err.message}`));
  }

  // Screenshots requested from the app, waiting for its reply.
  const pendingShots = new Map<string, { resolve: (s: { data: string; mimeType: string }) => void; reject: (e: Error) => void }>();

  const toolContext: ToolContext = {
    projectDir: () => projectDir,
    scenePath: () => openScenePath,
    editingObject: () => editingObject,
    libraryRoot: LIBRARY_ROOT,
    screenshot(view) {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        pendingShots.set(id, { resolve, reject });
        broadcast("screenshot", { id, view });
        setTimeout(() => {
          if (pendingShots.delete(id)) reject(new Error("Odaja didn't answer; is the app open in a browser window?"));
        }, 15000);
      });
    },
    openScene(path) {
      broadcast("open-scene", { path });
    },
  };

  // Tools called from a chat can use that chat's photos.
  function toolsFor(chatId: string | undefined): ToolContext {
    if (!chatId) return toolContext;
    return {
      ...toolContext,
      async photos() {
        const live = liveConversations.get(chatId);
        if (live) return conversationPhotos(live);
        if (!projectDir) return [];
        return conversationPhotos(await loadConversation(projectDir, chatId).catch(() => ({ turns: [] }) as never));
      },
    };
  }

  function requireProject(): string {
    if (!projectDir) throw new HttpError(409, "no project is open");
    return projectDir;
  }

  // Resolve a project-relative path, refusing anything that escapes the project.
  function resolveInProject(relPath: string): string {
    const dir = requireProject();
    const abs = path.resolve(dir, relPath);
    if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new HttpError(400, `path escapes project: ${relPath}`);
    return abs;
  }

  // Every project carries the format docs, so an agent opened in the project
  // folder knows how to edit it without access to this repo.
  async function syncAgentDocs() {
    if (!projectDir) return;
    const doc = await fs.readFile(AGENT_DOC_SOURCE, "utf8");
    const targets: [string, string][] = [
      ["AGENTS.md", doc],
      ["CLAUDE.md", "@AGENTS.md\n"],
    ];
    for (const [name, content] of targets) {
      const file = path.join(projectDir, name);
      const current = await fs.readFile(file, "utf8").catch(() => null);
      if (current !== content) await fs.writeFile(file, content);
    }
  }

  async function openProject(dir: string, { allowExample = false } = {}) {
    let abs = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
    if (abs === EXAMPLE_PROJECT && !allowExample) abs = await sampleCopy(false);
    if (!(await isProject(abs))) throw new HttpError(404, `not an Odaja project (no project.json): ${abs}`);
    if (projectDir !== abs) openScenePath = null;
    projectDir = abs;
    // A fresh watcher every time, so reopening heals one lost when the
    // folder was replaced underneath it.
    watchProject(abs);
    await syncAgentDocs();
    const state = await readState();
    state.recent = [abs, ...state.recent.filter((d) => d !== abs)].slice(0, MAX_RECENT);
    await writeState(state);
  }

  async function createProject(name: string, room?: StarterRoom) {
    const clean = name.trim();
    if (!clean || /[/\\]|^\.+$/.test(clean)) throw new HttpError(400, "invalid project name");
    if (room && !(room.width > 0 && room.depth > 0 && (room.height ?? 1) > 0)) throw new HttpError(400, "room sizes must be positive");
    const dir = path.join(PROJECTS_ROOT, clean);
    if (await fs.stat(dir).catch(() => null)) throw new HttpError(409, `a folder named "${clean}" already exists in ${PROJECTS_ROOT}`);
    await fs.mkdir(path.join(dir, "scenes"), { recursive: true });
    await fs.writeFile(path.join(dir, "project.json"), formatJson(newProjectFile(clean)));
    await fs.writeFile(path.join(dir, "shell.json"), formatJson(newShellFile(room)));
    await fs.writeFile(path.join(dir, "scenes", "main.json"), formatJson(newSceneFile("Main")));
    await openProject(dir);
    return dir;
  }

  // The user's own copy of the sample flat: made on first use, or remade
  // from the repo's version when `fresh` (their changes to it are replaced).
  async function sampleCopy(fresh: boolean) {
    const dir = path.join(PROJECTS_ROOT, SAMPLE_NAME);
    const exists = await isProject(dir);
    if (exists && !fresh) return dir;
    if (await fs.stat(dir).catch(() => null)) {
      if (!exists) throw new HttpError(409, `"${dir}" exists but isn't an Odaja project; move it away first`);
      if (projectDir === dir) {
        watchProject(null);
        projectDir = null;
      }
      await fs.rm(dir, { recursive: true });
    }
    await fs.cp(EXAMPLE_PROJECT, dir, {
      recursive: true,
      // Chats saved while developing stay behind.
      filter: (src) => !src.split(path.sep).includes(".odaja"),
    });
    return dir;
  }

  async function listProjects() {
    const state = await readState();
    const inRoot = await fs
      .readdir(PROJECTS_ROOT, { withFileTypes: true })
      .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => path.join(PROJECTS_ROOT, e.name)))
      .catch(() => [] as string[]);
    const dirs = [...new Set([...state.recent, ...inRoot])].filter((d) => d !== EXAMPLE_PROJECT);
    const summaries = (await Promise.all(dirs.map(projectSummary))).filter((p) => p !== null);
    const rank = (dir: string) => {
      const i = state.recent.indexOf(dir);
      return i === -1 ? Infinity : i;
    };
    summaries.sort((a, b) => rank(a.dir) - rank(b.dir) || b.modified - a.modified);
    const sampleDir = path.join(PROJECTS_ROOT, SAMPLE_NAME);
    return { root: PROJECTS_ROOT, current: projectDir, projects: summaries, sampleDir, sampleCopied: await isProject(sampleDir) };
  }

  async function listScenes() {
    const files = await fs.readdir(resolveInProject("scenes")).catch(() => [] as string[]);
    const scenes = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map(async (f) => {
          const rel = `scenes/${f}`;
          let name = f.replace(/\.json$/, "");
          let shell = "shell.json";
          try {
            const scene = JSON.parse(await fs.readFile(resolveInProject(rel), "utf8"));
            name = String(scene.name ?? name);
            if (typeof scene.shell === "string") shell = scene.shell;
          } catch {
            // Invalid file: show its file name; the app reports the error when opened.
          }
          return { path: rel, name, shell };
        }),
    );
    return { dir: requireProject(), scenes };
  }

  // A free scene file path for a name: scenes/option-b.json, scenes/option-b-2.json, …
  async function freeScenePath(name: string, except?: string) {
    const stem = slugify(name);
    for (let n = 1; ; n++) {
      const rel = `scenes/${stem}${n === 1 ? "" : `-${n}`}.json`;
      if (rel === except) return rel;
      if (!(await fs.stat(resolveInProject(rel)).catch(() => null))) return rel;
    }
  }

  // Copy a shell to a new free file shells/<name>.json, for a scene that wants
  // its own walls.
  async function copyShell(from: string, name: string) {
    const text = await fs.readFile(resolveInProject(from), "utf8");
    const stem = slugify(name);
    await fs.mkdir(resolveInProject("shells"), { recursive: true });
    for (let n = 1; ; n++) {
      const rel = `shells/${stem}${n === 1 ? "" : `-${n}`}.json`;
      if (!(await fs.stat(resolveInProject(rel)).catch(() => null))) {
        await fs.writeFile(resolveInProject(rel), text);
        return rel;
      }
    }
  }

  // --- library -----------------------------------------------------------

  function resolveInLibrary(relPath: string): string {
    const abs = path.resolve(LIBRARY_ROOT, relPath);
    if (!abs.startsWith(LIBRARY_ROOT + path.sep)) throw new HttpError(400, `path escapes library: ${relPath}`);
    return abs;
  }

  async function listLibrary() {
    const entries = await fs.readdir(LIBRARY_ROOT, { withFileTypes: true }).catch(() => []);
    const items = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const dir = path.join(LIBRARY_ROOT, e.name);
          try {
            const item = JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8"));
            const stat = await fs.stat(path.join(dir, "item.json"));
            const preview = await fs.stat(path.join(dir, "preview.png")).then(() => true, () => false);
            return { id: e.name, item, preview, modified: stat.mtimeMs };
          } catch {
            return null; // Not an item (yet), or a broken one.
          }
        }),
    );
    return { root: LIBRARY_ROOT, items: items.filter((i) => i !== null).sort((a, b) => b.modified - a.modified) };
  }

  async function newLibraryItem(name: string) {
    const stem = slugify(name);
    await fs.mkdir(LIBRARY_ROOT, { recursive: true });
    for (let n = 1; ; n++) {
      const id = `${stem}${n === 1 ? "" : `-${n}`}`;
      try {
        await fs.mkdir(path.join(LIBRARY_ROOT, id));
        return id;
      } catch {
        // Taken; try the next number.
      }
    }
  }

  // Copy a library item's model into the open project, named by content so
  // re-placing the same item reuses the file and edited items don't clash.
  async function placeModel(id: string) {
    const data = await fs.readFile(resolveInLibrary(`${id}/model.glb`));
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 8);
    const rel = `assets/models/${id}-${hash}.glb`;
    const abs = resolveInProject(rel);
    if (!(await fs.stat(abs).catch(() => null))) {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, data);
    }
    return rel;
  }

  // Copy a library material into the open project: its texture into
  // assets/textures/ and the material into project.json under a free name.
  async function addLibraryMaterial(id: string) {
    const dir = resolveInLibrary(id);
    const item = JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8"));
    if (!item.material) throw new HttpError(400, `"${id}" is not a material`);
    const material = structuredClone(item.material);
    if (material.tile?.image) {
      const data = await fs.readFile(path.join(dir, material.tile.image));
      const rel = `assets/textures/${id}${path.extname(material.tile.image)}`;
      await fs.mkdir(path.dirname(resolveInProject(rel)), { recursive: true });
      await fs.writeFile(resolveInProject(rel), data);
      material.tile.image = rel;
    }
    const projectFile = resolveInProject("project.json");
    const project = JSON.parse(await fs.readFile(projectFile, "utf8"));
    project.materials ??= {};
    let name = id;
    for (let n = 2; project.materials[name] && JSON.stringify(project.materials[name]) !== JSON.stringify(material); n++) name = `${id}-${n}`;
    project.materials[name] = material;
    await fs.writeFile(projectFile, formatJson(project));
    return name;
  }

  async function sendFile(res: ServerResponse, abs: string) {
    const data = await fs.readFile(abs).catch(() => null);
    if (data === null) throw new HttpError(404, `not found: ${abs}`);
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.end(data);
  }

  async function renameScene(from: string, name: string) {
    const abs = resolveInProject(from);
    const scene = JSON.parse(await fs.readFile(abs, "utf8"));
    scene.name = name;
    const to = await freeScenePath(name, from);
    await fs.writeFile(resolveInProject(to), formatJson(scene));
    if (to !== from) await fs.rm(abs);
    return to;
  }

  async function deleteScene(rel: string) {
    if (!/^scenes\/[^/]+\.json$/.test(rel)) throw new HttpError(400, "not a scene file");
    const { scenes } = await listScenes();
    if (scenes.length <= 1) throw new HttpError(409, "can't delete the only scene");
    await fs.rm(resolveInProject(rel));
  }

  const initial = process.env.ODAJA_PROJECT ?? (await readState()).recent[0];
  if (initial) await openProject(initial, { allowExample: Boolean(process.env.ODAJA_PROJECT) }).catch((err) => console.warn(`[odaja] ${err.message}`));

  // Editing the format docs (working on Odaja itself) refreshes the open project's copy.
  let docsWatcher: FSWatcher | null = null;
  try {
    docsWatcher = watch(AGENT_DOC_SOURCE, () => syncAgentDocs().catch(() => {}));
  } catch {
    // Not there (yet): nothing to keep in sync.
  }

  return {
    stop() {
      clearInterval(keepAlive);
      watchProject(null);
      docsWatcher?.close();
      for (const res of listeners) res.end();
      listeners.clear();
      stopAllClaudeCode();
    },

    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const send = (status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (crossSite(req)) return send(403, { error: "Odaja's API only accepts requests from Odaja itself." });
      const json = async () => JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const route = `${req.method} ${url.pathname}`;
      try {
        if (route.includes(" /chat/")) {
          const handled = await handleChat(route, url, req, res, {
            projectDir: () => projectDir,
            toolsFor,
            odajaUrl: () => `http://localhost:${port()}`,
            json,
            send,
          });
          if (handled) return;
        }
        switch (route) {
          case "GET /events": {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            res.write(": connected\n\n");
            listeners.add(res);
            req.on("close", () => listeners.delete(res));
            return;
          }
          case "GET /projects":
            return send(200, await listProjects());
          case "POST /projects/open": {
            const { dir } = await json();
            await openProject(String(dir));
            return send(200, { dir: projectDir });
          }
          case "POST /projects/sample": {
            const { fresh } = await json();
            await openProject(await sampleCopy(Boolean(fresh)));
            return send(200, { dir: projectDir });
          }
          case "POST /projects/create": {
            const { name, room } = await json();
            return send(200, { dir: await createProject(String(name ?? ""), room) });
          }
          case "POST /projects/close":
            watchProject(null);
            projectDir = null;
            return send(200, { ok: true });
          case "GET /project":
            return send(200, await listScenes());
          case "POST /scenes/create": {
            const { name, content } = await json();
            const rel = await freeScenePath(String(name));
            await fs.writeFile(resolveInProject(rel), formatJson({ ...content, name }));
            return send(200, { path: rel });
          }
          case "POST /shells/copy": {
            const { from, name } = await json();
            return send(200, { path: await copyShell(String(from), String(name)) });
          }
          case "POST /scenes/rename": {
            const { path: from, name } = await json();
            return send(200, { path: await renameScene(String(from), String(name)) });
          }
          case "POST /scenes/delete": {
            const { path: rel } = await json();
            await deleteScene(String(rel));
            return send(200, { ok: true });
          }
          case "GET /file":
          case "PUT /file":
          case "GET /library/file":
          case "PUT /library/file": {
            const rel = url.searchParams.get("path");
            if (!rel) return send(400, { error: "missing path" });
            const abs = url.pathname.startsWith("/library") ? resolveInLibrary(rel) : resolveInProject(rel);
            if (req.method === "GET") return await sendFile(res, abs);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, await readBody(req));
            return send(200, { ok: true });
          }
          case "GET /tools":
            return send(200, TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: inputJsonSchema(t) })));
          case "POST /tools/call": {
            const { name, input, chatId } = await json();
            return send(200, await callTool(String(name), input, toolsFor(typeof chatId === "string" ? chatId : undefined)));
          }
          case "POST /ui-state": {
            const state = await json();
            if ("scenePath" in state) openScenePath = typeof state.scenePath === "string" ? state.scenePath : null;
            if ("editingObject" in state) editingObject = typeof state.editingObject === "string" ? state.editingObject : null;
            return send(200, { ok: true });
          }
          case "POST /screenshot-result": {
            const { id, data, mimeType, error } = await json();
            const pending = pendingShots.get(String(id));
            pendingShots.delete(String(id));
            if (pending) {
              if (error) pending.reject(new Error(String(error)));
              else pending.resolve({ data: String(data), mimeType: String(mimeType ?? "image/png") });
            }
            return send(200, { ok: true });
          }
          case "GET /library":
            return send(200, await listLibrary());
          case "POST /library/new": {
            const { name } = await json();
            return send(200, { id: await newLibraryItem(String(name ?? "item")) });
          }
          case "POST /library/delete": {
            const { id } = await json();
            await fs.rm(resolveInLibrary(String(id)), { recursive: true, force: true });
            return send(200, { ok: true });
          }
          case "POST /library/add-material": {
            const { id } = await json();
            return send(200, { name: await addLibraryMaterial(String(id)) });
          }
          case "POST /library/place-model": {
            const { id } = await json();
            return send(200, { src: await placeModel(String(id)) });
          }
        }
        send(404, { error: "unknown endpoint" });
      } catch (err) {
        const status = err instanceof HttpError ? err.status : ((err as { status?: number }).status ?? 500);
        if (!res.headersSent) send(status, { error: (err as Error).message });
        else res.end();
      }
    },
  };
}
