// Named edits to a shell (walls, openings, rooms). Like scene operations they
// take the file as written and return a new one, so they plug into the
// store's applyShell and its undo. The editing tools only produce valid
// geometry: openings are kept on their wall and clear of each other, and
// walls have a minimum length.
import { dist, fitOpening, wallLength, type Vec } from "./geometry";
import { ShellSchema, type Opening, type ShellDoc } from "./schema";

type WallDoc = NonNullable<ShellDoc["walls"]>[number];
type OpeningDoc = NonNullable<ShellDoc["openings"]>[number];
type RoomDoc = NonNullable<ShellDoc["rooms"]>[number];

export const MIN_WALL = 10; // cm
const SAME_POINT = 0.5; // cm

const r1 = (n: number) => Math.round(n * 10) / 10;
const rp = (p: Vec): Vec => [r1(p[0]), r1(p[1])];
const same = (a: Vec, b: Vec) => dist(a, b) < SAME_POINT;

export function uniqueShellId(doc: ShellDoc, prefix: string): string {
  const taken = new Set([...(doc.walls ?? []), ...(doc.openings ?? []), ...(doc.rooms ?? [])].map((x) => x.id));
  for (let n = 1; ; n++) if (!taken.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

// Drop keys set to undefined so cleared fields disappear from the file.
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// --- walls ---------------------------------------------------------------

export function addWalls(points: Vec[], thickness: number) {
  return (doc: ShellDoc): ShellDoc => {
    const walls = [...(doc.walls ?? [])];
    let next = { ...doc, walls };
    for (let i = 0; i + 1 < points.length; i++) {
      if (dist(points[i], points[i + 1]) < MIN_WALL) continue;
      walls.push({ id: uniqueShellId(next, "wall"), from: rp(points[i]), to: rp(points[i + 1]), thickness });
      next = { ...next, walls };
    }
    return walls.length === (doc.walls ?? []).length ? doc : next;
  };
}

// Four walls on the rectangle's centrelines plus a room filling it.
export function addRectRoom(a: Vec, b: Vec, thickness: number, name?: string) {
  return (doc: ShellDoc): ShellDoc => {
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    if (x1 - x0 < MIN_WALL || y1 - y0 < MIN_WALL) return doc;
    const corners: Vec[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    let next = addWalls([...corners, corners[0]], thickness)(doc);
    next = addRoom(corners, name)(next);
    return next;
  };
}

// Move every wall end (and room corner) at `point` to `to`, so connected
// walls stay connected.
export function moveCorner(point: Vec, to: Vec) {
  return (doc: ShellDoc): ShellDoc => {
    const target = rp(to);
    const walls = (doc.walls ?? []).map((w) => ({
      ...w,
      from: same(w.from, point) ? target : w.from,
      to: same(w.to, point) ? target : w.to,
    }));
    if (walls.some((w) => dist(w.from, w.to) < MIN_WALL)) return doc;
    const rooms = (doc.rooms ?? []).map((r) => ({ ...r, polygon: r.polygon.map((p) => (same(p, point) ? target : p)) }));
    return keepOpeningsOnWalls({ ...doc, walls, rooms });
  };
}

// Slide a whole wall by `delta`. Walls joined at its ends stretch to follow,
// and walls meeting it part-way move their touching end with it.
export function moveWall(id: string, delta: Vec) {
  return (doc: ShellDoc): ShellDoc => {
    const shell = ShellSchema.parse(doc);
    const wall = shell.walls.find((w) => w.id === id);
    if (!wall || (delta[0] === 0 && delta[1] === 0)) return doc;
    const len = wallLength(wall);
    const dir: Vec = [(wall.to[0] - wall.from[0]) / len, (wall.to[1] - wall.from[1]) / len];
    const onWall = (p: Vec) => {
      const rel: Vec = [p[0] - wall.from[0], p[1] - wall.from[1]];
      const along = rel[0] * dir[0] + rel[1] * dir[1];
      const across = Math.abs(rel[0] * -dir[1] + rel[1] * dir[0]);
      return across < SAME_POINT && along > -SAME_POINT && along < len + SAME_POINT;
    };
    const shift = (p: Vec): Vec => rp([p[0] + delta[0], p[1] + delta[1]]);
    const walls = (doc.walls ?? []).map((w) =>
      w.id === id ? { ...w, from: shift(w.from), to: shift(w.to) } : { ...w, from: onWall(w.from) ? shift(w.from) : w.from, to: onWall(w.to) ? shift(w.to) : w.to },
    );
    if (walls.some((w) => dist(w.from, w.to) < MIN_WALL)) return doc;
    const rooms = (doc.rooms ?? []).map((r) => ({ ...r, polygon: r.polygon.map((p) => (onWall(p) ? shift(p) : p)) }));
    return keepOpeningsOnWalls({ ...doc, walls, rooms });
  };
}

// Change a wall's length by moving its `to` end (and whatever is joined there).
export function setWallLength(id: string, length: number) {
  return (doc: ShellDoc): ShellDoc => {
    const wall = (doc.walls ?? []).find((w) => w.id === id);
    if (!wall || length < MIN_WALL) return doc;
    const len = dist(wall.from, wall.to);
    const to: Vec = [wall.from[0] + ((wall.to[0] - wall.from[0]) / len) * length, wall.from[1] + ((wall.to[1] - wall.from[1]) / len) * length];
    return moveCorner(wall.to, to)(doc);
  };
}

export function updateWall(id: string, patch: Partial<Pick<WallDoc, "thickness" | "height" | "material">>) {
  return (doc: ShellDoc): ShellDoc => ({
    ...doc,
    walls: (doc.walls ?? []).map((w) => (w.id === id ? clean({ ...w, ...patch }) : w)),
  });
}

export function deleteWall(id: string) {
  return (doc: ShellDoc): ShellDoc => ({
    ...doc,
    walls: (doc.walls ?? []).filter((w) => w.id !== id),
    openings: (doc.openings ?? []).filter((o) => o.wall !== id),
  });
}

// After walls change length, pull openings back inside their wall's corners
// (or drop ones that no longer fit on it at all).
export function keepOpeningsOnWalls(doc: ShellDoc): ShellDoc {
  const shell = ShellSchema.parse(doc);
  const bare = { ...shell, openings: [] };
  let changed = false;
  const openings: OpeningDoc[] = [];
  for (const o of doc.openings ?? []) {
    const wall = shell.walls.find((w) => w.id === o.wall);
    const fit = wall ? fitOpening(wall, bare, o.offset, o.width) : null;
    if (fit === null) {
      changed = true;
    } else if (Math.abs(fit - o.offset) > 0.05) {
      changed = true;
      openings.push({ ...o, offset: r1(fit) });
    } else {
      openings.push(o);
    }
  }
  return changed ? { ...doc, openings } : doc;
}

// --- openings ------------------------------------------------------------

export const OPENING_DEFAULTS: Record<Opening["type"], { width: number; height: number; sill: number }> = {
  door: { width: 80, height: 210, sill: 0 },
  window: { width: 120, height: 140, sill: 90 },
  opening: { width: 90, height: 210, sill: 0 },
};

export function addOpening(wall: string, type: Opening["type"], offset: number, size?: Partial<{ width: number; height: number; sill: number }>) {
  return (doc: ShellDoc): ShellDoc => {
    const shell = ShellSchema.parse(doc);
    const w = shell.walls.find((x) => x.id === wall);
    const s = { ...OPENING_DEFAULTS[type], ...size };
    if (!w) return doc;
    const fit = fitOpening(w, shell, offset, s.width);
    if (fit === null) return doc;
    const opening: OpeningDoc = clean({
      id: uniqueShellId(doc, type),
      wall,
      type,
      offset: r1(fit),
      width: s.width,
      height: s.height,
      sill: s.sill || undefined,
    });
    return { ...doc, openings: [...(doc.openings ?? []), opening] };
  };
}

export function updateOpening(id: string, patch: Partial<Omit<OpeningDoc, "id" | "wall">>) {
  return (doc: ShellDoc): ShellDoc => {
    const shell = ShellSchema.parse(doc);
    const current = shell.openings.find((o) => o.id === id);
    const wall = current && shell.walls.find((w) => w.id === current.wall);
    if (!current || !wall) return doc;
    const merged = { ...current, ...patch };
    if (merged.sill + merged.height > (wall.height ?? shell.wallHeight)) return doc;
    const fit = fitOpening(wall, shell, merged.offset, merged.width, id);
    if (fit === null) return doc;
    return {
      ...doc,
      openings: (doc.openings ?? []).map((o) => (o.id === id ? clean({ ...o, ...patch, offset: r1(fit) }) : o)),
    };
  };
}

export function deleteOpening(id: string) {
  return (doc: ShellDoc): ShellDoc => ({ ...doc, openings: (doc.openings ?? []).filter((o) => o.id !== id) });
}

// --- rooms ---------------------------------------------------------------

export function addRoom(polygon: Vec[], name?: string, floor = "oak") {
  return (doc: ShellDoc): ShellDoc => {
    const id = uniqueShellId(doc, "room");
    const room: RoomDoc = { id, name: name ?? `Room ${id.split("-")[1]}`, polygon: polygon.map(rp), floor };
    return { ...doc, rooms: [...(doc.rooms ?? []), room] };
  };
}

export function updateRoom(id: string, patch: Partial<Pick<RoomDoc, "name" | "floor">>) {
  return (doc: ShellDoc): ShellDoc => ({
    ...doc,
    rooms: (doc.rooms ?? []).map((r) => (r.id === id ? clean({ ...r, ...patch }) : r)),
  });
}

export function deleteRoom(id: string) {
  return (doc: ShellDoc): ShellDoc => ({ ...doc, rooms: (doc.rooms ?? []).filter((r) => r.id !== id) });
}
