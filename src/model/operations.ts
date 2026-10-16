// Named scene edits. Every change the UI makes goes through one of these, and
// the future MCP server will expose the same set to LLMs.
import type { SceneDoc } from "./schema";
import { round } from "./units";

type ObjectDoc = SceneDoc["objects"] extends (infer O)[] | undefined ? O : never;

function updateObject(doc: SceneDoc, id: string, change: (object: ObjectDoc) => ObjectDoc): SceneDoc {
  const objects = doc.objects ?? [];
  if (!objects.some((o) => o.id === id)) return doc;
  return { ...doc, objects: objects.map((o) => (o.id === id ? change(o) : o)) };
}

export function moveObject(id: string, position: [number, number]) {
  return (doc: SceneDoc) =>
    updateObject(doc, id, (o) => ({ ...o, position: [round(position[0]), round(position[1])] }));
}

export function rotateObject(id: string, byDegrees: number) {
  return (doc: SceneDoc) =>
    updateObject(doc, id, (o) => ({ ...o, rotation: (((o.rotation ?? 0) + byDegrees) % 360 + 360) % 360 }));
}
