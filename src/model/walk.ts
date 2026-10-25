// Walking through the flat: what you bump into, and where you start.
// Positions are plan cm (x east, y south). Heading is the walking direction
// as a plan vector.
import { exteriorSide, pointInPolygon, pointOnWall, polygonArea, wallNormal, wallPieces, type Vec } from "./geometry";
import { levelAbove, levelById, levelShell, stairsArriving } from "./levels";
import { partFootprint } from "./parts";
import type { Scene, Shell } from "./schema";
import { isOpen, stairOutline, stairTreads, TREAD, treadHeightAt, type Tread } from "./stairs";
import { fenceHeight, fenceOutlines } from "./site";

export const BODY_RADIUS = 22; // cm
// The biggest step up or down you take without noticing (a riser is ~18).
export const MAX_STEP = 30;
// Room you need over your feet to walk under something (open stairs).
const HEADROOM = 200;

type Segment = [Vec, Vec];


const outlineEdges = (poly: Vec[]): Segment[] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as Segment);

// Edges you can't walk through: solid wall pieces at body height (door
// openings are gaps; a window's sill still blocks), and furniture tall enough
// to bump into. Low things (rugs, coffee tables) can be stepped over.
export function obstacles(shell: Shell, scene: Scene | null): Segment[] {
  const segments: Segment[] = [];
  for (const wall of shell.walls) {
    const { solid } = wallPieces(
      wall,
      shell.openings.filter((o) => o.wall === wall.id),
      shell.wallHeight,
    );
    const half = wall.thickness / 2;
    for (const piece of solid) {
      if (piece.bottom > 150 || piece.top < 20) continue;
      segments.push(
        ...outlineEdges([
          pointOnWall(wall, piece.start, -half),
          pointOnWall(wall, piece.end, -half),
          pointOnWall(wall, piece.end, half),
          pointOnWall(wall, piece.start, half),
        ]),
      );
    }
  }
  // Fences you can't step over; gates are gaps.
  for (const f of shell.fences) {
    if (fenceHeight(f) < 45) continue;
    for (const outline of fenceOutlines(f)) segments.push(...outlineEdges(outline));
  }
  for (const o of scene?.objects ?? []) {
    for (const part of o.parts) {
      const f = partFootprint(part, o.position, o.rotation);
      if (o.elevation + f.top < 45 || o.elevation + f.bottom > 150) continue;
      segments.push(...outlineEdges(f.poly));
    }
  }
  return segments;
}

function closestOnSegment(p: Vec, [a, b]: Segment): Vec {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2)) : 0;
  return [a[0] + abx * t, a[1] + aby * t];
}

// Move from `from` by `delta`, sliding along anything in the way.
export function walkStep(from: Vec, delta: Vec, segments: Segment[], radius = BODY_RADIUS): Vec {
  const length = Math.hypot(delta[0], delta[1]);
  // Small sub-steps so fast movement can't jump through thin walls.
  const steps = Math.max(1, Math.ceil(length / (radius / 2)));
  let p: Vec = [...from];
  for (let s = 0; s < steps; s++) {
    p = [p[0] + delta[0] / steps, p[1] + delta[1] / steps];
    for (let iteration = 0; iteration < 3; iteration++) {
      let moved = false;
      for (const seg of segments) {
        const c = closestOnSegment(p, seg);
        const dx = p[0] - c[0];
        const dy = p[1] - c[1];
        const d = Math.hypot(dx, dy);
        if (d >= radius) continue;
        if (d < 1e-6) {
          // Exactly on an edge: back off the way we came.
          p = [p[0] - delta[0] / steps, p[1] - delta[1] / steps];
        } else {
          p = [c[0] + (dx / d) * radius, c[1] + (dy / d) * radius];
        }
        moved = true;
      }
      if (!moved) break;
    }
  }
  return p;
}

// --- stairs ---------------------------------------------------------------------

// The stairs you can walk on a level: going up from it, and coming up from
// the level below through an opening in its floor. `to` is the level at the
// other end.
export interface LevelStairs {
  up: { treads: Tread[]; rise: number; to?: string; open: boolean }[];
  down: { treads: Tread[]; outline: Vec[]; rise: number; to: string }[];
  // Raised decks and terraces (their height), and water (well below).
  raised: { poly: Vec[]; height: number }[];
}

const WATER_DEPTH = 120;

export function levelStairs(whole: Shell, levelId: string): LevelStairs {
  const here = levelById(whole, levelId);
  const above = levelAbove(whole, here.id);
  const view = levelShell(whole, here.id);
  return {
    raised: view.areas.flatMap((a) => (a.kind === "water" ? [{ poly: a.polygon, height: -WATER_DEPTH }] : a.height ? [{ poly: a.polygon, height: a.height }] : [])),
    up: levelShell(whole, here.id).stairs.map((s) => {
      const rise = s.rise!;
      const arrives = above && Math.abs(rise - (above.elevation - here.elevation)) < 5;
      return { treads: stairTreads(s, rise), rise, to: arrives ? above.id : undefined, open: isOpen(s) };
    }),
    down: stairsArriving(whole, here.id).map((a) => ({ treads: stairTreads(a.stair, a.rise), outline: stairOutline(a.stair), rise: a.rise, to: a.from.id })),
  };
}

// The floor under you, in cm above (or below) the level's floor: a tread of
// a stair going up; over an opening, the stair below it (or the floor below,
// off the treads). Past halfway up or down, `switchTo` is the level you're
// now on, and `shift` what that adds to heights. `current` is the height
// you're at: open stairs high enough above it are walked under.
export function floorAt(stairs: LevelStairs, p: Vec, current = 0): { height: number; switchTo?: string; shift?: number } {
  for (const s of stairs.up) {
    const h = treadHeightAt(s.treads, p);
    if (h === null || (s.open && h - TREAD - current >= HEADROOM)) continue;
    return { height: h, ...(s.to && h > s.rise / 2 ? { switchTo: s.to, shift: -s.rise } : {}) };
  }
  for (const s of stairs.down) {
    if (!pointInPolygon(p, s.outline)) continue;
    const h = (treadHeightAt(s.treads, p) ?? 0) - s.rise;
    return { height: h, ...(h < -s.rise / 2 ? { switchTo: s.to, shift: s.rise } : {}) };
  }
  const raised = stairs.raised.filter((r) => pointInPolygon(p, r.poly)).map((r) => r.height);
  return { height: raised.length ? Math.max(...raised) : 0 };
}

// A move that doesn't climb or drop more than a step: the move, else the
// part of it along x or y that doesn't, else staying put. Stairs are climbed
// from their ends, not their sides, and openings in a floor are edges.
export function climbStep(from: Vec, to: Vec, stairs: LevelStairs, current = 0): Vec {
  if (!stairs.up.length && !stairs.down.length && !stairs.raised.length) return to;
  const h = floorAt(stairs, from, current).height;
  const ok = (p: Vec) => Math.abs(floorAt(stairs, p, h).height - h) <= MAX_STEP;
  if (ok(to)) return to;
  const alongX: Vec = [to[0], from[1]];
  if (ok(alongX)) return alongX;
  const alongY: Vec = [from[0], to[1]];
  return ok(alongY) ? alongY : from;
}

// Where to stand when walking starts: just inside the entrance door if
// there is one, otherwise the middle of the biggest room.
export function defaultStart(shell: Shell): { position: Vec; heading: Vec } | null {
  for (const door of shell.openings) {
    if (door.type !== "door") continue;
    const wall = shell.walls.find((w) => w.id === door.wall);
    if (!wall) continue;
    const side = exteriorSide(wall, shell);
    if (side === 0) continue;
    const inward: Vec = [-wallNormal(wall)[0] * side, -wallNormal(wall)[1] * side];
    const position = pointOnWall(wall, door.offset + door.width / 2, -side * (wall.thickness / 2 + 70));
    return { position, heading: inward };
  }
  const room = [...shell.rooms].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
  if (!room) return null;
  const c = room.polygon.reduce<Vec>((acc, p) => [acc[0] + p[0] / room.polygon.length, acc[1] + p[1] / room.polygon.length], [0, 0]);
  return { position: pointInPolygon(c, room.polygon) ? c : room.polygon[0], heading: [0, -1] };
}

// Facing the middle of the room you're in (for a start picked on the plan).
export function headingIntoRoom(shell: Shell, p: Vec): Vec {
  const room = shell.rooms.find((r) => pointInPolygon(p, r.polygon));
  if (!room) return [0, -1];
  const c = room.polygon.reduce<Vec>((acc, q) => [acc[0] + q[0] / room.polygon.length, acc[1] + q[1] / room.polygon.length], [0, 0]);
  const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
  return d < 30 ? [0, -1] : [(c[0] - p[0]) / d, (c[1] - p[1]) / d];
}
