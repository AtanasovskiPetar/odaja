// Dev-time file bridge between the browser app and project folders on disk.
// The app reads and writes the open project's files through /api/*, and gets
// an "odaja:file-changed" event whenever one of them changes, so edits made by
// agents (or any editor) show up live. It also lists, creates and opens
// projects. The Tauri build will replace this with native file access behind
// the same interface (src/platform.ts).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { newProjectFile, newSceneFile, newShellFile, slugify, type StarterRoom } from "../src/model/defaults";
import { formatJson } from "../src/model/format";

const AGENT_DOC_SOURCE = path.resolve("docs/project-format.md");
// New projects are created here.
const PROJECTS_ROOT = path.resolve(process.env.ODAJA_HOME ?? path.join(os.homedir(), "Documents", "Odaja"));
// Remembers recently opened projects between runs. A custom ODAJA_HOME gets
// its own state, so test setups don't touch the real list.
const STATE_FILE = process.env.ODAJA_HOME
  ? path.join(PROJECTS_ROOT, ".odaja-state.json")
  : path.join(os.homedir(), ".odaja", "state.json");
const MAX_RECENT = 12;
// Always offered on the start screen.
const EXAMPLE_PROJECT = path.resolve("examples/sample-flat");

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

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function odajaProjectServer(): Plugin {
  let projectDir: string | null = null;
  let server: ViteDevServer;

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

  async function openProject(dir: string) {
    const abs = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
    if (!(await isProject(abs))) throw new HttpError(404, `not an Odaja project (no project.json): ${abs}`);
    if (projectDir && projectDir !== abs) server.watcher.unwatch(projectDir);
    projectDir = abs;
    server.watcher.add(abs);
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

  async function listProjects() {
    const state = await readState();
    const inRoot = await fs
      .readdir(PROJECTS_ROOT, { withFileTypes: true })
      .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => path.join(PROJECTS_ROOT, e.name)))
      .catch(() => [] as string[]);
    const dirs = [...new Set([...state.recent, ...inRoot, EXAMPLE_PROJECT])];
    const summaries = (await Promise.all(dirs.map(projectSummary))).filter((p) => p !== null);
    const rank = (dir: string) => {
      const i = state.recent.indexOf(dir);
      return i === -1 ? Infinity : i;
    };
    summaries.sort((a, b) => rank(a.dir) - rank(b.dir) || b.modified - a.modified);
    return { root: PROJECTS_ROOT, current: projectDir, projects: summaries };
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
          try {
            name = String(JSON.parse(await fs.readFile(resolveInProject(rel), "utf8")).name ?? name);
          } catch {
            // Invalid file: show its file name; the app reports the error when opened.
          }
          return { path: rel, name };
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

  return {
    name: "odaja-project-server",
    async configureServer(devServer) {
      server = devServer;
      const initial = process.env.ODAJA_PROJECT ?? (await readState()).recent[0];
      if (initial) await openProject(initial).catch((err) => console.warn(`[odaja] ${err.message}`));

      server.watcher.add(AGENT_DOC_SOURCE);
      server.watcher.on("all", (_event, file) => {
        if (file === AGENT_DOC_SOURCE) {
          syncAgentDocs();
          return;
        }
        if (!projectDir || !file.startsWith(projectDir + path.sep)) return;
        const rel = path.relative(projectDir, file).split(path.sep).join("/");
        server.ws.send({ type: "custom", event: "odaja:file-changed", data: { path: rel } });
      });

      server.middlewares.use("/api", async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        const json = async () => JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const route = `${req.method} ${url.pathname}`;
        try {
          switch (route) {
            case "GET /projects":
              return send(200, await listProjects());
            case "POST /projects/open": {
              const { dir } = await json();
              await openProject(String(dir));
              return send(200, { dir: projectDir });
            }
            case "POST /projects/create": {
              const { name, room } = await json();
              return send(200, { dir: await createProject(String(name ?? ""), room) });
            }
            case "POST /projects/close":
              if (projectDir) server.watcher.unwatch(projectDir);
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
            case "PUT /file": {
              const rel = url.searchParams.get("path");
              if (!rel) return send(400, { error: "missing path" });
              const abs = resolveInProject(rel);
              if (req.method === "GET") {
                const text = await fs.readFile(abs, "utf8").catch(() => null);
                if (text === null) return send(404, { error: `not found: ${rel}` });
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                return res.end(text);
              }
              await fs.mkdir(path.dirname(abs), { recursive: true });
              await fs.writeFile(abs, await readBody(req));
              return send(200, { ok: true });
            }
          }
          send(404, { error: "unknown endpoint" });
        } catch (err) {
          send(err instanceof HttpError ? err.status : 500, { error: (err as Error).message });
        }
      });
    },
  };
}
