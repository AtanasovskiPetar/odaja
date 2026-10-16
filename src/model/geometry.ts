// 2D plan geometry (centimetres, x right, y down) used for measuring:
// wall faces, distances to walls, object footprints and room sizes.
import type { Room, SceneObject, Shell, Wall } from "./schema";

export type Vec = [number, number];
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EPS = 0.01;

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dist = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function wallLength(wall: Wall) {
  return dist(wall.from, wall.to);
}

export function wallDir(wall: Wall): Vec {
  const len = wallLength(wall);
  return [(wall.to[0] - wall.from[0]) / len, (wall.to[1] - wall.from[1]) / len];
}

// Unit normal pointing to the left of the wall's direction (on the plan, y down).
export function wallNormal(wall: Wall): Vec {
  const [dx, dy] = wallDir(wall);
  return [-dy, dx];
}

export function pointOnWall(wall: Wall, s: number, side = 0): Vec {
  return add(add(wall.from, scale(wallDir(wall), s)), scale(wallNormal(wall), side));
}

// The wall's solid outline: centreline extended by half the thickness at both
// ends, the same shape the 3D view draws.
export function wallOutline(wall: Wall): Vec[] {
  const half = wall.thickness / 2;
  const len = wallLength(wall);
  return [
    pointOnWall(wall, -half, half),
    pointOnWall(wall, len + half, half),
    pointOnWall(wall, len + half, -half),
    pointOnWall(wall, -half, -half),
  ];
}

export function wallEdges(shell: Shell): [Vec, Vec][] {
  return shell.walls.flatMap((wall) => {
    const p = wallOutline(wall);
    return p.map((a, i) => [a, p[(i + 1) % p.length]] as [Vec, Vec]);
  });
}

// Distance from `origin` along unit vector `dir` to the nearest wall face, or
// null if nothing is hit within `maxDistance`.
export function rayToWalls(origin: Vec, dir: Vec, edges: [Vec, Vec][], maxDistance = 2000): number | null {
  let best: number | null = null;
  for (const [a, b] of edges) {
    const e: Vec = [b[0] - a[0], b[1] - a[1]];
    const denom = dir[0] * e[1] - dir[1] * e[0];
    if (Math.abs(denom) < 1e-9) continue;
    const w: Vec = [a[0] - origin[0], a[1] - origin[1]];
    const t = (w[0] * e[1] - w[1] * e[0]) / denom;
    const u = (w[0] * dir[1] - w[1] * dir[0]) / denom;
    if (t > EPS && u >= -EPS && u <= 1 + EPS && t <= maxDistance && (best === null || t < best)) best = t;
  }
  return best;
}

export function pointInPolygon([x, y]: Vec, polygon: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function boundsOf(points: Vec[]): Rect {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxX: Math.max(...points.map((p) => p[0])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

export function shellBounds(shell: Shell): Rect | null {
  if (shell.walls.length === 0) return null;
  return boundsOf(shell.walls.flatMap(wallOutline));
}

const rotate = ([x, y]: Vec, degrees: number): Vec => {
  // Clockwise on a y-down plan is the usual rotation matrix.
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

// Axis-aligned footprint of an object on the plan, after rotation.
export function objectFootprint(object: SceneObject, position: Vec = object.position): Rect {
  const corners = object.parts.flatMap((part) => {
    const [hw, hd] = part.shape === "box" ? [part.size[0] / 2, part.size[1] / 2] : [part.radius, part.radius];
    const local: Vec[] = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    return local.map((c) => add(rotate(add(rotate(c, part.rotation), [part.at[0], part.at[1]]), object.rotation), position));
  });
  return boundsOf(corners);
}

export function polygonArea(polygon: Vec[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return Math.abs(sum) / 2;
}

// Clear (wall face to wall face) width and depth of a room, measured through
// the centre of its outline.
export function roomClearSize(room: Room, edges: [Vec, Vec][]): { width: number; depth: number } | null {
  const b = boundsOf(room.polygon);
  const c: Vec = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const left = rayToWalls(c, [-1, 0], edges);
  const right = rayToWalls(c, [1, 0], edges);
  const up = rayToWalls(c, [0, -1], edges);
  const down = rayToWalls(c, [0, 1], edges);
  if (left === null || right === null || up === null || down === null) return null;
  return { width: left + right, depth: up + down };
}

function roomsContain(shell: Shell, p: Vec) {
  return shell.rooms.some((r) => pointInPolygon(p, r.polygon));
}

// Which side of a wall is outside the flat: +1 = the wall's normal side,
// -1 = the opposite side, 0 = rooms on both sides (an interior wall).
export function exteriorSide(wall: Wall, shell: Shell): 1 | -1 | 0 {
  const mid = wallLength(wall) / 2;
  const probe = wall.thickness / 2 + 10;
  const plus = roomsContain(shell, pointOnWall(wall, mid, probe));
  const minus = roomsContain(shell, pointOnWall(wall, mid, -probe));
  if (plus && !minus) return -1;
  if (minus && !plus) return 1;
  return 0;
}

// Positions along a wall (cm from its `from` point) where its inside face
// starts and stops: where it meets other walls, and the edges of its openings.
// Consecutive pairs are the measurements a builder would take along the wall.
export function wallChain(wall: Wall, shell: Shell): number[] {
  const len = wallLength(wall);
  const dir = wallDir(wall);
  const normal = wallNormal(wall);
  let start = 0;
  let end = len;
  const points: number[] = [];

  for (const other of shell.walls) {
    if (other === wall) continue;
    for (const p of [other.from, other.to]) {
      const rel: Vec = [p[0] - wall.from[0], p[1] - wall.from[1]];
      const s = rel[0] * dir[0] + rel[1] * dir[1];
      const off = rel[0] * normal[0] + rel[1] * normal[1];
      if (Math.abs(off) > wall.thickness / 2 + EPS || s < -EPS || s > len + EPS) continue;
      const half = other.thickness / 2;
      if (s < EPS) start = Math.max(start, half);
      else if (s > len - EPS) end = Math.min(end, len - half);
      else points.push(s - half, s + half);
    }
    // A wall touching this wall's end from the side (a corner where this wall
    // ends on the other's centreline) also trims this wall's face.
    for (const [s, isStart] of [
      [0, true],
      [len, false],
    ] as const) {
      const p = pointOnWall(wall, s);
      const oLen = wallLength(other);
      const oDir = wallDir(other);
      const rel: Vec = [p[0] - other.from[0], p[1] - other.from[1]];
      const along = rel[0] * oDir[0] + rel[1] * oDir[1];
      const across = Math.abs(rel[0] * wallNormal(other)[0] + rel[1] * wallNormal(other)[1]);
      if (across > EPS || along < -EPS || along > oLen + EPS) continue;
      if (isStart) start = Math.max(start, other.thickness / 2);
      else end = Math.min(end, len - other.thickness / 2);
    }
  }

  for (const o of shell.openings) {
    if (o.wall === wall.id) points.push(o.offset, o.offset + o.width);
  }
  const all = [start, ...points.filter((s) => s > start + EPS && s < end - EPS), end].sort((a, b) => a - b);
  return all.filter((s, i) => i === 0 || s - all[i - 1] > EPS);
}

export function rectEdges(r: Rect): [Vec, Vec][] {
  const p: Vec[] = [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY],
  ];
  return p.map((a, i) => [a, p[(i + 1) % 4]] as [Vec, Vec]);
}

// Distances from each side of a footprint to the nearest edge (wall face or
// other object) in each direction.
export function clearances(rect: Rect, edges: [Vec, Vec][]) {
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  return {
    left: rayToWalls([rect.minX, cy], [-1, 0], edges),
    right: rayToWalls([rect.maxX, cy], [1, 0], edges),
    up: rayToWalls([cx, rect.minY], [0, -1], edges),
    down: rayToWalls([cx, rect.maxY], [0, 1], edges),
  };
}

export function formatCm(cm: number): string {
  const r = Math.round(cm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
