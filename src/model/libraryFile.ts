// Library files, to keep or share your own furniture and materials:
//  - `.odaja-item`: one item (item.json, its model, preview and texture).
//  - `.odaja-library`: many items, each in a folder named by its id.
// Both are zips with an odaja.json saying what they are, like .odaja homes.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { safePath } from "./homeFile";
import { LibraryItemSchema, type LibraryItemDoc } from "./schema";

export const ITEM_EXTENSION = ".odaja-item";
export const LIBRARY_EXTENSION = ".odaja-library";
const MANIFEST = "odaja.json";
const VERSION = 1;
const MAX_SIZE = 1024 * 1024 * 1024;

// The files a library item can have, besides item.json.
const ITEM_FILE = /^(item\.json|model\.glb|preview\.png|texture\.(jpg|jpeg|png|webp))$/;

export interface ItemFiles {
  id: string;
  item: LibraryItemDoc;
  files: Record<string, Uint8Array>; // item.json, model.glb, preview.png, texture.*
}

const compressible = (name: string) => name.endsWith(".json");

function manifest(format: "odaja-item" | "odaja-library") {
  return strToU8(JSON.stringify({ format, version: VERSION, savedAt: new Date().toISOString() }, null, 2));
}

export function packItem(entry: ItemFiles): Uint8Array {
  const zip: Zippable = { [MANIFEST]: [manifest("odaja-item"), { level: 6 }] };
  for (const [name, data] of Object.entries(entry.files)) zip[name] = [data, { level: compressible(name) ? 6 : 0 }];
  return zipSync(zip);
}

export function packLibrary(entries: ItemFiles[]): Uint8Array {
  const zip: Zippable = { [MANIFEST]: [manifest("odaja-library"), { level: 6 }] };
  for (const entry of entries) {
    for (const [name, data] of Object.entries(entry.files)) zip[`${entry.id}/${name}`] = [data, { level: compressible(name) ? 6 : 0 }];
  }
  return zipSync(zip);
}

function readItem(id: string, files: Record<string, Uint8Array>): ItemFiles {
  const json = files["item.json"];
  if (!json) throw new Error(`"${id}" has no item.json`);
  const parsed = LibraryItemSchema.safeParse(JSON.parse(strFromU8(json)));
  if (!parsed.success) throw new Error(`"${id}" isn't a valid library item`);
  const kept = Object.fromEntries(Object.entries(files).filter(([name]) => ITEM_FILE.test(name)));
  return { id, item: JSON.parse(strFromU8(json)), files: kept };
}

// The items in a .odaja-item or .odaja-library file (either is accepted).
export function unpackLibraryFile(data: Uint8Array, fileName = "item"): ItemFiles[] {
  if (data.byteLength > MAX_SIZE) throw new Error("That file is too large.");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error("That isn't an Odaja library file (it's not a zip, or it's damaged).");
  }
  let format = "";
  if (entries[MANIFEST]) {
    try {
      const m = JSON.parse(strFromU8(entries[MANIFEST]));
      format = String(m.format ?? "");
      if (m.version > VERSION) throw new Error("This file was saved by a newer Odaja. Update Odaja to open it.");
    } catch (err) {
      if ((err as Error).message.startsWith("This file")) throw err;
    }
  }
  for (const path of Object.keys(entries)) {
    if (!path.endsWith("/") && !safePath(path)) throw new Error(`That file has an unsafe path in it (${path}).`);
  }
  // One item: its files at the top.
  if (format === "odaja-item" || (!format && entries["item.json"])) {
    const id = fileName.replace(/\.odaja-item$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "item";
    return [readItem(id, entries)];
  }
  // A library: one folder per item.
  const byId = new Map<string, Record<string, Uint8Array>>();
  for (const [path, bytes] of Object.entries(entries)) {
    const [id, name, ...rest] = path.split("/");
    if (!name || rest.length || path.endsWith("/")) continue;
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)![name] = bytes;
  }
  const items = [...byId].filter(([, files]) => files["item.json"]).map(([id, files]) => readItem(id, files));
  if (items.length === 0) throw new Error("That file has no library items in it.");
  return items;
}
