// Named scene edits. Every change the UI makes goes through one of these, and
// the future MCP server will expose the same set to LLMs.
import type { SceneDoc } from "./schema";
import { round } from "./units";

export type ObjectDoc = NonNullable<SceneDoc["objects"]>[number];
type ObjectPatch = Partial<Omit<ObjectDoc, "id">>;

function updateObject(doc: SceneDoc, id: string, change: (object: ObjectDoc) => ObjectDoc): SceneDoc {
  const objects = doc.objects ?? [];
  if (!objects.some((o) => o.id === id)) return doc;
  return { ...doc, objects: objects.map((o) => (o.id === id ? change(o) : o)) };
}

// Drop keys set to undefined, so clearing a field removes it from the file.
function clean(object: ObjectDoc): ObjectDoc {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined)) as ObjectDoc;
}

// `attachedTo`: a wall id to attach to, null to detach, or leave out to keep.
export function moveObject(id: string, position: [number, number], extra: { room?: string; attachedTo?: string | null } = {}) {
  return (doc: SceneDoc) =>
    updateObject(doc, id, (o) =>
      clean({
        ...o,
        position: [round(position[0]), round(position[1])],
        room: extra.room ?? o.room,
        attachedTo: extra.attachedTo === undefined ? o.attachedTo : (extra.attachedTo ?? undefined),
      }),
    );
}

export function rotateObject(id: string, byDegrees: number) {
  return (doc: SceneDoc) =>
    // A rotated object no longer stands flat against its wall.
    updateObject(doc, id, (o) => clean({ ...o, rotation: (((o.rotation ?? 0) + byDegrees) % 360 + 360) % 360, attachedTo: undefined }));
}

export function setObjectProps(id: string, patch: ObjectPatch) {
  return (doc: SceneDoc) => updateObject(doc, id, (o) => clean({ ...o, ...patch }));
}

export function setTemplateParams(id: string, params: Record<string, number>) {
  return (doc: SceneDoc) => updateObject(doc, id, (o) => (o.template ? { ...o, params: { ...o.params, ...params } } : o));
}

// Turn a template object into a hand-built one with the given parts, so its
// parts can be edited individually.
export function detachTemplate(id: string, parts: NonNullable<ObjectDoc["parts"]>) {
  return (doc: SceneDoc) => updateObject(doc, id, (o) => clean({ ...o, template: undefined, params: undefined, parts }));
}

export function addObject(object: ObjectDoc) {
  return (doc: SceneDoc): SceneDoc => ({ ...doc, objects: [...(doc.objects ?? []), clean(object)] });
}

export function deleteObject(id: string) {
  return (doc: SceneDoc): SceneDoc => {
    const objects = doc.objects ?? [];
    return objects.some((o) => o.id === id) ? { ...doc, objects: objects.filter((o) => o.id !== id) } : doc;
  };
}

export function duplicateObject(id: string, newId: string, offset: [number, number] = [30, 30]) {
  return (doc: SceneDoc): SceneDoc => {
    const objects = doc.objects ?? [];
    const source = objects.find((o) => o.id === id);
    if (!source) return doc;
    const copy: ObjectDoc = {
      ...structuredClone(source),
      id: newId,
      position: [round(source.position[0] + offset[0]), round(source.position[1] + offset[1])],
      locked: undefined,
    };
    const index = objects.indexOf(source);
    return { ...doc, objects: [...objects.slice(0, index + 1), clean(copy), ...objects.slice(index + 1)] };
  };
}

// A unique, file-friendly id like "base-cabinet-3".
export function uniqueId(doc: SceneDoc, base: string): string {
  const taken = new Set((doc.objects ?? []).map((o) => o.id));
  const stem = base.replace(/-\d+$/, "");
  for (let n = 1; ; n++) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
