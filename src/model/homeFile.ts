// .odaja files: a whole home in one file, to keep, move or send. It's a zip
// of the project folder (project.json, shell.json, shells/, scenes/, assets/)
// plus a small odaja.json saying what it is. Used by the website and the
// companion alike, so both read and write exactly the same files.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

export const HOME_EXTENSION = ".odaja";
const MANIFEST = "odaja.json";
const FORMAT = "odaja-home";
const VERSION = 1;
// Generous, but stops a wrong file from filling the browser's storage.
const MAX_SIZE = 1024 * 1024 * 1024;

// Project files that belong in a saved home. Agent docs are regenerated
// wherever the home is opened; chats are included only when asked for.
export function belongsInFile(path: string, includeChats: boolean): boolean {
  const name = path.split("/").pop() ?? "";
  if (name === ".DS_Store" || name === ".keep") return false;
  if (path === "AGENTS.md" || path === "CLAUDE.md" || path === MANIFEST) return false;
  if (path.startsWith(".odaja/")) return includeChats && path.startsWith(".odaja/chats/");
  return !name.startsWith(".");
}

// Already-compressed files (models, photos) are stored as they are.
const compressible = (path: string) => /\.(json|md|txt|svg|obj|mtl|dae)$/i.test(path);

export function packHome(files: Record<string, Uint8Array>): Uint8Array {
  const zip: Zippable = {
    [MANIFEST]: [strToU8(JSON.stringify({ format: FORMAT, version: VERSION, savedAt: new Date().toISOString() }, null, 2)), { level: 6 }],
  };
  for (const [path, data] of Object.entries(files)) zip[path] = [data, { level: compressible(path) ? 6 : 0 }];
  return zipSync(zip);
}

function safePath(path: string): boolean {
  return !!path && !path.startsWith("/") && !/^[a-zA-Z]:/.test(path) && !path.split("/").some((p) => p === ".." || p === "");
}

// The files of a saved home, checked: it must be a home, every path must stay
// inside it, and it mustn't be absurdly large.
export function unpackHome(data: Uint8Array): Record<string, Uint8Array> {
  if (data.byteLength > MAX_SIZE) throw new Error("That file is too large to be an Odaja home.");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error("That isn't an Odaja home file (it isn't a .odaja file, or it's damaged).");
  }
  // A home zipped by hand often has everything inside one folder: unwrap it.
  const paths = Object.keys(entries).filter((p) => !p.endsWith("/"));
  if (!paths.includes("project.json")) {
    const top = new Set(paths.map((p) => p.split("/")[0]));
    const [only] = top;
    if (top.size === 1 && paths.includes(`${only}/project.json`)) {
      entries = Object.fromEntries(paths.map((p) => [p.slice(only.length + 1), entries[p]]));
    }
  }
  const manifest = entries[MANIFEST];
  if (manifest) {
    try {
      const m = JSON.parse(strFromU8(manifest));
      if (m.format === FORMAT && m.version > VERSION) throw new Error("This home was saved by a newer Odaja. Update Odaja to open it.");
    } catch (err) {
      if ((err as Error).message.startsWith("This home")) throw err;
    }
  }
  if (!entries["project.json"]) throw new Error("That file isn't an Odaja home (there's no project.json in it).");
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/") || path === MANIFEST) continue;
    if (!safePath(path)) throw new Error(`That file has an unsafe path in it (${path}).`);
    if (!belongsInFile(path, true)) continue;
    total += bytes.byteLength;
    if (total > MAX_SIZE) throw new Error("That file is too large to be an Odaja home.");
    out[path] = bytes;
  }
  return out;
}

// The home's name, read from its project.json.
export function homeName(files: Record<string, Uint8Array>, fallback = "Home"): string {
  try {
    return String(JSON.parse(strFromU8(files["project.json"])).name ?? fallback).trim() || fallback;
  } catch {
    return fallback;
  }
}

// A file name for saving: the home's name, without characters file systems refuse.
export function homeFileName(name: string): string {
  const clean = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${clean || "Home"}${HOME_EXTENSION}`;
}

export const hasChats = (files: Record<string, Uint8Array>) => Object.keys(files).some((p) => p.startsWith(".odaja/chats/"));
