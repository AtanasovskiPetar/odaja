// Small scene edits used as quick fixes by the issue checks.
import type { SceneDoc } from "./schema";
import { round } from "./units";

export function moveObjectBy(id: string, delta: [number, number]) {
  return (doc: SceneDoc): SceneDoc => ({
    ...doc,
    objects: (doc.objects ?? []).map((o) =>
      o.id === id ? { ...o, position: [round(o.position[0] + delta[0]), round(o.position[1] + delta[1])] as [number, number] } : o,
    ),
  });
}

export function deleteObjectField(id: string, field: "attachedTo" | "room") {
  return (doc: SceneDoc): SceneDoc => ({
    ...doc,
    objects: (doc.objects ?? []).map((o) => {
      if (o.id !== id) return o;
      const copy = { ...o };
      delete copy[field];
      return copy;
    }),
  });
}
