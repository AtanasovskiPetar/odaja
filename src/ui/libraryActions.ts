// Furniture library actions: placing items into the scene, saving scene
// objects to the library, and finishing a model import.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { slugify } from "../model/defaults";
import { roomAt } from "../model/geometry";
import { addObject, uniqueId, type ObjectDoc } from "../model/operations";
import type { LibraryItemDoc } from "../model/schema";
import { platform, type LibraryEntry } from "../platform";
import { useOdaja } from "../store";
import { configureGLTF, normalize, simplify, toGLB, type ImportSettings, type LoadedModel } from "../three/modelImport";
import { partsObject, renderThumbnail } from "../three/thumbnail";
import { dropPoint } from "./actions";

export const CATEGORIES = ["Kitchen", "Living", "Bedroom", "Bathroom", "Lighting", "Decor", "Other"];

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
  });
}

async function writeItem(name: string, category: string, notes: string | undefined, object: LibraryItemDoc["object"], files: { model?: ArrayBuffer | Blob; preview?: Blob }) {
  const id = await platform.newLibraryItem(name);
  if (files.model) await platform.writeLibraryFile(`${id}/model.glb`, files.model);
  if (files.preview) await platform.writeLibraryFile(`${id}/preview.png`, files.preview);
  const item: LibraryItemDoc = { version: 1, name, category, ...(notes ? { notes } : {}), object };
  await platform.writeLibraryFile(`${id}/item.json`, JSON.stringify(item, null, 2) + "\n");
  useOdaja.getState().libraryChanged();
  return id;
}

async function loadProjectModel(src: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  configureGLTF(loader);
  return (await loader.loadAsync(platform.fileUrl(src))).scene;
}

// Save an object from the open scene as a library item (with a preview).
export async function saveObjectToLibrary(objectId: string, name: string, category: string, notes?: string) {
  const { sceneDoc, scene, project } = useOdaja.getState();
  const doc = sceneDoc?.objects?.find((o) => o.id === objectId);
  const parsed = scene?.objects.find((o) => o.id === objectId);
  if (!doc || !parsed) throw new Error("object not found");
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
  return writeItem(name, category, notes, object, { model, preview });
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
    const id = await writeItem(options.name, options.category, undefined, { model: { src: "model.glb", size } }, { model: glb, preview });
    if (options.placeInScene) {
      place({ name: options.name, model: { src: await platform.placeLibraryModel(id), size } });
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
