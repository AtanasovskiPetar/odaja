// Furniture library actions: placing items into the scene, saving scene
// objects to the library, and finishing a model import.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { slugify } from "../model/defaults";
import { roomAt } from "../model/geometry";
import { addObject, uniqueId, type ObjectDoc } from "../model/operations";
import { ObjectSchema, type LibraryItemDoc, type MaterialDoc } from "../model/schema";
import { platform, type LibraryEntry } from "../platform";
import { useOdaja } from "../store";
import { configureGLTF, normalize, simplify, toGLB, type ImportSettings, type LoadedModel } from "../three/modelImport";
import { partsObject, renderThumbnail } from "../three/thumbnail";
import { dropPoint } from "./actions";

export const CATEGORIES = ["Kitchen", "Living", "Bedroom", "Bathroom", "Garden", "Lighting", "Decor", "Other"];

function place(object: Omit<ObjectDoc, "id" | "position" | "room">) {
  const { sceneDoc, shell, apply, select, mode, setMode } = useOdaja.getState();
  if (!sceneDoc) return;
  if (mode !== "furnish") setMode("furnish");
  const position = dropPoint();
  const id = uniqueId(sceneDoc, slugify(object.name).replace(/[^a-z0-9-]/g, "") || "object");
  apply(addObject({ id, ...object, position, room: shell ? roomAt(shell, position) : undefined } as ObjectDoc));
  select(id);
}

export async function placeLibraryEntry(entry: LibraryEntry) {
  const { item } = entry;
  const o = item.object;
  if (!o) return addLibraryMaterial(entry);
  const model = o.model ? { src: await platform.placeLibraryModel(entry.id), size: o.model.size } : undefined;
  place({
    name: item.name,
    notes: item.notes,
    elevation: o.elevation,
    template: o.template,
    params: o.params,
    parts: o.parts,
    model,
    libraryItem: { id: entry.id, category: item.category },
  });
}

// A library item ready to write: item.json plus its files.
export interface BuiltItem {
  item: LibraryItemDoc;
  files: { model?: ArrayBuffer | Blob; preview?: Blob; texture?: { ext: string; data: Blob } };
}

// Write an item into the library. `idHint` keeps an item's original id when
// it comes back from a saved home, so the home's objects still point at it.
export async function writeItem(built: BuiltItem, idHint?: string) {
  const id = await platform.newLibraryItem(idHint ?? built.item.name);
  const { model, preview, texture } = built.files;
  if (model) await platform.writeLibraryFile(`${id}/model.glb`, model);
  if (preview) await platform.writeLibraryFile(`${id}/preview.png`, preview);
  if (texture) await platform.writeLibraryFile(`${id}/texture.${texture.ext}`, texture.data);
  await platform.writeLibraryFile(`${id}/item.json`, JSON.stringify(built.item, null, 2) + "\n");
  useOdaja.getState().libraryChanged();
  return id;
}

function item(name: string, category: string, notes: string | undefined, body: Pick<LibraryItemDoc, "object" | "material">): LibraryItemDoc {
  return { version: 1, name, category, ...(notes ? { notes } : {}), ...body };
}

async function loadProjectModel(src: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  configureGLTF(loader);
  return (await loader.loadAsync(platform.fileUrl(src))).scene;
}

// An object (from any scene of the open home) as a library item, with a preview.
export async function buildObjectItem(doc: ObjectDoc, name: string, category: string, notes?: string): Promise<BuiltItem> {
  const { project } = useOdaja.getState();
  const parsed = ObjectSchema.parse(doc);
  const object: LibraryItemDoc["object"] = {
    ...(doc.elevation ? { elevation: doc.elevation } : {}),
    ...(doc.template ? { template: doc.template, params: doc.params } : {}),
    ...(doc.parts ? { parts: doc.parts } : {}),
    ...(doc.model ? { model: { src: "model.glb" as const, size: doc.model.size } } : {}),
  };
  let model: Blob | undefined;
  let view: THREE.Object3D;
  if (doc.model) {
    model = await fetch(platform.fileUrl(doc.model.src)).then((r) => r.blob());
    view = await loadProjectModel(doc.model.src);
  } else {
    view = partsObject(parsed.parts, project?.materials);
  }
  const preview = await renderThumbnail(view).catch(() => undefined);
  return { item: item(name, category, notes, { object }), files: { model, preview } };
}

// A material of the open home as a library item (its texture comes along).
export async function buildMaterialItem(material: MaterialDoc, name: string, category: string): Promise<BuiltItem> {
  const { libraryItem: _, ...rest } = material;
  const body = structuredClone(rest);
  let texture: BuiltItem["files"]["texture"];
  if (body.tile?.image) {
    const ext = (body.tile.image.split(".").pop() ?? "jpg").toLowerCase();
    texture = { ext, data: await fetch(platform.fileUrl(body.tile.image)).then((r) => r.blob()) };
    body.tile.image = `texture.${ext}`;
  }
  return { item: item(name, category, undefined, { material: body as LibraryItemDoc["material"] }), files: { texture } };
}

// Save an object from the open scene as a library item (with a preview).
export async function saveObjectToLibrary(objectId: string, name: string, category: string, notes?: string) {
  const doc = useOdaja.getState().sceneDoc?.objects?.find((o) => o.id === objectId);
  if (!doc) throw new Error("object not found");
  return writeItem(await buildObjectItem(doc, name, category, notes));
}

export interface ImportOptions {
  name: string;
  category: string;
  settings: ImportSettings;
  size: [number, number, number]; // final size in cm
  simplifyTo?: number; // triangles
  saveToLibrary: boolean;
  placeInScene: boolean;
}

// Convert an imported model to GLB and save it to the library and/or the scene.
export async function finishImport(loaded: LoadedModel, options: ImportOptions) {
  const { group } = normalize(loaded.object, options.settings);
  if (options.simplifyTo) await simplify(group, options.simplifyTo);
  const glb = await toGLB(group);
  const size = options.size;

  if (options.saveToLibrary) {
    const preview = await renderThumbnail(group).catch(() => undefined);
    const id = await writeItem({ item: item(options.name, options.category, undefined, { object: { model: { src: "model.glb", size } } }), files: { model: glb, preview } });
    if (options.placeInScene) {
      place({ name: options.name, model: { src: await platform.placeLibraryModel(id), size }, libraryItem: { id, category: options.category } });
    }
    return;
  }
  if (options.placeInScene) {
    const src = `assets/models/${slugify(options.name)}-${Math.random().toString(36).slice(2, 8)}.glb`;
    await platform.writeFile(src, glb);
    place({ name: options.name, model: { src, size } });
  }
}

// A material item (e.g. a tile) from the library: copy it into the project's
// materials, with its texture, so finishes can use it.
export async function addLibraryMaterial(entry: LibraryEntry) {
  const material = entry.item.material;
  if (!material) return;
  const name = await platform.addLibraryMaterial(entry.id);
  useOdaja.getState().setNotice(`Added the material “${name}” to this project. Use it under Structure → finishes.`);
}
