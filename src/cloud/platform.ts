import type { AgentFiles, FileArea, FileData } from "../agent/files";
import { sampleFiles } from "../browser/sample";
import { slugify, type StarterRoom } from "../model/defaults";
import { formatJson } from "../model/format";
import { belongsInFile, homeName, packHome, unpackHome } from "../model/homeFile";
import { chatPath, type LibraryEntry, type Platform, type ProjectList, type SceneSummary, type VersionSummary } from "../platform";
import { useCloudAuth } from "./auth";
import { useCloudSave } from "./saveStatus";

// Saving checks the content it replaces. The server's fingerprint (SHA-256,
// its ETag) of each file is remembered as this tab last heard it (reads,
// saves, the change stream) and sent with the next save as If-Match. A
// refused save (412: changed in another tab, on another device, or by the
// server's tools) loads the newer file instead and says so.
//
// Saves of one file go out one at a time, the latest content only, so quick
// edits never race each other. Without a connection they wait in this tab
// ("Offline") and go out when it's back; the page asks before closing then.
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bytesOf(data: string | Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

const etagHash = (res: Response) => res.headers.get("ETag")?.replace(/^W\//, "").replace(/"/g, "") ?? null;

async function tell(message: string) {
  try {
    const { useOdaja } = await import("../store");
    useOdaja.getState().setNotice(message);
  } catch (err) {
    console.warn(message, err);
  }
}

const LAST_CLOUD_PROJECT_KEY = "odaja:cloud:last-project";
const CHANGED_ELSEWHERE = "This home was changed somewhere else (another tab or device). The newer version is loaded; your last change wasn't saved.";

interface CloudProjectRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

// One file's save waiting to go out: the latest content (null: delete it),
// and the callers waiting for it.
interface Pending {
  pid: string;
  rel: string;
  bytes: Uint8Array | null;
  hash: string | null;
  waiters: { resolve(): void; reject(err: Error): void }[];
}

type Outcome = "ok" | "conflict" | "signed-out" | "offline" | "retry" | { refused: string };

export type CloudPlatform = Platform & {
  // Stop following the open home (another home, not in the cloud, is open now).
  closeHome(): void;
};

// `library`: the furniture library of this computer (the website's browser
// storage or the companion's folder). Cloud homes use it as local homes do:
// placing an item copies its files into the home, so the home is complete
// on any computer.
export function createCloudPlatform(apiBase: string, library: () => FileArea | null): CloudPlatform {
  const base = apiBase.replace(/\/+$/, "");
  let currentId: string | null = null;
  try {
    currentId = localStorage.getItem(LAST_CLOUD_PROJECT_KEY);
  } catch {
    // storage unavailable
  }

  const changeListeners: ((path: string) => void)[] = [];
  const openSceneListeners: ((path: string) => void)[] = [];
  const announce = (rel: string) => changeListeners.forEach((cb) => cb(rel));

  const requireOpen = (): string => {
    if (!currentId) throw new Error("No cloud project is open");
    return currentId;
  };

  // --- What the server has: fingerprints per home ---------------------------

  const serverHashes = new Map<string, Map<string, string>>();
  const known = (pid: string) => {
    let m = serverHashes.get(pid);
    if (!m) serverHashes.set(pid, (m = new Map()));
    return m;
  };
  const heard = (pid: string, rel: string, hash: string | null) => (hash ? known(pid).set(rel, hash) : known(pid).delete(rel));
  // This tab's own saves, so they don't come back on the change stream as
  // someone else's.
  const ours = new Set<string>();
  const echo = (pid: string, rel: string, hash: string | null) => `${pid}\n${rel}\n${hash ?? ""}`;

  // --- Sending saves --------------------------------------------------------

  const slots = new Map<string, { busy: boolean; next: Pending | null }>();
  const slotKey = (pid: string, rel: string) => `${pid}\n${rel}`;
  let offline = typeof navigator !== "undefined" && navigator.onLine === false;
  let failing: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 2000;

  const waiting = () => [...slots.values()].some((s) => s.busy || s.next);
  const showStatus = () => {
    const state = offline ? "offline" : failing && waiting() ? "failing" : waiting() ? "saving" : "saved";
    useCloudSave.setState({ state, detail: state === "failing" ? failing : null });
  };

  const scheduleRetry = () => {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryAll();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  };
  const retryAll = () => {
    for (const [key, slot] of slots) if (slot.next && !slot.busy) void pump(key);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      offline = false;
      retryDelay = 2000;
      showStatus();
      retryAll();
    });
    window.addEventListener("offline", () => {
      offline = true;
      showStatus();
    });
    // Changes not on the server yet would be lost with the tab.
    window.addEventListener("beforeunload", (e) => {
      if (waiting()) e.preventDefault();
    });
  }

  async function send(op: Pending): Promise<Outcome> {
    const expected = known(op.pid).get(op.rel);
    const headers: Record<string, string> = expected ? { "If-Match": `"${expected}"` } : {};
    // A save that changed nothing has no echo; don't let those pile up.
    if (ours.size > 500) ours.delete(ours.values().next().value!);
    ours.add(echo(op.pid, op.rel, op.hash));
    let res: Response;
    try {
      res = await fetch(fileEndpoint(op.pid, op.rel), {
        method: op.bytes ? "PUT" : "DELETE",
        credentials: "include",
        headers,
        body: op.bytes ? new Blob([op.bytes as BlobPart]) : undefined,
      });
    } catch {
      ours.delete(echo(op.pid, op.rel, op.hash));
      return "offline";
    }
    offline = false;
    if (res.ok || (res.status === 404 && !op.bytes)) {
      heard(op.pid, op.rel, op.hash);
      return "ok";
    }
    ours.delete(echo(op.pid, op.rel, op.hash));
    if (res.status === 412) return "conflict";
    if (res.status === 401) return "signed-out";
    // Busy or broken for now: try again. Anything else won't change by trying.
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      failing = `The server answered ${res.status}.`;
      return "retry";
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { refused: body?.error ?? `The server refused it (${res.status}).` };
  }

  async function pump(key: string) {
    const slot = slots.get(key);
    if (!slot || slot.busy) return;
    slot.busy = true;
    showStatus();
    while (slot.next) {
      const op = slot.next;
      slot.next = null;
      const outcome = await send(op);
      if (outcome === "ok") {
        failing = null;
        retryDelay = 2000;
        op.waiters.forEach((w) => w.resolve());
        continue;
      }
      if (outcome === "offline" || outcome === "retry") {
        if (outcome === "offline") offline = true;
        // Kept to send later; whoever was waiting can carry on.
        op.waiters.forEach((w) => w.resolve());
        slot.next ??= { ...op, waiters: [] };
        scheduleRetry();
        break;
      }
      // Not saved, and nothing queued after it may go out on top of it.
      const dropped = [op, ...(slot.next ? [slot.next] : [])];
      slot.next = null;
      const message =
        outcome === "conflict" ? `${op.rel} was changed somewhere else` : outcome === "signed-out" ? "Signed out" : `Couldn't save ${op.rel}: ${outcome.refused}`;
      dropped.forEach((d) => d.waiters.forEach((w) => w.reject(new Error(message))));
      if (outcome === "conflict") await conflicted(op.pid, op.rel);
      else if (outcome === "signed-out") {
        useCloudAuth.getState().handleUnauthorized();
        await tell("You were signed out, so your last change wasn't saved. Sign in again to keep editing this home.");
      } else await tell(message);
    }
    slot.busy = false;
    if (!slot.next) slots.delete(key);
    showStatus();
  }

  function save(pid: string, rel: string, bytes: Uint8Array | null): Promise<void> {
    return (async () => {
      const hash = bytes ? await sha256(bytes) : null;
      const key = slotKey(pid, rel);
      let slot = slots.get(key);
      if (!slot) slots.set(key, (slot = { busy: false, next: null }));
      // Offline (a save already failed and waits to try again), this one
      // joins the queue and the caller carries on; it goes out when back.
      const later = offline && retryTimer !== null;
      const done = new Promise<void>((resolve, reject) => {
        const waiter = later ? { resolve() {}, reject() {} } : { resolve, reject };
        if (later) resolve();
        if (slot.next) Object.assign(slot.next, { bytes, hash, waiters: [...slot.next.waiters, waiter] });
        else slot.next = { pid, rel, bytes, hash, waiters: [waiter] };
      });
      if (!slot.busy && !later) void pump(key);
      showStatus();
      return done;
    })();
  }

  // Someone else saved first: keep theirs, load it, and say so.
  async function conflicted(pid: string, rel: string) {
    known(pid).delete(rel);
    if (pid !== currentId) return;
    announce(rel);
    await tell(CHANGED_ELSEWHERE);
  }

  // --- Following changes made elsewhere ---------------------------------------

  let changes: EventSource | null = null;

  // A change from elsewhere: reload it. If this tab has a save of that file
  // still to send, the other one won (it was first); this one is dropped.
  function changedElsewhere(pid: string, rel: string, hash: string | null) {
    const slot = slots.get(slotKey(pid, rel));
    const pending = slot?.next;
    if (slot && pending) {
      slot.next = null;
      pending.waiters.forEach((w) => w.reject(new Error(`${rel} was changed somewhere else`)));
      if (!slot.busy) slots.delete(slotKey(pid, rel));
      showStatus();
      void tell(CHANGED_ELSEWHERE);
    }
    heard(pid, rel, hash);
    announce(rel);
  }

  // What the server has now, compared with what this tab heard: after a lost
  // connection, changes made meanwhile are loaded. The first time (opening
  // the home) it only learns the files it hasn't read yet.
  const caughtUp = new Set<string>();
  async function catchUp(pid: string) {
    const res = await fetch(`${base}/api/v1/projects/${encodeURIComponent(pid)}/manifest`, { credentials: "include", cache: "no-store" }).catch(() => null);
    if (!res?.ok || pid !== currentId) return;
    const { files } = (await res.json()) as { files: Record<string, string> };
    const mine = known(pid);
    if (!caughtUp.has(pid)) {
      caughtUp.add(pid);
      for (const [rel, hash] of Object.entries(files)) if (!mine.has(rel)) mine.set(rel, hash);
      return;
    }
    for (const [rel, hash] of Object.entries(files)) if (mine.get(rel) !== hash) changedElsewhere(pid, rel, hash);
    for (const rel of [...mine.keys()]) if (!(rel in files)) changedElsewhere(pid, rel, null);
  }

  const watch = (id: string | null) => {
    changes?.close();
    changes = null;
    // Forget other homes, unless they still have saves to send.
    for (const pid of serverHashes.keys()) {
      if (pid === id || [...slots.values()].some((s) => s.next?.pid === pid)) continue;
      serverHashes.delete(pid);
      caughtUp.delete(pid);
    }
    if (!id) return;
    let lost = false;
    changes = new EventSource(`${base}/api/v1/projects/${encodeURIComponent(id)}/events`, { withCredentials: true });
    changes.addEventListener("open", () => {
      void catchUp(id);
      if (lost) {
        lost = false;
        retryAll();
      }
    });
    changes.addEventListener("error", () => {
      lost = true;
    });
    changes.addEventListener("file-changed", (e) => {
      const { path, hash } = JSON.parse((e as MessageEvent<string>).data) as { path: string; hash: string | null };
      if (ours.delete(echo(id, path, hash))) return;
      if (known(id).get(path) === (hash ?? undefined)) return;
      changedElsewhere(id, path, hash);
    });
  };

  const setOpen = (id: string | null) => {
    if (id !== currentId || !changes) watch(id);
    currentId = id;
    try {
      if (id) localStorage.setItem(LAST_CLOUD_PROJECT_KEY, id);
      else localStorage.removeItem(LAST_CLOUD_PROJECT_KEY);
    } catch {
      // ignore
    }
  };

  async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    if (res.status === 401) {
      useCloudAuth.getState().handleUnauthorized();
      throw new Error("Session expired");
    }
    if (!res.ok) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // non-json
      }
      throw new Error(msg || `Request failed (${res.status})`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  const fileEndpoint = (pid: string, rel: string) =>
    `${base}/api/v1/projects/${encodeURIComponent(pid)}/file?path=${encodeURIComponent(rel)}`;

  const assetEndpoint = (pid: string, rel: string) =>
    `${base}/api/v1/projects/${encodeURIComponent(pid)}/asset?path=${encodeURIComponent(rel)}`;

  async function listFiles(pid: string, prefix?: string): Promise<string[]> {
    const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const res = await apiJson<{ files: string[] }>(`/api/v1/projects/${encodeURIComponent(pid)}/files${qs}`);
    return res.files;
  }

  async function read(pid: string, rel: string): Promise<Response | null> {
    const res = await fetch(fileEndpoint(pid, rel), { credentials: "include", cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to read ${rel} (${res.status})`);
    // A save of this file still on its way: the server's copy is older.
    if (!slots.get(slotKey(pid, rel))?.next) heard(pid, rel, etagHash(res));
    return res;
  }

  async function readText(pid: string, rel: string): Promise<string | null> {
    return (await read(pid, rel))?.text() ?? null;
  }

  async function readBytes(pid: string, rel: string): Promise<Uint8Array | null> {
    const res = await read(pid, rel);
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  }

  const writeRaw = async (pid: string, rel: string, data: string | Blob | ArrayBuffer | Uint8Array) => save(pid, rel, await bytesOf(data));
  const deleteFile = (pid: string, rel: string) => save(pid, rel, null);

  async function freePath(pid: string, folder: string, name: string, except?: string): Promise<string> {
    const existing = new Set(await listFiles(pid, `${folder}/`));
    const stem = slugify(name);
    for (let n = 1; ; n++) {
      const rel = `${folder}/${stem}${n === 1 ? "" : `-${n}`}.json`;
      if (rel === except || !existing.has(rel)) return rel;
    }
  }

  // The open home's files, for the AI tools (they run in the page for cloud homes).
  const projectArea: FileArea = {
    read: (rel) => readBytes(requireOpen(), rel),
    readText: (rel) => readText(requireOpen(), rel),
    write: async (rel, data: FileData) => {
      await writeRaw(requireOpen(), rel, data);
      announce(rel);
    },
    listFiles: async (dir) => {
      const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
      const all = await listFiles(requireOpen(), prefix || undefined);
      return all
        .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
        .map((f) => f.slice(prefix.length));
    },
    listDirs: async (dir) => {
      const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
      const all = await listFiles(requireOpen(), prefix || undefined);
      const dirs = new Set<string>();
      for (const f of all) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash > 0) dirs.add(rest.slice(0, slash));
      }
      return [...dirs];
    },
    exists: async (rel) => (await listFiles(requireOpen(), rel)).some((f) => f === rel || f.startsWith(`${rel}/`)),
  };

  const libraryArea = (): FileArea => {
    const area = library();
    if (!area) throw new Error("The furniture library isn't available here");
    return area;
  };
  const agentFiles: AgentFiles = {
    project: projectArea,
    get library() {
      return libraryArea();
    },
  };

  return {
    kind: "cloud",

    closeHome() {
      changes?.close();
      changes = null;
    },

    async listProjects(): Promise<ProjectList> {
      const { projects } = await apiJson<{ projects: CloudProjectRow[] }>("/api/v1/projects");
      if (currentId && !projects.some((p) => p.id === currentId)) setOpen(null);
      return {
        root: "cloud",
        current: currentId,
        projects: projects.map((p) => ({
          dir: p.id,
          name: p.name,
          modified: p.updatedAt,
          inProjectsFolder: true,
        })),
        sampleDir: "sample",
        sampleCopied: false,
      };
    },

    async openProject(id: string) {
      setOpen(id);
    },

    async openSample() {
      const created = await apiJson<CloudProjectRow>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Sample flat", empty: true }),
      });
      const files = sampleFiles();
      await Promise.all(
        Object.entries(files).map(([rel, data]) => writeRaw(created.id, rel, data as string | Uint8Array)),
      );
      setOpen(created.id);
    },

    async createProject(name: string, room?: StarterRoom) {
      const created = await apiJson<CloudProjectRow>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name, room }),
      });
      setOpen(created.id);
    },

    async listScenes(): Promise<{ dir: string; scenes: SceneSummary[] }> {
      const pid = requireOpen();
      const files = (await listFiles(pid, "scenes/")).filter((f) => f.endsWith(".json"));
      const scenes = await Promise.all(
        files.map(async (rel) => {
          let name = rel.replace(/^scenes\//, "").replace(/\.json$/, "");
          let shell = "shell.json";
          try {
            const text = await readText(pid, rel);
            if (text) {
              const parsed = JSON.parse(text) as { name?: unknown; shell?: unknown };
              if (typeof parsed.name === "string" && parsed.name) name = parsed.name;
              if (typeof parsed.shell === "string" && parsed.shell) shell = parsed.shell;
            }
          } catch {
            // show filename on malformed JSON
          }
          return { path: rel, name, shell };
        }),
      );
      return { dir: pid, scenes };
    },

    async createScene(name, content) {
      const pid = requireOpen();
      const rel = await freePath(pid, "scenes", name);
      await writeRaw(pid, rel, formatJson({ ...content, name }));
      return rel;
    },

    async renameScene(from, name) {
      const pid = requireOpen();
      const text = await readText(pid, from);
      if (text === null) throw new Error(`Scene not found: ${from}`);
      const doc = JSON.parse(text) as Record<string, unknown>;
      const to = await freePath(pid, "scenes", name, from);
      await writeRaw(pid, to, formatJson({ ...doc, name }));
      if (to !== from) await deleteFile(pid, from);
      return to;
    },

    async deleteScene(rel) {
      await deleteFile(requireOpen(), rel);
    },

    async copyShell(from, name) {
      const pid = requireOpen();
      const text = await readText(pid, from);
      if (text === null) throw new Error(`Shell not found: ${from}`);
      const to = await freePath(pid, "shells", name);
      await writeRaw(pid, to, text);
      return to;
    },

    async readFile(rel) {
      const text = await readText(requireOpen(), rel);
      if (text === null) throw new Error(`Not found: ${rel}`);
      return text;
    },

    async writeFile(rel, data) {
      await writeRaw(requireOpen(), rel, data);
    },

    fileUrl(rel) {
      if (!currentId) return "";
      return assetEndpoint(currentId, rel);
    },

    // The library itself is this computer's (src/cloud/withCloud.ts sends
    // listing and editing it to the local host); these copy from it.

    async listLibrary(): Promise<{ root: string; items: LibraryEntry[] }> {
      return { root: "", items: [] };
    },
    async newLibraryItem() {
      throw new Error("The library is this computer's");
    },
    async writeLibraryFile() {
      throw new Error("The library is this computer's");
    },
    libraryFileUrl() {
      return "";
    },
    async deleteLibraryItem() {
      throw new Error("The library is this computer's");
    },

    // Copy a library model into the home, named by content so placing the
    // same item twice reuses the file and edited items don't clash.
    async placeLibraryModel(id) {
      const pid = requireOpen();
      const data = await libraryArea().read(`${id}/model.glb`);
      if (!data) throw new Error(`"${id}" has no model`);
      const rel = `assets/models/${id}-${(await sha256(data)).slice(0, 8)}.glb`;
      if (!(await listFiles(pid, rel)).includes(rel)) await writeRaw(pid, rel, data);
      return rel;
    },

    // Copy a library material into the home: its texture into
    // assets/textures/ and the material into project.json under a free name.
    async addLibraryMaterial(id) {
      const pid = requireOpen();
      const text = await libraryArea().readText(`${id}/item.json`);
      if (text === null) throw new Error(`"${id}" isn't in the library`);
      const item = JSON.parse(text);
      if (!item.material) throw new Error(`"${id}" is not a material`);
      const material = { ...structuredClone(item.material), libraryItem: { id, category: item.category } };
      if (material.tile?.image) {
        const image = await libraryArea().read(`${id}/${material.tile.image}`);
        if (image) {
          const rel = `assets/textures/${id}${material.tile.image.slice(material.tile.image.lastIndexOf("."))}`;
          await writeRaw(pid, rel, image);
          material.tile.image = rel;
        }
      }
      const projectText = await readText(pid, "project.json");
      if (projectText === null) throw new Error("not found: project.json");
      const project = JSON.parse(projectText);
      project.materials ??= {};
      let name = id;
      for (let n = 2; project.materials[name] && JSON.stringify(project.materials[name]) !== JSON.stringify(material); n++) name = `${id}-${n}`;
      project.materials[name] = material;
      await writeRaw(pid, "project.json", formatJson(project));
      announce("project.json");
      return name;
    },

    async exportHome(includeChats) {
      const pid = requireOpen();
      const all = (await listFiles(pid)).filter((p) => belongsInFile(p, includeChats));
      const entries: Record<string, Uint8Array> = {};
      await Promise.all(
        all.map(async (rel) => {
          const bytes = await readBytes(pid, rel);
          if (bytes) entries[rel] = bytes;
        }),
      );
      const zip = packHome(entries);
      return new Blob([zip as BlobPart], { type: "application/zip" });
    },

    async homeHasChats() {
      const pid = requireOpen();
      const files = await listFiles(pid, ".odaja/chats/");
      return files.some((f) => f.endsWith(".json"));
    },

    async importHome(data) {
      const files = unpackHome(data);
      const created = await apiJson<CloudProjectRow>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: homeName(files, "Imported home"), empty: true }),
      });
      await Promise.all(Object.entries(files).map(([rel, bytes]) => writeRaw(created.id, rel, bytes)));
      setOpen(created.id);
    },

    async markSavedToFile() {
      // Cloud homes are saved as they change.
    },

    async trashProject(id) {
      await apiJson(`/api/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (currentId === id) setOpen(null);
    },

    async renameProject(id, name) {
      await apiJson(`/api/v1/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },

    chats: {
      async list() {
        const pid = requireOpen();
        const files = await listFiles(pid, ".odaja/chats/");
        return files
          .filter((f) => /^\.odaja\/chats\/[a-z0-9-]+\.json$/.test(f))
          .map((f) => f.slice(".odaja/chats/".length, -".json".length));
      },
      async read(id) {
        return readText(requireOpen(), chatPath(id));
      },
      async write(id, json) {
        await writeRaw(requireOpen(), chatPath(id), json);
      },
      async remove(id) {
        await deleteFile(requireOpen(), chatPath(id));
      },
    },

    localTools: {
      files: () => (currentId ? agentFiles : null),
      openScene: (path) => openSceneListeners.forEach((cb) => cb(path)),
    },

    onFileChanged(cb) {
      changeListeners.push(cb);
    },

    reportUiState() {
      // Tools for cloud homes run in the page, which knows what it shows.
    },

    onOpenSceneRequest(cb) {
      openSceneListeners.push(cb);
    },

    onScreenshotRequest() {
      // Screenshots are taken by this page directly (the tools run in it).
    },

    versions: {
      async list() {
        return (await apiJson<{ versions: VersionSummary[] }>(`/api/v1/projects/${encodeURIComponent(requireOpen())}/versions`)).versions;
      },
      async create(label, reason = "named") {
        await apiJson(`/api/v1/projects/${encodeURIComponent(requireOpen())}/versions`, { method: "POST", body: JSON.stringify({ label, reason }) });
      },
      async restore(id) {
        const pid = requireOpen();
        const { changed } = await apiJson<{ changed: string[] }>(`/api/v1/projects/${encodeURIComponent(pid)}/versions/${encodeURIComponent(id)}/restore`, { method: "POST" });
        // The stream would tell us too; reload now rather than wait for it.
        for (const rel of changed) {
          known(pid).delete(rel);
          announce(rel);
        }
      },
    },
  };
}
