// Everything the app needs from the host environment: Odaja's backend
// (server/api.ts) over /api, served by Vite in development and by
// server/main.ts standalone (and, later, inside the desktop app).
import type { StarterRoom } from "./model/defaults";
import type { LibraryItemDoc, SceneDoc } from "./model/schema";

export interface ProjectSummary {
  dir: string;
  name: string;
  modified: number;
}

export interface SceneSummary {
  path: string;
  name: string;
  shell: string; // the shell file this scene uses
}

export interface LibraryEntry {
  id: string;
  item: LibraryItemDoc;
  preview: boolean;
  modified: number;
}

type Body = string | Blob | ArrayBuffer;

export interface Platform {
  listProjects(): Promise<{ root: string; current: string | null; projects: ProjectSummary[]; sampleDir: string; sampleCopied: boolean }>;
  openProject(dir: string): Promise<void>;
  // Opens the user's copy of the sample flat, making it (or remaking it when fresh).
  openSample(fresh: boolean): Promise<void>;
  createProject(name: string, room?: StarterRoom): Promise<void>;
  closeProject(): Promise<void>;
  listScenes(): Promise<{ dir: string; scenes: SceneSummary[] }>;
  createScene(name: string, content: SceneDoc): Promise<string>;
  renameScene(path: string, name: string): Promise<string>;
  deleteScene(path: string): Promise<void>;
  copyShell(from: string, name: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: Body): Promise<void>;
  // URL the app can load a project file from (models, images).
  fileUrl(path: string): string;
  listLibrary(): Promise<{ root: string; items: LibraryEntry[] }>;
  newLibraryItem(name: string): Promise<string>;
  writeLibraryFile(path: string, data: Body): Promise<void>;
  libraryFileUrl(path: string): string;
  deleteLibraryItem(id: string): Promise<void>;
  // Copy a library item's model into the open project; returns its path there.
  placeLibraryModel(id: string): Promise<string>;
  // Add a library material (and its texture) to the open project; returns its name.
  addLibraryMaterial(id: string): Promise<string>;
  onFileChanged(callback: (path: string) => void): void;
  // Tell the server what the app is showing (tools default to the open scene).
  reportUiState(state: { scenePath?: string | null; editingObject?: string | null }): void;
  // Requests from the server: open a scene, take a screenshot.
  onOpenSceneRequest(callback: (path: string) => void): void;
  onScreenshotRequest(callback: (view: "plan" | "3d") => Promise<{ data: string; mimeType: string }>): void;
}

// Events from the server (file changes, requests from agents) arrive on one
// shared stream. EventSource reconnects by itself if the server restarts.
let events: EventSource | null = null;
function onEvent<T>(name: string, callback: (data: T) => void) {
  events ??= new EventSource("/api/events");
  events.addEventListener(name, (e) => callback(JSON.parse((e as MessageEvent<string>).data) as T));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Not JSON: use the raw text.
    }
    throw new Error(message);
  }
  return (res.headers.get("Content-Type")?.includes("application/json") ? JSON.parse(text) : text) as T;
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`;
const libraryFileUrl = (path: string) => `/api/library/file?path=${encodeURIComponent(path)}`;

export const platform: Platform = {
  listProjects: () => request("/api/projects"),
  async openProject(dir) {
    await post("/api/projects/open", { dir });
  },
  async openSample(fresh) {
    await post("/api/projects/sample", { fresh });
  },
  async createProject(name, room) {
    await post("/api/projects/create", { name, room });
  },
  async closeProject() {
    await post("/api/projects/close", {});
  },
  listScenes: () => request("/api/project"),
  async createScene(name, content) {
    return (await post<{ path: string }>("/api/scenes/create", { name, content })).path;
  },
  async renameScene(path, name) {
    return (await post<{ path: string }>("/api/scenes/rename", { path, name })).path;
  },
  async deleteScene(path) {
    await post("/api/scenes/delete", { path });
  },
  async copyShell(from, name) {
    return (await post<{ path: string }>("/api/shells/copy", { from, name })).path;
  },
  async readFile(path) {
    const res = await fetch(fileUrl(path), { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return text;
  },
  async writeFile(path, data) {
    await request(fileUrl(path), { method: "PUT", body: data });
  },
  fileUrl,
  listLibrary: () => request("/api/library"),
  async newLibraryItem(name) {
    return (await post<{ id: string }>("/api/library/new", { name })).id;
  },
  async writeLibraryFile(path, data) {
    await request(libraryFileUrl(path), { method: "PUT", body: data });
  },
  libraryFileUrl,
  async deleteLibraryItem(id) {
    await post("/api/library/delete", { id });
  },
  async placeLibraryModel(id) {
    return (await post<{ src: string }>("/api/library/place-model", { id })).src;
  },
  async addLibraryMaterial(id) {
    return (await post<{ name: string }>("/api/library/add-material", { id })).name;
  },
  onFileChanged(callback) {
    onEvent<{ path: string }>("file-changed", (data) => callback(data.path));
  },
  reportUiState(state) {
    post("/api/ui-state", state).catch(() => {});
  },
  onOpenSceneRequest(callback) {
    onEvent<{ path: string }>("open-scene", (data) => callback(data.path));
  },
  onScreenshotRequest(callback) {
    onEvent<{ id: string; view: "plan" | "3d" }>("screenshot", async (data) => {
      try {
        const shot = await callback(data.view);
        await post("/api/screenshot-result", { id: data.id, ...shot });
      } catch (err) {
        await post("/api/screenshot-result", { id: data.id, error: (err as Error).message });
      }
    });
  },
};
