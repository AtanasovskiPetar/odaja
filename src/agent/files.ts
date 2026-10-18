// What the AI tools need from wherever the home is kept: the project's files
// and the furniture library. The companion gives them folders on disk
// (server/agentFiles.ts); the website gives them the browser's storage
// (src/browser/platform.ts). Paths are relative and "/"-separated.
export type FileData = Uint8Array | string;

export interface FileArea {
  read(path: string): Promise<Uint8Array | null>;
  readText(path: string): Promise<string | null>;
  // Creates folders as needed.
  write(path: string, data: FileData): Promise<void>;
  // Names of the files (not folders) directly inside a folder.
  listFiles(dir: string): Promise<string[]>;
  // Names of the folders directly inside a folder.
  listDirs(dir: string): Promise<string[]>;
  // A file or a folder.
  exists(path: string): Promise<boolean>;
}

export interface AgentFiles {
  project: FileArea;
  library: FileArea;
}

// Paths given by a model must stay inside their area.
export function checkPath(path: string): string {
  const parts = path.split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.includes("..") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) throw new Error(`invalid path: ${path}`);
  return parts.join("/");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const extension = (path: string) => {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};
