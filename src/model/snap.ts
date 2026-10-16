// Snapping for the wall tools: to wall ends, onto walls, to 45° angles from
// the previous point, into line with other wall ends, and to a 5 cm grid.
import { dist, projectOnWall, type Vec } from "./geometry";
import type { Shell } from "./schema";

export type SnapKind = "end" | "wall" | "angle" | "align" | "grid";

export interface Snap {
  point: Vec;
  kind: SnapKind;
  // Dashed helper lines to draw (plan cm).
  guides: [Vec, Vec][];
}

const GRID = 5;
const round = (n: number, step = GRID) => Math.round(n / step) * step;

function endpoints(shell: Shell): Vec[] {
  return shell.walls.flatMap((w) => [w.from, w.to]);
}

// `radius` is the snap distance in cm (a few pixels at the current zoom).
// `from` is the previous point while drawing a wall.
export function snapPoint(p: Vec, shell: Shell, radius: number, from?: Vec): Snap {
  const ends = endpoints(shell);

  // 1. Wall ends.
  let nearest: Vec | null = null;
  for (const e of ends) if (dist(e, p) < radius && (!nearest || dist(e, p) < dist(nearest, p))) nearest = e;
  if (nearest) return { point: nearest, kind: "end", guides: [] };

  // 2. Along a 45° direction from the previous point (possibly ending on a wall).
  if (from && dist(from, p) > radius) {
    const angle = Math.atan2(p[1] - from[1], p[0] - from[0]);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dir: Vec = [Math.cos(snapped), Math.sin(snapped)];
    const len = (p[0] - from[0]) * dir[0] + (p[1] - from[1]) * dir[1];
    const onRay: Vec = [from[0] + dir[0] * len, from[1] + dir[1] * len];
    if (dist(onRay, p) < radius && len > 0) {
      for (const wall of shell.walls) {
        const hit = rayHitsWall(from, dir, wall.from, wall.to);
        if (hit !== null && Math.abs(hit - len) < radius) {
          return { point: [from[0] + dir[0] * hit, from[1] + dir[1] * hit], kind: "wall", guides: [] };
        }
      }
      const l = round(len, 1);
      return { point: [from[0] + dir[0] * l, from[1] + dir[1] * l], kind: "angle", guides: [[from, onRay]] };
    }
  }

  // 3. Onto a wall's centreline.
  for (const wall of shell.walls) {
    const proj = projectOnWall(wall, p);
    if (proj.across < radius) return { point: [round(proj.point[0], 1), round(proj.point[1], 1)], kind: "wall", guides: [] };
  }

  // 4. In line with another wall end, horizontally or vertically.
  let x = round(p[0]);
  let y = round(p[1]);
  const guides: [Vec, Vec][] = [];
  const alignX = ends.find((e) => Math.abs(e[0] - p[0]) < radius);
  const alignY = ends.find((e) => Math.abs(e[1] - p[1]) < radius);
  if (alignX) x = alignX[0];
  if (alignY) y = alignY[1];
  if (alignX) guides.push([alignX, [x, y]]);
  if (alignY) guides.push([alignY, [x, y]]);
  return { point: [x, y], kind: guides.length ? "align" : "grid", guides };
}

// Distance along the ray (origin + t·dir) to segment a–b, if it crosses it.
function rayHitsWall(origin: Vec, dir: Vec, a: Vec, b: Vec): number | null {
  const e: Vec = [b[0] - a[0], b[1] - a[1]];
  const denom = dir[0] * e[1] - dir[1] * e[0];
  if (Math.abs(denom) < 1e-9) return null;
  const w: Vec = [a[0] - origin[0], a[1] - origin[1]];
  const t = (w[0] * e[1] - w[1] * e[0]) / denom;
  const u = (w[0] * dir[1] - w[1] * dir[0]) / denom;
  return t > 0.5 && u >= 0 && u <= 1 ? t : null;
}
