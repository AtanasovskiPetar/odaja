// Named edits to a scene's finishes (tiles, paint, floors).
import { roomWallSides } from "./finishes";
import type { SceneDoc, Shell } from "./schema";

export type FinishDoc = NonNullable<SceneDoc["finishes"]>[number];

const r1 = (n: number) => Math.round(n * 10) / 10;

function uniqueFinishId(doc: SceneDoc, base: string) {
  const taken = new Set((doc.finishes ?? []).map((f) => f.id));
  for (let n = 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function addFinish(finish: Omit<FinishDoc, "id">) {
  return (doc: SceneDoc): SceneDoc => ({
    ...doc,
    finishes: [...(doc.finishes ?? []), clean({ id: uniqueFinishId(doc, finish.surface === "floor" ? "floor" : "finish"), ...finish })],
  });
}

export function updateFinish(id: string, patch: Partial<Omit<FinishDoc, "id">>) {
  return (doc: SceneDoc): SceneDoc => ({
    ...doc,
    finishes: (doc.finishes ?? []).map((f) => (f.id === id ? clean({ ...f, ...patch }) : f)),
  });
}

export function removeFinishes(ids: string[]) {
  const set = new Set(ids);
  return (doc: SceneDoc): SceneDoc => ({ ...doc, finishes: (doc.finishes ?? []).filter((f) => !set.has(f.id)) });
}

// The floor finish of a room (replacing any earlier one); null removes it so
// the room's own floor shows again.
export function setRoomFloor(room: string, material: string | null) {
  return (doc: SceneDoc): SceneDoc => {
    const rest = (doc.finishes ?? []).filter((f) => !(f.surface === "floor" && f.room === room));
    const next = { ...doc, finishes: rest };
    return material ? addFinish({ surface: "floor", room, material })(next) : next;
  };
}

// Finish every wall side facing a room from `bottom` to `top` (e.g. tiles up
// to 200 cm in a bathroom), replacing earlier finishes on those sides.
export function finishRoomWalls(shell: Shell, roomId: string, material: string, bottom = 0, top?: number) {
  return (doc: SceneDoc): SceneDoc => {
    const room = shell.rooms.find((r) => r.id === roomId);
    if (!room) return doc;
    const sides = roomWallSides(shell, room);
    const covers = (f: FinishDoc) => f.surface !== "floor" && sides.some((s) => s.wall === f.wall && s.side === f.side && (f.from ?? -Infinity) < s.to && (f.to ?? Infinity) > s.from);
    let next: SceneDoc = { ...doc, finishes: (doc.finishes ?? []).filter((f) => !covers(f)) };
    for (const s of sides) {
      next = addFinish({ surface: "wall", wall: s.wall, side: s.side, material, from: r1(s.from), to: r1(s.to), bottom: bottom || undefined, top })(next);
    }
    return next;
  };
}

// Remove all wall finishes facing a room.
export function clearRoomWalls(shell: Shell, roomId: string) {
  return (doc: SceneDoc): SceneDoc => {
    const room = shell.rooms.find((r) => r.id === roomId);
    if (!room) return doc;
    const sides = roomWallSides(shell, room);
    return {
      ...doc,
      finishes: (doc.finishes ?? []).filter((f) => !(f.surface !== "floor" && sides.some((s) => s.wall === f.wall && s.side === f.side && (f.from ?? -Infinity) < s.to && (f.to ?? Infinity) > s.from))),
    };
  };
}
