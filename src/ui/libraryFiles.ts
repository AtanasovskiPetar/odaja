// Your library as files: save one item or the whole library, open such files
// (they're added to the library), and after opening a home, add the library
// items it uses that you don't have yet.
import { ITEM_EXTENSION, LIBRARY_EXTENSION, packItem, packLibrary, unpackLibraryFile, type ItemFiles } from "../model/libraryFile";
import type { ObjectDoc } from "../model/operations";
import type { MaterialDoc, SceneDoc } from "../model/schema";
import { platform, type LibraryEntry } from "../platform";
import { useOdaja } from "../store";
import { download } from "./homeFileActions";
import { buildMaterialItem, buildObjectItem, writeItem, type BuiltItem } from "./libraryActions";

export const isLibraryFile = (file: File) => /\.odaja-(item|library)$/i.test(file.name);

const fileBaseName = (name: string) => name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "-").trim() || "Item";

async function bytes(blob: Blob | ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(blob instanceof Blob ? await blob.arrayBuffer() : blob);
}

// A library entry's files, read back from the library.
async function entryFiles(entry: LibraryEntry): Promise<ItemFiles> {
  const files: Record<string, Uint8Array> = { "item.json": new TextEncoder().encode(JSON.stringify(entry.item, null, 2) + "\n") };
  const names = [
    entry.preview && "preview.png",
    entry.item.object?.model && "model.glb",
    entry.item.material?.tile?.image,
  ].filter((n): n is string => !!n);
  for (const name of names) {
    const res = await fetch(platform.libraryFileUrl(`${entry.id}/${name}`, entry.modified));
    if (res.ok) files[name] = await bytes(await res.blob());
  }
  return { id: entry.id, item: entry.item, files };
}

// A built (not yet saved) item as files.
async function builtFiles(id: string, built: BuiltItem): Promise<ItemFiles> {
  const files: Record<string, Uint8Array> = { "item.json": new TextEncoder().encode(JSON.stringify(built.item, null, 2) + "\n") };
  if (built.files.model) files["model.glb"] = await bytes(built.files.model);
  if (built.files.preview) files["preview.png"] = await bytes(built.files.preview);
  if (built.files.texture) files[`texture.${built.files.texture.ext}`] = await bytes(built.files.texture.data);
  return { id, item: built.item, files };
}

const blobOf = (data: Uint8Array) => new Blob([data as BlobPart], { type: "application/octet-stream" });

export async function saveItemFile(entry: LibraryEntry) {
  download(blobOf(packItem(await entryFiles(entry))), `${fileBaseName(entry.item.name)}${ITEM_EXTENSION}`);
}

// An object straight from the scene as an item file, without adding it to your library.
export async function saveObjectAsItemFile(doc: ObjectDoc, category: string) {
  const built = await buildObjectItem(doc, doc.name, category, doc.notes);
  download(blobOf(packItem(await builtFiles(doc.id, built))), `${fileBaseName(doc.name)}${ITEM_EXTENSION}`);
}

export async function saveLibraryFile() {
  const { items } = await platform.listLibrary();
  if (items.length === 0) throw new Error("Your library is empty.");
  const entries = await Promise.all(items.map(entryFiles));
  download(blobOf(packLibrary(entries)), `My library${LIBRARY_EXTENSION}`);
}

// Add the items in a .odaja-item / .odaja-library file to your library.
// Items you already have (same id, same content) are skipped.
export async function openLibraryFile(file: File): Promise<string[]> {
  const items = unpackLibraryFile(new Uint8Array(await file.arrayBuffer()), file.name);
  const { items: existing } = await platform.listLibrary();
  const have = new Map(existing.map((e) => [e.id, JSON.stringify(e.item)]));
  const added: string[] = [];
  for (const { id, item, files } of items) {
    if (have.get(id) === JSON.stringify(item)) continue;
    const newId = await platform.newLibraryItem(id);
    // item.json last: an item only shows up once it's complete.
    for (const [name, data] of Object.entries(files)) if (name !== "item.json") await platform.writeLibraryFile(`${newId}/${name}`, blobOf(data));
    await platform.writeLibraryFile(`${newId}/item.json`, blobOf(files["item.json"]));
    added.push(item.name);
  }
  useOdaja.getState().libraryChanged();
  return added;
}

export async function openLibraryFileWithNotice(file: File) {
  const { setNotice } = useOdaja.getState();
  try {
    const added = await openLibraryFile(file);
    setNotice(added.length === 0 ? "You already have everything in that file." : added.length === 1 ? `Added “${added[0]}” to your library.` : `Added ${added.length} items to your library.`);
  } catch (err) {
    setNotice(`Couldn't open ${file.name}: ${(err as Error).message}`);
  }
}

// --- items a home uses that aren't in your library --------------------------

export interface MissingItem {
  id: string;
  name: string;
  category: string;
  kind: "object" | "material";
  object?: ObjectDoc;
  material?: MaterialDoc;
}

// Library items placed in the open home (any scene) or used as materials,
// that aren't in your library.
export async function findMissingLibraryItems(): Promise<MissingItem[]> {
  const found = new Map<string, MissingItem>();
  const { scenes } = await platform.listScenes();
  for (const { path } of scenes) {
    const scene = JSON.parse(await platform.readFile(path).catch(() => "{}")) as SceneDoc;
    for (const o of scene.objects ?? []) {
      const ref = o.libraryItem;
      if (ref && !found.has(ref.id)) found.set(ref.id, { id: ref.id, name: o.name, category: ref.category ?? "Other", kind: "object", object: o as ObjectDoc });
    }
  }
  const project = JSON.parse(await platform.readFile("project.json").catch(() => "{}")) as { materials?: Record<string, MaterialDoc> };
  for (const [name, m] of Object.entries(project.materials ?? {})) {
    const ref = m.libraryItem;
    if (ref && !found.has(ref.id)) found.set(ref.id, { id: ref.id, name, category: ref.category ?? "Materials", kind: "material", material: m });
  }
  if (found.size === 0) return [];
  const { items } = await platform.listLibrary();
  const have = new Set(items.map((e) => e.id));
  return [...found.values()].filter((m) => !have.has(m.id));
}

export async function addMissingToLibrary(missing: MissingItem[]) {
  for (const m of missing) {
    const built =
      m.kind === "object" && m.object
        ? await buildObjectItem(m.object, m.name, m.category, m.object.notes)
        : await buildMaterialItem(m.material!, m.name, m.category);
    await writeItem(built, m.id);
  }
}

