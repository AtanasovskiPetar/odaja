import type { AgentFiles, FileArea, FileData } from "../agent/files";
import { sampleFiles } from "../browser/sample";
import { slugify, type StarterRoom } from "../model/defaults";
import { formatJson } from "../model/format";
import { belongsInFile, homeName, packHome, unpackHome } from "../model/homeFile";
import { chatPath, type LibraryEntry, type Platform, type ProjectList, type SceneSummary, type VersionSummary } from "../platform";
import { useCloudAuth } from "./auth";

// Saving checks the content it replaces: each file's fingerprint (SHA-256,
// the server's ETag) is remembered when it's read or written, and sent with
// the next save as If-Match. A refused save (412: changed in another tab, on
// another device, or by an AI turn) loads the newer file instead and says so.
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
  const { useOdaja } = await import("../store");
  useOdaja.getState().setNotice(message);
}

const LAST_CLOUD_PROJECT_KEY = "odaja:cloud:last-project";

interface CloudProjectRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type CloudPlatform = Platform & {
  // Stop following the open home (another home, not in the cloud, is open now).
  closeHome(): void;
};

export function createCloudPlatform(apiBase: string): CloudPlatform {
  const base = apiBase.replace(/\/+$/, "");
  let currentId: string | null = null;
  try {
    currentId = localStorage.getItem(LAST_CLOUD_PROJECT_KEY);
  } catch {
    // storage unavailable
  }

  // Fingerprints of the open home's files as this tab last saw them.
  const hashes = new Map<string, string>();
  let changes: EventSource | null = null;

  const changeListeners: ((path: string) => void)[] = [];
  const openSceneListeners: ((path: string) => void)[] = [];
  const announce = (rel: string) => changeListeners.forEach((cb) => cb(rel));

  const requireOpen = (): string => {
    if (!currentId) throw new Error("No cloud project is open");
    return currentId;
  };

  // Changes made elsewhere (another tab, device or the server's tools) arrive
  // on a stream; this tab reloads files whose content it doesn't have.
  const watch = (id: string | null) => {
    changes?.close();
    changes = null;
    hashes.clear();
    if (!id) return;
    changes = new EventSource(`${base}/api/v1/projects/${encodeURIComponent(id)}/events`, { withCredentials: true });
    changes.addEventListener("file-changed", (e) => {
      const { path, hash } = JSON.parse((e as MessageEvent<string>).data) as { path: string; hash: string | null };
      if (hashes.get(path) === (hash ?? undefined)) return;
      hashes.delete(path);
      announce(path);
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
    if (res.status === 404) {
      if (pid === currentId) hashes.delete(rel);
      return null;
    }
    if (!res.ok) throw new Error(`Failed to read ${rel} (${res.status})`);
    const hash = etagHash(res);
    if (pid === currentId && hash) hashes.set(rel, hash);
    return res;
  }

  async function readText(pid: string, rel: string): Promise<string | null> {
    return (await read(pid, rel))?.text() ?? null;
  }

  async function readBytes(pid: string, rel: string): Promise<Uint8Array | null> {
    const res = await read(pid, rel);
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  }

  // Someone else saved first: keep theirs, load it, and say so.
  async function conflicted(pid: string, rel: string) {
    hashes.delete(rel);
    if (pid !== currentId) return;
    announce(rel);
    await tell("This home was changed somewhere else (another tab or device). The newer version is loaded; your last change wasn't saved.");
  }

  // Unknown fingerprint (a file this tab never read): saved without a check.
  const condition = (pid: string, rel: string): Record<string, string> => {
    const known = pid === currentId ? hashes.get(rel) : undefined;
    return known ? { "If-Match": `"${known}"` } : {};
  };

  async function writeRaw(pid: string, rel: string, data: string | Blob | ArrayBuffer | Uint8Array): Promise<void> {
    const bytes = await bytesOf(data);
    const headers = condition(pid, rel);
    // Known before the answer, so this tab's own change doesn't come back as
    // someone else's on the change stream.
    const hash = await sha256(bytes);
    if (pid === currentId) hashes.set(rel, hash);
    const res = await fetch(fileEndpoint(pid, rel), { method: "PUT", credentials: "include", headers, body: new Blob([bytes as BlobPart]) });
    if (res.status === 412) {
      await conflicted(pid, rel);
      throw new Error(`${rel} was changed somewhere else`);
    }
    if (!res.ok) {
      if (pid === currentId) hashes.delete(rel);
      throw new Error(`Failed to write ${rel} (${res.status})`);
    }
  }

  async function deleteFile(pid: string, rel: string): Promise<void> {
    const res = await fetch(fileEndpoint(pid, rel), { method: "DELETE", credentials: "include", headers: condition(pid, rel) });
    if (res.status === 412) {
      await conflicted(pid, rel);
      throw new Error(`${rel} was changed somewhere else`);
    }
    if (!res.ok && res.status !== 404) throw new Error(`Failed to delete ${rel} (${res.status})`);
    if (pid === currentId) hashes.delete(rel);
  }

  async function freePath(pid: string, folder: string, name: string, except?: string): Promise<string> {
    const existing = new Set(await listFiles(pid, `${folder}/`));
    const stem = slugify(name);
    for (let n = 1; ; n++) {
      const rel = `${folder}/${stem}${n === 1 ? "" : `-${n}`}.json`;
      if (rel === except || !existing.has(rel)) return rel;
    }
  }

  // Cloud AgentFiles so in-app AI chat tools work on cloud projects too.
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
    exists: async (rel) => (await listFiles(requireOpen(), rel)).includes(rel),
  };

  // Phase 1 keeps library empty/minimal on cloud until Phase 2 cloud library.
  const emptyLibraryArea: FileArea = {
    read: async () => null,
    readText: async () => null,
    write: async () => {
      throw new Error("Cloud furniture library is coming in Phase 2");
    },
    listFiles: async () => [],
    listDirs: async () => [],
    exists: async () => false,
  };

  const agentFiles: AgentFiles = { project: projectArea, library: emptyLibraryArea };

  return {
    kind: "cloud",

    closeHome() {
      changes?.close();
      changes = null;
      hashes.clear();
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

    async listLibrary(): Promise<{ root: string; items: LibraryEntry[] }> {
      return { root: "cloud-library", items: [] };
    },

    async newLibraryItem() {
      throw new Error("Cloud furniture library is coming in Phase 2");
    },

    async writeLibraryFile() {
      throw new Error("Cloud furniture library is coming in Phase 2");
    },

    libraryFileUrl() {
      return "";
    },

    async deleteLibraryItem() {
      throw new Error("Cloud furniture library is coming in Phase 2");
    },

    async placeLibraryModel() {
      throw new Error("Cloud furniture library is coming in Phase 2");
    },

    async addLibraryMaterial() {
      throw new Error("Cloud furniture library is coming in Phase 2");
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
      // Cloud projects are saved continuously to S3.
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
      // Phase 2 realtime presence will use this.
    },

    onOpenSceneRequest(cb) {
      openSceneListeners.push(cb);
    },

    onScreenshotRequest() {
      // Phase 4 remote MCP will route screenshots here.
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
          hashes.delete(rel);
          announce(rel);
        }
      },
    },
  };
}
