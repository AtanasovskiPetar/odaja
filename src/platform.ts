// Everything the app needs from the host environment. The browser build talks
// to the dev server (server/project-server.ts); the Tauri build will provide a
// native implementation of the same interface.
export interface Platform {
  listScenes(): Promise<{ dir: string; scenes: string[] }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  onFileChanged(callback: (path: string) => void): void;
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

export const platform: Platform = {
  async listScenes() {
    return (await check(await fetch("/api/project"))).json();
  },
  async readFile(path) {
    return (await check(await fetch(`/api/file?path=${encodeURIComponent(path)}`))).text();
  },
  async writeFile(path, text) {
    await check(await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: "PUT", body: text }));
  },
  onFileChanged(callback) {
    import.meta.hot?.on("odaja:file-changed", (data: { path: string }) => callback(data.path));
  },
};
