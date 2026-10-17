// Objects attached to walls: snapping an object's back against a wall face,
// and moving attached objects when their wall moves.
import { pointOnWall, wallDir, wallLength, wallNormal, type Vec } from "./geometry";
import { partBox } from "./parts";
import type { Part, SceneDoc, Shell, Wall } from "./schema";

const SNAP_DISTANCE = 15; // cm
const PARALLEL = 0.985; // cos(10°)

const rotate = ([x, y]: Vec, degrees: number): Vec => {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

// Footprint of an object in its own frame (before its rotation).
export function localBounds(parts: Part[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    for (const [x, y] of partBox(part).corners) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

const wallAngle = (wall: Wall) => (Math.atan2(wall.to[1] - wall.from[1], wall.to[0] - wall.from[0]) * 180) / Math.PI;

// If the object's back (its +y side) is facing a nearby wall, return the
// position that puts its back flat against the wall face.
export function snapToWall(
  parts: Part[],
  rotation: number,
  position: Vec,
  walls: Wall[],
): { position: Vec; wall: string } | null {
  const bounds = localBounds(parts);
  const back = rotate([0, 1], rotation);
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  let best: { position: Vec; wall: string; gap: number } | null = null;
  for (const wall of walls) {
    const len = wallLength(wall);
    if (len < 1) continue;
    const dir = wallDir(wall);
    const normal = wallNormal(wall);
    const rel: Vec = [position[0] - wall.from[0], position[1] - wall.from[1]];
    const along = rel[0] * dir[0] + rel[1] * dir[1];
    if (along < -halfWidth || along > len + halfWidth) continue;
    // Which face: the side of the wall the object is on.
    const side = Math.sign(rel[0] * normal[0] + rel[1] * normal[1]) || 1;
    const n: Vec = [normal[0] * side, normal[1] * side];
    if (back[0] * -n[0] + back[1] * -n[1] < PARALLEL) continue;
    const face = wall.thickness / 2;
    // Distance from the face to the object's back plane.
    const centre = rel[0] * n[0] + rel[1] * n[1];
    const gap = centre - bounds.maxY - face;
    if (Math.abs(gap) > SNAP_DISTANCE || (best && Math.abs(gap) >= Math.abs(best.gap))) continue;
    best = { position: [position[0] - n[0] * gap, position[1] - n[1] * gap], wall: wall.id, gap };
  }
  return best && { position: best.position, wall: best.wall };
}

const sameWall = (a: Wall, b: Wall) =>
  a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1] && a.thickness === b.thickness;

// Move attached objects along with their walls after a shell edit. The object
// keeps its distance from the wall end that stayed put (or from the start if
// the whole wall moved) and its offset from the wall. Objects whose wall was
// deleted are detached. Returns the same doc if nothing changed.
export function followWalls(doc: SceneDoc, before: Shell, after: Shell): SceneDoc {
  const objects = doc.objects ?? [];
  let changed = false;
  const next = objects.map((o) => {
    if (!o.attachedTo) return o;
    const oldWall = before.walls.find((w) => w.id === o.attachedTo);
    const newWall = after.walls.find((w) => w.id === o.attachedTo);
    if (!oldWall) return o;
    if (!newWall) {
      changed = true;
      const { attachedTo: _, ...rest } = o;
      return rest;
    }
    if (sameWall(oldWall, newWall)) return o;

    const oldLen = wallLength(oldWall);
    const newLen = wallLength(newWall);
    const dir = wallDir(oldWall);
    const normal = wallNormal(oldWall);
    const rel: Vec = [o.position[0] - oldWall.from[0], o.position[1] - oldWall.from[1]];
    const along = rel[0] * dir[0] + rel[1] * dir[1];
    const offset = rel[0] * normal[0] + rel[1] * normal[1];
    const fromMoved = oldWall.from[0] !== newWall.from[0] || oldWall.from[1] !== newWall.from[1];
    const toMoved = oldWall.to[0] !== newWall.to[0] || oldWall.to[1] !== newWall.to[1];
    const s = fromMoved && !toMoved ? newLen - (oldLen - along) : along;
    // Keep the object against the face if the wall's thickness changed.
    const faceShift = (Math.sign(offset) || 1) * (newWall.thickness - oldWall.thickness) / 2;
    const p = pointOnWall(newWall, s, offset + faceShift);
    const rotation = (((o.rotation ?? 0) + wallAngle(newWall) - wallAngle(oldWall)) % 360 + 360) % 360;
    changed = true;
    return { ...o, position: [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as [number, number], rotation: Math.round(rotation * 10) / 10 || undefined };
  });
  return changed ? { ...doc, objects: next } : doc;
}
