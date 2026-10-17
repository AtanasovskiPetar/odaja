// Surface finishes: where a finish sits on a wall side (with doors and
// windows cut out), which wall sides face a room, and quantities to buy.
import { pointInPolygon, pointOnWall, polygonArea, roomClearSize, wallEdges, wallJunctions, wallLength, wallNormal, type Vec } from "./geometry";
import type { Finish, Material, Opening, Room, Scene, Shell, Wall } from "./schema";

export interface FaceRect {
  start: number; // cm along the wall from its `from` point
  end: number;
  bottom: number; // cm above the floor
  top: number;
}

// Unit vector from the wall's centreline towards the given side.
export function sideVector(wall: Wall, side: "left" | "right"): Vec {
  const n = wallNormal(wall); // points right on the plan
  return side === "right" ? n : [-n[0], -n[1]];
}

// Point on a wall's face (side) at `s` cm along it.
export function facePoint(wall: Wall, side: "left" | "right", s: number, out = 0): Vec {
  return pointOnWall(wall, s, (side === "right" ? 1 : -1) * (wall.thickness / 2 + out));
}

// Subtract openings from a rectangle on a wall face, as a list of rectangles.
export function cutOpenings(rect: FaceRect, openings: Opening[]): FaceRect[] {
  const holes = openings
    .map((o) => ({ start: o.offset, end: o.offset + o.width, bottom: o.sill, top: o.sill + o.height }))
    .filter((h) => h.end > rect.start && h.start < rect.end && h.top > rect.bottom && h.bottom < rect.top);
  const xs = [...new Set([rect.start, rect.end, ...holes.flatMap((h) => [h.start, h.end])])]
    .filter((x) => x >= rect.start && x <= rect.end)
    .sort((a, b) => a - b);
  const out: FaceRect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const [x0, x1] = [xs[i], xs[i + 1]];
    if (x1 - x0 < 0.01) continue;
    const blocks = holes.filter((h) => h.start < x1 && h.end > x0).sort((a, b) => a.bottom - b.bottom);
    let y = rect.bottom;
    for (const b of blocks) {
      if (b.bottom > y) out.push({ start: x0, end: x1, bottom: y, top: Math.min(b.bottom, rect.top) });
      y = Math.max(y, b.top);
    }
    if (rect.top > y) out.push({ start: x0, end: x1, bottom: y, top: rect.top });
  }
  return out.filter((r) => r.top - r.bottom > 0.01);
}

// The rectangles a wall finish covers.
export function finishRects(finish: Finish, shell: Shell): FaceRect[] {
  const wall = shell.walls.find((w) => w.id === finish.wall);
  if (!wall || !finish.side) return [];
  const span = wallJunctions(wall, shell);
  const height = wall.height ?? shell.wallHeight;
  const rect: FaceRect = {
    start: Math.max(-wall.thickness / 2, finish.from ?? span.start),
    end: Math.min(wallLength(wall) + wall.thickness / 2, finish.to ?? span.end),
    bottom: finish.bottom ?? 0,
    top: Math.min(height, finish.top ?? height),
  };
  if (rect.end - rect.start < 0.5 || rect.top - rect.bottom < 0.5) return [];
  return cutOpenings(
    rect,
    shell.openings.filter((o) => o.wall === wall.id),
  );
}

// Which stretches of each wall side face into a room, found by probing just
// off the wall face every few cm. Used to finish "all walls of the bathroom".
export function roomWallSides(shell: Shell, room: Room): { wall: string; side: "left" | "right"; from: number; to: number }[] {
  const out: { wall: string; side: "left" | "right"; from: number; to: number }[] = [];
  const step = 5;
  for (const wall of shell.walls) {
    const len = wallLength(wall);
    for (const side of ["left", "right"] as const) {
      let runStart: number | null = null;
      for (let s = 0; s <= len + 0.001; s += step) {
        const inside = pointInPolygon(facePoint(wall, side, Math.min(s, len), 3), room.polygon);
        if (inside && runStart === null) runStart = s;
        if (!inside && runStart !== null) {
          out.push({ wall: wall.id, side, from: runStart, to: s - step });
          runStart = null;
        }
      }
      if (runStart !== null) out.push({ wall: wall.id, side, from: runStart, to: len });
    }
  }
  // Snap the probe runs to the real face ends: the wall's corners, or the
  // faces of walls meeting it part-way.
  return out
    .map((r) => {
      const wall = shell.walls.find((w) => w.id === r.wall)!;
      const span = wallJunctions(wall, shell);
      let from = Math.max(span.start, r.from - step);
      let to = Math.min(span.end, r.to + step);
      for (let i = 0; i + 1 < span.junctions.length; i += 2) {
        const [a, b] = [span.junctions[i], span.junctions[i + 1]];
        if (r.from >= a - step && r.from <= b + step) from = b;
        if (r.to >= a - step && r.to <= b + step) to = a;
      }
      return { ...r, from, to };
    })
    .filter((r) => r.to - r.from > 10);
}

// The room a wall side faces at `s` cm along it (default: its middle), for
// labels like "Bathroom side".
export function roomFacing(shell: Shell, wall: Wall, side: "left" | "right", s = wallLength(wall) / 2): Room | undefined {
  const p = facePoint(wall, side, s, 3);
  return shell.rooms.find((r) => pointInPolygon(p, r.polygon));
}

// Floor material of a room in a scene: its floor finish, else the room's own.
export function floorMaterial(scene: Scene | null, room: Room): string {
  return scene?.finishes.find((f) => f.surface === "floor" && f.room === room.id)?.material ?? room.floor ?? "oak";
}

export function roomFloorArea(shell: Shell, room: Room): number {
  const size = roomClearSize(room, wallEdges(shell));
  return size && room.polygon.length === 4 ? size.width * size.depth : polygonArea(room.polygon);
}

export interface QuantityLine {
  finish: string;
  label: string;
  material: string;
  areaM2: number;
  tiles?: number; // including waste
  tileSize?: Vec;
}

const WASTE = 0.1;

// What to buy for each finish: area, and for tiles the number of tiles
// including 10% for cuts and breakage.
export function quantities(scene: Scene, shell: Shell, materials: Record<string, Material>): QuantityLine[] {
  return scene.finishes.map((f) => {
    let area = 0;
    let label = f.id;
    if (f.surface === "floor") {
      const room = shell.rooms.find((r) => r.id === f.room);
      if (room) {
        area = roomFloorArea(shell, room);
        label = `${room.name} floor`;
      }
    } else {
      area = finishRects(f, shell).reduce((sum, r) => sum + (r.end - r.start) * (r.top - r.bottom), 0);
      const wall = shell.walls.find((w) => w.id === f.wall);
      const rects = finishRects(f, shell);
      const mid = rects.length ? (Math.min(...rects.map((r) => r.start)) + Math.max(...rects.map((r) => r.end))) / 2 : undefined;
      const room = wall && f.side ? roomFacing(shell, wall, f.side, mid) : undefined;
      label = `${room ? `${room.name}, ` : ""}${f.wall} (${f.side})`;
    }
    const tile = materials[f.material]?.tile;
    const line: QuantityLine = { finish: f.id, label, material: f.material, areaM2: Math.round(area / 100) / 100 };
    if (tile && !tile.image) {
      line.tiles = Math.ceil((area / (tile.size[0] * tile.size[1])) * (1 + WASTE));
      line.tileSize = tile.size;
    }
    return line;
  });
}
