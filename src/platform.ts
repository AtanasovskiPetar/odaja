// Everything the app needs from the host environment. The browser build talks
// to the dev server (server/project-server.ts); the Tauri build will provide a
// native implementation of the same interface.
import type { StarterRoom } from "./model/defaults";
import type { SceneDoc } from "./model/schema";

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

export interface Platform {
  listProjects(): Promise<{ root: string; current: string | null; projects: ProjectSummary[] }>;
  openProject(dir: string): Promise<void>;
  createProject(name: string, room?: StarterRoom): Promise<void>;
  closeProject(): Promise<void>;
  listScenes(): Promise<{ dir: string; scenes: SceneSummary[] }>;
  createScene(name: string, content: SceneDoc): Promise<string>;
  renameScene(path: string, name: string): Promise<string>;
  deleteScene(path: string): Promise<void>;
  copyShell(from: string, name: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  onFileChanged(callback: (path: string) => void): void;
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

export const platform: Platform = {
  listProjects: () => request("/api/projects"),
  async openProject(dir) {
    await post("/api/projects/open", { dir });
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
  readFile: (path) => request<string>(fileUrl(path)),
  async writeFile(path, text) {
    await request(fileUrl(path), { method: "PUT", body: text });
  },
  onFileChanged(callback) {
    import.meta.hot?.on("odaja:file-changed", (data: { path: string }) => callback(data.path));
  },
};
