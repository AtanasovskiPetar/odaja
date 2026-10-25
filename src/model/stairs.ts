// Stairs: their treads, footprint and walking line on the plan, worked out
// from a few numbers (see StairSchema), and the shell edits for them.
//
// Shapes are built in the stair's own frame (origin at the footprint's
// centre, going up towards -y), then turned and moved onto the plan.
import { pointInPolygon, type Vec } from "./geometry";
import type { ShellDoc, Stair, StairDoc } from "./schema";

export const RISER = 18; // cm, a comfortable step up
const GOING = 26; // cm, a comfortable tread depth
const POLE = 7; // spiral stairs: radius of the central pole
const SPIRAL_STEP = 22.5; // degrees per tread

export interface Tread {
  poly: Vec[]; // plan cm
  top: number; // height of its walking surface above the stair's floor
}

// Thickness of the tread plates of open stairs.
export const TREAD = 5;

// Open underneath: tread plates on stringers rather than solid steps.
export const isOpen = (stair: Stair) => stair.type === "spiral" || stair.open === true;

// How far down a tread reaches: to the floor, or its plate's thickness.
export const treadBottom = (stair: Stair, t: Tread) => (isOpen(stair) ? t.top - TREAD : 0);

// One straight run of steps, along its middle from `a` (bottom) to `b` (top),
// climbing from z0 to z1: what stringers of open stairs follow.
export interface Flight {
  a: Vec;
  b: Vec;
  width: number;
  z0: number;
  z1: number;
}

// Turning stairs need a step on each flight and the landing.
export const stepCount = (stair: Stair, rise: number) => Math.max(stair.type === "l" || stair.type === "u" ? 3 : 2, stair.steps ?? Math.round(rise / RISER));

// --- shapes in the stair's frame ------------------------------------------------

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// The flight width of an l- or u-shaped stair.
export function flightWidth(stair: Stair): number {
  const [w, d] = stair.size;
  if (stair.type === "u") return Math.min(stair.width ?? (w - 10) / 2, w / 2);
  if (stair.type === "l") return Math.min(stair.width ?? Math.min(100, w / 2, d / 2), w - 10, d - 10);
  return w;
}

// Flight lengths of l- and u-shaped stairs, and how many treads each gets
// (the landing between them is one tread).
function flights(stair: Stair, n: number): { l1: number; l2: number; n1: number; n2: number } {
  const [w, d] = stair.size;
  const fw = flightWidth(stair);
  const l1 = Math.max(1, d - fw);
  const l2 = Math.max(1, stair.type === "l" ? w - fw : d - fw);
  const n1 = Math.min(n - 2, Math.max(1, Math.round(((n - 1) * l1) / (l1 + l2))));
  return { l1, l2, n1, n2: n - 1 - n1 };
}

// Turning right is the left-turning shape mirrored.
const mirror = (stair: Stair) => (poly: Vec[]): Vec[] => (stair.turn === "right" && stair.type !== "spiral" ? poly.map(([x, y]) => [-x, y] as Vec).reverse() : poly);

function localTreads(stair: Stair, rise: number): Tread[] {
  const n = stepCount(stair, rise);
  const r = rise / n;
  const [w, d] = stair.size;
  const out: Tread[] = [];
  if (stair.type === "spiral") {
    const radius = w / 2;
    const step = Math.min(SPIRAL_STEP, 360 / n);
    const dir = stair.turn === "right" ? -1 : 1;
    const at = (deg: number, rr: number): Vec => {
      const a = (deg * Math.PI) / 180;
      return [Math.sin(a) * rr, Math.cos(a) * rr];
    };
    for (let i = 0; i < n; i++) {
      const a0 = dir * i * step;
      const a1 = dir * (i + 1) * step;
      const arc = [0, 1, 2, 3].map((k) => at(a0 + ((a1 - a0) * k) / 3, radius));
      out.push({ poly: [at(a0, POLE), ...arc, at(a1, POLE)], top: (i + 1) * r });
    }
    return out;
  }
  if (stair.type === "straight") {
    const g = d / n;
    for (let i = 0; i < n; i++) out.push({ poly: rect(-w / 2, d / 2 - (i + 1) * g, w / 2, d / 2 - i * g), top: (i + 1) * r });
    return out;
  }
  const fw = flightWidth(stair);
  const { l1, l2, n1, n2 } = flights(stair, n);
  const flip = mirror(stair);
  // Left turn: up the right-hand side, then across the far end.
  const g1 = l1 / n1;
  for (let i = 0; i < n1; i++) out.push({ poly: flip(rect(w / 2 - fw, d / 2 - (i + 1) * g1, w / 2, d / 2 - i * g1)), top: (i + 1) * r });
  const g2 = l2 / n2;
  if (stair.type === "l") {
    out.push({ poly: flip(rect(w / 2 - fw, -d / 2, w / 2, -d / 2 + fw)), top: (n1 + 1) * r });
    for (let j = 0; j < n2; j++) out.push({ poly: flip(rect(w / 2 - fw - (j + 1) * g2, -d / 2, w / 2 - fw - j * g2, -d / 2 + fw)), top: (n1 + 2 + j) * r });
  } else {
    // u: a landing across the whole width, then back down the other side.
    out.push({ poly: flip(rect(-w / 2, -d / 2, w / 2, -d / 2 + fw)), top: (n1 + 1) * r });
    for (let j = 0; j < n2; j++) out.push({ poly: flip(rect(-w / 2, -d / 2 + fw + j * g2, -w / 2 + fw, -d / 2 + fw + (j + 1) * g2)), top: (n1 + 2 + j) * r });
  }
  return out;
}

function localOutline(stair: Stair): Vec[] {
  const [w, d] = stair.size;
  if (stair.type === "spiral") {
    return Array.from({ length: 24 }, (_, k) => {
      const a = (k / 24) * Math.PI * 2;
      return [Math.sin(a) * (w / 2), Math.cos(a) * (w / 2)] as Vec;
    });
  }
  if (stair.type === "l") {
    const fw = flightWidth(stair);
    return mirror(stair)([
      [w / 2 - fw, d / 2],
      [w / 2, d / 2],
      [w / 2, -d / 2],
      [-w / 2, -d / 2],
      [-w / 2, -d / 2 + fw],
      [w / 2 - fw, -d / 2 + fw],
    ]);
  }
  return rect(-w / 2, -d / 2, w / 2, d / 2);
}

// The walking line, bottom to top, for the arrow on the plan.
function localPath(stair: Stair, rise: number): Vec[] {
  const [w, d] = stair.size;
  if (stair.type === "spiral") {
    const n = stepCount(stair, rise);
    const step = Math.min(SPIRAL_STEP, 360 / n);
    const dir = stair.turn === "right" ? -1 : 1;
    const rr = (w / 2 + POLE) / 2;
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = (dir * Math.max(0.5, Math.min(n - 0.5, i)) * step * Math.PI) / 180;
      return [Math.sin(a) * rr, Math.cos(a) * rr] as Vec;
    });
  }
  if (stair.type === "straight") return [[0, d / 2 - 10], [0, -d / 2 + 10]];
  const fw = flightWidth(stair);
  const c = w / 2 - fw / 2;
  const top = -d / 2 + fw / 2;
  const path: Vec[] = stair.type === "l" ? [[c, d / 2 - 10], [c, top], [-w / 2 + 10, top]] : [[c, d / 2 - 10], [c, top], [-c, top], [-c, d / 2 - 10]];
  return stair.turn === "right" ? path.map(([x, y]) => [-x, y] as Vec) : path;
}

function localFlights(stair: Stair, rise: number): Flight[] {
  const [w, d] = stair.size;
  if (stair.type === "spiral") return [];
  if (stair.type === "straight") return [{ a: [0, d / 2], b: [0, -d / 2], width: w, z0: 0, z1: rise }];
  const n = stepCount(stair, rise);
  const r = rise / n;
  const fw = flightWidth(stair);
  const { n1 } = flights(stair, n);
  const c = w / 2 - fw / 2;
  const first: Flight = { a: [c, d / 2], b: [c, -d / 2 + fw], width: fw, z0: 0, z1: n1 * r };
  const second: Flight =
    stair.type === "l"
      ? { a: [w / 2 - fw, -d / 2 + fw / 2], b: [-w / 2, -d / 2 + fw / 2], width: fw, z0: (n1 + 1) * r, z1: rise }
      : { a: [-c, -d / 2 + fw], b: [-c, d / 2], width: fw, z0: (n1 + 1) * r, z1: rise };
  const flip = (p: Vec): Vec => (stair.turn === "right" ? [-p[0], p[1]] : p);
  return [first, second].map((f) => ({ ...f, a: flip(f.a), b: flip(f.b) }));
}

// --- on the plan ----------------------------------------------------------------

function toPlan(stair: Stair) {
  const a = (stair.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  return ([x, y]: Vec): Vec => [stair.position[0] + x * cos - y * sin, stair.position[1] + x * sin + y * cos];
}

export function stairTreads(stair: Stair, rise: number): Tread[] {
  const place = toPlan(stair);
  return localTreads(stair, rise).map((t) => ({ ...t, poly: t.poly.map(place) }));
}

export function stairFlights(stair: Stair, rise: number): Flight[] {
  const place = toPlan(stair);
  return localFlights(stair, rise).map((f) => ({ ...f, a: place(f.a), b: place(f.b) }));
}

// The footprint: also the opening it needs in the floor above.
export function stairOutline(stair: Stair): Vec[] {
  return localOutline(stair).map(toPlan(stair));
}

export function stairPath(stair: Stair, rise: number): Vec[] {
  return localPath(stair, rise).map(toPlan(stair));
}

// Where the opening in the floor above needs a guard: its edges, except
// near where the stair arrives (the end of the walking line).
export function stairGuards(stair: Stair, rise: number): [Vec, Vec][] {
  const outline = stairOutline(stair);
  const exit = stairPath(stair, rise).at(-1)!;
  const keepClear = stair.type === "spiral" ? (stair.size[0] / 2 - POLE) / 2 + 10 : flightWidth(stair) / 2 + 2;
  const out: [Vec, Vec][] = [];
  for (let i = 0; i < outline.length; i++) {
    const [a, b] = [outline[i], outline[(i + 1) % outline.length]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) continue;
    // The stretch of this edge within keepClear of the exit: t in [t0, t1].
    const t = ((exit[0] - a[0]) * dx + (exit[1] - a[1]) * dy) / len2;
    const near = Math.hypot(a[0] + dx * t - exit[0], a[1] + dy * t - exit[1]);
    const at = (s: number): Vec => [a[0] + dx * s, a[1] + dy * s];
    if (near >= keepClear) {
      out.push([a, b]);
      continue;
    }
    const half = Math.sqrt(keepClear * keepClear - near * near) / Math.sqrt(len2);
    const [t0, t1] = [t - half, t + half];
    if (t0 > 0.02) out.push([a, at(Math.min(1, t0))]);
    if (t1 < 0.98) out.push([at(Math.max(0, t1)), b]);
  }
  return out;
}

// Riser height and tread depth (the shortest flight's), for checks and labels.
export function stepSizes(stair: Stair, rise: number): { count: number; riser: number; going: number } {
  const n = stepCount(stair, rise);
  const [w, d] = stair.size;
  if (stair.type === "straight") return { count: n, riser: rise / n, going: d / n };
  if (stair.type === "spiral") {
    const step = Math.min(SPIRAL_STEP, 360 / n);
    // Measured on the walking line, two thirds of the way out.
    return { count: n, riser: rise / n, going: (((w / 2) * 2) / 3) * ((step * Math.PI) / 180) };
  }
  const { l1, l2, n1, n2 } = flights(stair, n);
  return { count: n, riser: rise / n, going: Math.min(l1 / n1, l2 / Math.max(1, n2)) };
}

// A comfortable footprint for a stair of a type climbing `rise`: 100 cm
// flights of ~26 cm treads (a spiral: 160 across).
export function defaultStairSize(type: Stair["type"], rise: number): Vec {
  const n = Math.max(3, Math.round(rise / RISER));
  const to10 = (cm: number) => Math.round(cm / 10) * 10;
  const half = ((n - 1) * GOING) / 2;
  if (type === "l") return [to10(100 + half), to10(100 + half)];
  if (type === "u") return [210, to10(100 + half)];
  if (type === "spiral") return [160, 160];
  return [100, to10(n * GOING)];
}

// Height of the stair's walking surface at a plan point (above its own
// floor), or null off the treads.
export function treadHeightAt(treads: Tread[], p: Vec): number | null {
  let best: number | null = null;
  for (const t of treads) if (pointInPolygon(p, t.poly) && (best === null || t.top > best)) best = t.top;
  return best;
}

// --- clipping (floor openings) -------------------------------------------------------

const cross = (a: Vec, b: Vec, p: Vec) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

function signedArea(poly: Vec[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function isConvex(poly: Vec[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

// The part of `subject` inside the convex polygon `clip` (Sutherland–Hodgman).
export function clipConvex(subject: Vec[], clip: Vec[]): Vec[] {
  const orient = Math.sign(signedArea(clip)) || 1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [a, b] = [clip[i], clip[(i + 1) % clip.length]];
    const inside = (p: Vec) => cross(a, b, p) * orient >= 0;
    const hit = (p: Vec, q: Vec): Vec => {
      const t = cross(a, b, p) / (cross(a, b, p) - cross(a, b, q));
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const [p, q] = [input[k], input[(k + 1) % input.length]];
      if (inside(q)) {
        if (!inside(p)) out.push(hit(p, q));
        out.push(q);
      } else if (inside(p)) out.push(hit(p, q));
    }
  }
  return Math.abs(signedArea(out)) > 1 ? out : [];
}

// The openings to cut in a room's floor: each stair opening clipped to the
// room. A room that isn't convex only gets openings that lie wholly inside it.
export function floorOpenings(room: Vec[], openings: Vec[][]): Vec[][] {
  const convex = isConvex(room);
  return openings.flatMap((o) => {
    if (convex) {
      const part = clipConvex(o, room);
      return part.length ? [part] : [];
    }
    return o.every((p) => pointInPolygon(p, room)) ? [o] : [];
  });
}

// --- edits ------------------------------------------------------------------------

function freeStairId(doc: ShellDoc): string {
  const taken = new Set([...(doc.walls ?? []), ...(doc.openings ?? []), ...(doc.rooms ?? []), ...(doc.stairs ?? [])].map((x) => x.id));
  for (let n = 1; ; n++) if (!taken.has(`stairs-${n}`)) return `stairs-${n}`;
}

export function addStair(stair: Omit<StairDoc, "id"> & { id?: string }) {
  return (doc: ShellDoc): ShellDoc => {
    const id = stair.id && !(doc.stairs ?? []).some((s) => s.id === stair.id) ? stair.id : freeStairId(doc);
    const clean = Object.fromEntries(Object.entries({ ...stair, id }).filter(([, v]) => v !== undefined)) as StairDoc;
    return { ...doc, stairs: [...(doc.stairs ?? []), clean] };
  };
}

export function updateStair(id: string, patch: Partial<Omit<StairDoc, "id" | "level">>) {
  return (doc: ShellDoc): ShellDoc => {
    const stairs = doc.stairs ?? [];
    if (!stairs.some((s) => s.id === id)) return doc;
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      ...doc,
      stairs: stairs.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch } as Record<string, unknown>;
        if (patch.position) next.position = patch.position.map(round);
        if (patch.rotation !== undefined) next.rotation = ((patch.rotation % 360) + 360) % 360 || undefined;
        return Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as StairDoc;
      }),
    };
  };
}

export function deleteStair(id: string) {
  return (doc: ShellDoc): ShellDoc => {
    const stairs = doc.stairs ?? [];
    return stairs.some((s) => s.id === id) ? { ...doc, stairs: stairs.filter((s) => s.id !== id) } : doc;
  };
}
