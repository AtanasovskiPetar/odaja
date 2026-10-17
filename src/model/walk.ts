// Walking through the flat: what you bump into, and where you start.
// Positions are plan cm (x east, y south). Heading is the walking direction
// as a plan vector.
import { exteriorSide, pointInPolygon, pointOnWall, polygonArea, wallNormal, wallPieces, type Vec } from "./geometry";
import type { Scene, Shell } from "./schema";

export const BODY_RADIUS = 22; // cm

type Segment = [Vec, Vec];

const rotate = ([x, y]: Vec, degrees: number): Vec => {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

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
  for (const o of scene?.objects ?? []) {
    for (const part of o.parts) {
      const bottom = o.elevation + part.at[2];
      const top = bottom + (part.shape === "box" ? part.size[2] : part.height);
      if (top < 45 || bottom > 150) continue;
      const [hw, hd] = part.shape === "box" ? [part.size[0] / 2, part.size[1] / 2] : [part.radius, part.radius];
      const poly = ([
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ] as Vec[]).map((c) => {
        const local = rotate(c, part.rotation);
        const p = rotate([local[0] + part.at[0], local[1] + part.at[1]], o.rotation);
        return [p[0] + o.position[0], p[1] + o.position[1]] as Vec;
      });
      segments.push(...outlineEdges(poly));
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
