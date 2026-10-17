// Design checks for a scene in its shell: things that are physically wrong
// (furniture inside a wall, openings off their wall) and things that make a
// home awkward to use (blocked doors, too little space in front of fixtures).
// Issues never block saving; the app lists them with a highlight and, where
// there's an obvious one, a quick fix.
import { localBounds } from "./attach";
import {
  doorSwings,
  fitOpening,
  pointInPolygon,
  pointOnWall,
  rayToWalls,
  wallEdges,
  wallLength,
  wallNormal,
  wallPieces,
  type Vec,
} from "./geometry";
import { deleteObjectField, moveObjectBy } from "./issueFixes";
import { partFootprint } from "./parts";
import type { Part, Scene, SceneDoc, SceneObject, Shell, ShellDoc } from "./schema";
import { deleteOpening, deleteWall, MIN_WALL, updateOpening } from "./shellOps";

export type IssueTarget = { kind: "object" | "wall" | "opening"; id: string };

export interface Issue {
  key: string;
  severity: "error" | "warning";
  message: string;
  targets: IssueTarget[];
  fix?: { label: string; scene?: (doc: SceneDoc) => SceneDoc; shell?: (doc: ShellDoc) => ShellDoc };
}

// Space recommended in front of fixtures (their -y side), in cm, by template
// id. Objects built from parts are matched by words in their name. Bathtubs
// aren't checked: they're used from a long side, not their front.
const FRONT_CLEARANCE: [RegExp, number, string][] = [
  [/toilet|wc/i, 60, "toilet"],
  [/vanity|basin|sink unit/i, 70, "basin"],
  [/shower/i, 70, "shower"],
  [/base-cabinet|base cabinet|kitchen/i, 90, "kitchen units"],
  [/tall-cabinet|tall cabinet/i, 90, "tall cabinet"],
  [/fridge/i, 90, "fridge"],
  [/wardrobe/i, 70, "wardrobe"],
  [/washing/i, 70, "washing machine"],
];

const r1 = (n: number) => Math.round(n * 10) / 10;

const rotate = ([x, y]: Vec, degrees: number): Vec => {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

// A part's footprint on the plan (4 corners) and its height range.
interface Solid {
  poly: Vec[];
  bottom: number;
  top: number;
}

function partSolids(o: SceneObject): Solid[] {
  return o.parts.map((part: Part) => {
    const f = partFootprint(part, o.position, o.rotation);
    return { poly: f.poly, bottom: o.elevation + f.bottom, top: o.elevation + f.top };
  });
}

function project(poly: Vec[], axis: Vec): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p[0] * axis[0] + p[1] * axis[1];
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return [min, max];
}

// Separating-axis test for two convex polygons: how deep they overlap (0 if
// they don't).
function overlapDepth(a: Vec[], b: Vec[]): number {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      const axis: Vec = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const [a0, a1] = project(a, axis);
      const [b0, b1] = project(b, axis);
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      depth = Math.min(depth, o);
    }
  }
  return depth;
}

const heightsOverlap = (a: { bottom: number; top: number }, b: { bottom: number; top: number }, margin = 0.5) =>
  Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > margin;

function wallSolids(shell: Shell) {
  return shell.walls.flatMap((wall) => {
    const { solid } = wallPieces(
      wall,
      shell.openings.filter((o) => o.wall === wall.id),
      shell.wallHeight,
    );
    const half = wall.thickness / 2;
    return solid.map((piece) => ({
      wall,
      bottom: piece.bottom,
      top: piece.top,
      poly: [pointOnWall(wall, piece.start, -half), pointOnWall(wall, piece.end, -half), pointOnWall(wall, piece.end, half), pointOnWall(wall, piece.start, half)],
    }));
  });
}

export function computeIssues(scene: Scene, shell: Shell): Issue[] {
  const issues: Issue[] = [];
  const solids = new Map(scene.objects.map((o) => [o.id, partSolids(o)]));
  const walls = wallSolids(shell);

  // --- shell -------------------------------------------------------------
  for (const wall of shell.walls) {
    if (wallLength(wall) < MIN_WALL) {
      issues.push({
        key: `short-${wall.id}`,
        severity: "error",
        message: `${wall.id} is only ${r1(wallLength(wall))} cm long.`,
        targets: [{ kind: "wall", id: wall.id }],
        fix: { label: "Delete wall", shell: deleteWall(wall.id) },
      });
    }
  }
  for (const o of shell.openings) {
    const wall = shell.walls.find((w) => w.id === o.wall);
    if (!wall) {
      issues.push({
        key: `orphan-${o.id}`,
        severity: "error",
        message: `${o.id} is in a wall that doesn't exist (${o.wall}).`,
        targets: [{ kind: "opening", id: o.id }],
        fix: { label: "Delete", shell: deleteOpening(o.id) },
      });
      continue;
    }
    const fit = fitOpening(wall, shell, o.offset, o.width, o.id);
    if (fit === null || Math.abs(fit - o.offset) > 0.5) {
      issues.push({
        key: `misplaced-${o.id}`,
        severity: "error",
        message: `${o.id} runs into a corner, another wall or another opening.`,
        targets: [{ kind: "opening", id: o.id }],
        fix: fit === null ? { label: "Delete", shell: deleteOpening(o.id) } : { label: "Move into place", shell: updateOpening(o.id, { offset: fit }) },
      });
    }
  }

  // --- furniture in walls ------------------------------------------------
  for (const obj of scene.objects) {
    let worst: { wall: (typeof walls)[number]["wall"]; push: Vec; depth: number } | null = null;
    for (const piece of walls) {
      for (const s of solids.get(obj.id)!) {
        if (!heightsOverlap(s, piece)) continue;
        const depth = overlapDepth(s.poly, piece.poly);
        if (depth <= 1) continue;
        // Push the object out along the wall's normal, to the side its centre is on.
        const n = wallNormal(piece.wall);
        const side = Math.sign((obj.position[0] - piece.wall.from[0]) * n[0] + (obj.position[1] - piece.wall.from[1]) * n[1]) || 1;
        const axis: Vec = [n[0] * side, n[1] * side];
        const [, wallMax] = project(piece.poly, axis);
        const [objMin] = project(s.poly, axis);
        const amount = wallMax - objMin + 0.5;
        if (!worst || amount > Math.hypot(worst.push[0], worst.push[1])) worst = { wall: piece.wall, push: [axis[0] * amount, axis[1] * amount], depth };
      }
    }
    if (worst) {
      issues.push({
        key: `in-wall-${obj.id}`,
        severity: "error",
        message: `${obj.name} goes ${r1(Math.hypot(worst.push[0], worst.push[1]))} cm into ${worst.wall.id}.`,
        targets: [{ kind: "object", id: obj.id }, { kind: "wall", id: worst.wall.id }],
        fix: obj.locked ? undefined : { label: "Push out of wall", scene: moveObjectBy(obj.id, worst.push) },
      });
    }
  }

  // --- furniture overlapping furniture -----------------------------------
  for (let i = 0; i < scene.objects.length; i++) {
    for (let j = i + 1; j < scene.objects.length; j++) {
      const a = scene.objects[i];
      const b = scene.objects[j];
      const hit = solids.get(a.id)!.some((sa) => solids.get(b.id)!.some((sb) => heightsOverlap(sa, sb) && overlapDepth(sa.poly, sb.poly) > 2));
      if (hit) {
        issues.push({
          key: `overlap-${a.id}-${b.id}`,
          severity: "warning",
          message: `${a.name} and ${b.name} overlap.`,
          targets: [
            { kind: "object", id: a.id },
            { kind: "object", id: b.id },
          ],
        });
      }
    }
  }

  // --- doors that can't open ---------------------------------------------
  for (const door of shell.openings) {
    if (door.type !== "door") continue;
    const wall = shell.walls.find((w) => w.id === door.wall);
    if (!wall) continue;
    const sectors = doorSwings(wall, door).map((sw) => sw.sector);
    const blockers = scene.objects.filter((o) =>
      solids.get(o.id)!.some((s) => s.bottom < door.height && sectors.some((sector) => overlapDepth(s.poly, sector) > 1)),
    );
    if (blockers.length > 0) {
      issues.push({
        key: `door-${door.id}`,
        severity: "warning",
        message: `${door.id} can't open fully: ${blockers.map((b) => b.name).join(", ")} ${blockers.length > 1 ? "are" : "is"} in the way.`,
        targets: [{ kind: "opening", id: door.id }, ...blockers.map((b) => ({ kind: "object" as const, id: b.id }))],
      });
    }
  }

  // --- space in front of fixtures ----------------------------------------
  const wallEdgeList = wallEdges(shell);
  for (const obj of scene.objects) {
    const rule = FRONT_CLEARANCE.find(([re]) => re.test(obj.template ?? "") || re.test(obj.name));
    if (!rule || obj.elevation > 60) continue;
    const [, needed, what] = rule;
    const b = localBounds(obj.parts);
    const front = rotate([0, -1], obj.rotation);
    // Obstacles: walls, and low parts of other objects.
    const edges = [
      ...wallEdgeList,
      ...scene.objects
        .filter((o) => o.id !== obj.id)
        .flatMap((o) => solids.get(o.id)!.filter((s) => s.bottom < 100))
        .flatMap((s) => s.poly.map((p, i) => [p, s.poly[(i + 1) % 4]] as [Vec, Vec])),
    ];
    const inset = Math.min(5, (b.maxX - b.minX) / 4);
    let free = Infinity;
    for (const x of [b.minX + inset, (b.minX + b.maxX) / 2, b.maxX - inset]) {
      const local = rotate([x, b.minY], obj.rotation);
      const origin: Vec = [local[0] + obj.position[0], local[1] + obj.position[1]];
      const d = rayToWalls(origin, front, edges, needed + 50);
      if (d !== null) free = Math.min(free, d);
    }
    if (free < needed - 0.5) {
      issues.push({
        key: `space-${obj.id}`,
        severity: "warning",
        message: `Only ${r1(free)} cm in front of ${obj.name} (${needed} cm recommended for a ${what}).`,
        targets: [{ kind: "object", id: obj.id }],
      });
    }
  }

  // --- furniture outside rooms, broken attachments -------------------------
  for (const obj of scene.objects) {
    if (shell.rooms.length > 0 && !shell.rooms.some((r) => pointInPolygon(obj.position, r.polygon))) {
      issues.push({
        key: `outside-${obj.id}`,
        severity: "warning",
        message: `${obj.name} is outside every room.`,
        targets: [{ kind: "object", id: obj.id }],
      });
    }
    if (obj.attachedTo && !shell.walls.some((w) => w.id === obj.attachedTo)) {
      issues.push({
        key: `attach-${obj.id}`,
        severity: "warning",
        message: `${obj.name} is attached to ${obj.attachedTo}, which doesn't exist.`,
        targets: [{ kind: "object", id: obj.id }],
        fix: { label: "Detach", scene: deleteObjectField(obj.id, "attachedTo") },
      });
    }
  }

  return issues;
}

// Plan outlines of an object, for highlighting it.
export function objectOutlines(o: SceneObject): Vec[][] {
  return partSolids(o).map((s) => s.poly);
}

// Issues are needed by several components; compute them once per scene/shell.
let cache: { scene: Scene; shell: Shell; issues: Issue[] } | null = null;
export function issuesFor(scene: Scene | null, shell: Shell | null): Issue[] {
  if (!scene || !shell) return [];
  if (cache?.scene !== scene || cache.shell !== shell) cache = { scene, shell, issues: computeIssues(scene, shell) };
  return cache.issues;
}
