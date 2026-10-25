// Roofs: their faces and heights, worked out from a few numbers (see
// RoofSchema), and the shell edits for them.
//
// A roof covers the convex hull of its outline. Each sloping side is an eave
// along one edge of that hull; the roof's height at a point is the pitch
// times its distance to the nearest sloping eave (for a hip roof every edge,
// for a gable the two along the ridge), so every face is the part of the
// roof where one eave is the nearest: a convex polygon, cut out with
// half-planes. A shed roof is one plane, a flat roof none.
import type { Vec } from "./geometry";
import type { Roof, RoofDoc, ShellDoc } from "./schema";

export const ROOF_LOOK: Record<Roof["type"], { label: string; pitch: number; overhang: number; color: string }> = {
  gable: { label: "Gable roof", pitch: 35, overhang: 40, color: "#9a4d38" },
  hip: { label: "Hip roof", pitch: 30, overhang: 40, color: "#9a4d38" },
  shed: { label: "Shed roof", pitch: 15, overhang: 40, color: "#6f6f6c" },
  flat: { label: "Flat roof", pitch: 0, overhang: 10, color: "#8d8b86" },
};

export const roofPitch = (r: Roof) => (r.type === "flat" ? 0 : (r.pitch ?? ROOF_LOOK[r.type].pitch));
export const roofOverhang = (r: Roof) => r.overhang ?? ROOF_LOOK[r.type].overhang;
export const roofThickness = (r: Roof) => r.thickness ?? (r.type === "flat" ? 30 : 20);
export const roofMaterial = (r: Roof) => r.material ?? ROOF_LOOK[r.type].color;

// --- polygons ----------------------------------------------------------------------

const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// Convex hull, counter-clockwise on the screen (plan y is down: clockwise in
// maths terms). Monotone chain.
export function convexHull(points: Vec[]): Vec[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const half = (list: Vec[]) => {
    const out: Vec[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

// Keep the part of a convex polygon where f(p) <= 0, for a linear f.
function clipHalfPlane(poly: Vec[], f: (p: Vec) => number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
    const [fp, fq] = [f(p), f(q)];
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const area = (poly: Vec[]) => poly.reduce((s, p, i) => s + (p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1]), 0) / 2;

// An edge of the footprint as a line, with the unit normal pointing into the
// roof: inward(p) is how far p is inside that edge.
interface Eave {
  a: Vec;
  n: Vec;
  inward: (p: Vec) => number;
}

function eaves(footprint: Vec[]): Eave[] {
  const sign = area(footprint) > 0 ? 1 : -1;
  return footprint.map((a, i) => {
    const b = footprint[(i + 1) % footprint.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: Vec = [(-(b[1] - a[1]) / len) * sign, ((b[0] - a[0]) / len) * sign];
    return { a, n, inward: (p: Vec) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] };
  });
}

// The outline grown by `d` on every side (convex).
function grow(footprint: Vec[], d: number): Vec[] {
  if (d <= 0) return footprint;
  const lines = eaves(footprint).map((e) => ({ p: [e.a[0] - e.n[0] * d, e.a[1] - e.n[1] * d] as Vec, n: e.n }));
  return lines.map((l, i) => {
    const m = lines[(i + lines.length - 1) % lines.length];
    // Intersect line m (previous edge) and line l, each n·x = n·p.
    const [c1, c2] = [m.n[0] * m.p[0] + m.n[1] * m.p[1], l.n[0] * l.p[0] + l.n[1] * l.p[1]];
    const det = m.n[0] * l.n[1] - m.n[1] * l.n[0];
    if (Math.abs(det) < 1e-9) return l.p;
    return [(c1 * l.n[1] - m.n[1] * c2) / det, (m.n[0] * c2 - c1 * l.n[0]) / det] as Vec;
  });
}

// --- the roof ----------------------------------------------------------------------

export function roofFootprint(roof: Roof): Vec[] {
  return convexHull(roof.polygon);
}

// The covered outline, including the overhang.
export function roofOutline(roof: Roof): Vec[] {
  return grow(roofFootprint(roof), roofOverhang(roof));
}

const boundsOf = (poly: Vec[]) => ({
  minX: Math.min(...poly.map((p) => p[0])),
  maxX: Math.max(...poly.map((p) => p[0])),
  minY: Math.min(...poly.map((p) => p[1])),
  maxY: Math.max(...poly.map((p) => p[1])),
});

// The ridge of a gable runs along x or y: by default along the longer side.
export function roofRidge(roof: Roof): "x" | "y" {
  if (roof.ridge) return roof.ridge;
  const b = boundsOf(roofFootprint(roof));
  return b.maxX - b.minX >= b.maxY - b.minY ? "x" : "y";
}

// A face: a convex part of the roof and its height (above the walls' top)
// at any point.
export interface RoofFace {
  poly: Vec[];
  height: (p: Vec) => number;
}

export function roofFaces(roof: Roof): RoofFace[] {
  const footprint = roofFootprint(roof);
  const cover = roofOutline(roof);
  const slope = Math.tan((roofPitch(roof) * Math.PI) / 180);
  if (footprint.length < 3) return [];
  if (roof.type === "flat" || slope === 0) return [{ poly: cover, height: () => 0 }];
  if (roof.type === "shed") {
    // Low along the side it falls to, rising across the footprint.
    const b = boundsOf(footprint);
    const down = roof.downTo ?? "south";
    const along = { south: (p: Vec) => b.maxY - p[1], north: (p: Vec) => p[1] - b.minY, east: (p: Vec) => b.maxX - p[0], west: (p: Vec) => p[0] - b.minX }[down];
    return [{ poly: cover, height: (p) => slope * along(p) }];
  }
  let sloping = eaves(footprint);
  if (roof.type === "gable") {
    // The eaves along the ridge; the other sides are gable ends.
    const ridge = roofRidge(roof);
    sloping = sloping.filter((e) => Math.abs(ridge === "x" ? e.n[1] : e.n[0]) >= 0.7);
    if (sloping.length < 2) return [{ poly: cover, height: () => 0 }];
  }
  return sloping.flatMap((e, i) => {
    let poly = cover;
    sloping.forEach((other, j) => {
      if (j !== i && poly.length) poly = clipHalfPlane(poly, (p) => e.inward(p) - other.inward(p));
    });
    return poly.length >= 3 && Math.abs(area(poly)) > 1 ? [{ poly, height: (p: Vec) => slope * e.inward(p) }] : [];
  });
}

// The faces cut to the footprint: under them, the gable ends (the wall up to
// the roof) along the footprint's edges.
export function roofGables(roof: Roof): { a: Vec; b: Vec; ha: number; hb: number }[] {
  const footprint = roofFootprint(roof);
  const edges = eaves(footprint);
  const onEdge = (p: Vec, q: Vec) => edges.some((e) => Math.abs(e.inward(p)) < 0.5 && Math.abs(e.inward(q)) < 0.5);
  return roofFaces(roof).flatMap((face) => {
    let poly = face.poly;
    for (const e of edges) poly = clipHalfPlane(poly, (p) => -e.inward(p));
    return poly.flatMap((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const [ha, hb] = [face.height(p), face.height(q)];
      return onEdge(p, q) && Math.max(ha, hb) > 0.5 ? [{ a: p, b: q, ha, hb }] : [];
    });
  });
}

// Where a line on the plan (a wall's centreline) runs under the roof's
// faces, within its footprint: stretches [s0, s1] cm from `a`, and the
// underside's height above the walls' top at each end.
export function roofOver(roof: Roof, a: Vec, b: Vec): { s0: number; s1: number; h0: number; h1: number }[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return [];
  const at = (t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const footprint = eaves(roofFootprint(roof));
  return roofFaces(roof).flatMap((face) => {
    // Clip the segment to the face and the footprint (both convex).
    let [t0, t1] = [0, 1];
    for (const e of [...eaves(face.poly), ...footprint]) {
      const [f0, f1] = [e.inward(a), e.inward(b)];
      if (f0 < 0 && f1 < 0) return [];
      if (f0 < 0) t0 = Math.max(t0, f0 / (f0 - f1));
      else if (f1 < 0) t1 = Math.min(t1, f0 / (f0 - f1));
    }
    if (t1 - t0 < 1e-6) return [];
    return [{ s0: t0 * len, s1: t1 * len, h0: face.height(at(t0)), h1: face.height(at(t1)) }];
  });
}

// Whether a wall stands on the edge of the roof's footprint (an outside
// wall, whose gable end the roof already draws).
export function onRoofEdge(roof: Roof, a: Vec, b: Vec, thickness: number): boolean {
  return eaves(roofFootprint(roof)).some((e) => Math.abs(e.inward(a)) <= thickness / 2 + 2 && Math.abs(e.inward(b)) <= thickness / 2 + 2);
}

// The roof's underside above a plan point (above the walls' top), if the
// point is under it.
export function roofHeightAt(roof: Roof, p: Vec): number | null {
  if (!eaves(roofFootprint(roof)).every((e) => e.inward(p) >= -0.5)) return null;
  for (const face of roofFaces(roof)) if (eaves(face.poly).every((e) => e.inward(p) >= -0.5)) return face.height(p);
  return null;
}

// The highest point above the walls' top.
export function roofRise(roof: Roof): number {
  return Math.max(0, ...roofFaces(roof).flatMap((f) => f.poly.map((p) => f.height(p))));
}

// A footprint for a roof over walls: the convex hull of their outer faces.
export function hullOf(points: Vec[]): Vec[] {
  return convexHull(points).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Vec);
}

// --- edits ------------------------------------------------------------------------

const clean = <T extends object>(x: T): T => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as T;

function freeRoofId(doc: ShellDoc): string {
  const taken = new Set([...(doc.walls ?? []), ...(doc.openings ?? []), ...(doc.rooms ?? []), ...(doc.stairs ?? []), ...(doc.roofs ?? [])].map((x) => x.id));
  for (let n = 1; ; n++) if (!taken.has(`roof-${n}`)) return `roof-${n}`;
}

export function addRoof(roof: Omit<RoofDoc, "id"> & { id?: string }) {
  return (doc: ShellDoc): ShellDoc => {
    const id = roof.id && !(doc.roofs ?? []).some((r) => r.id === roof.id) ? roof.id : freeRoofId(doc);
    return { ...doc, roofs: [...(doc.roofs ?? []), clean({ ...roof, id })] };
  };
}

export function updateRoof(id: string, patch: Partial<Omit<RoofDoc, "id" | "level">>) {
  return (doc: ShellDoc): ShellDoc => {
    const roofs = doc.roofs ?? [];
    if (!roofs.some((r) => r.id === id)) return doc;
    return { ...doc, roofs: roofs.map((r) => (r.id === id ? clean({ ...r, ...patch }) : r)) };
  };
}

export function deleteRoof(id: string) {
  return (doc: ShellDoc): ShellDoc => ((doc.roofs ?? []).some((r) => r.id === id) ? { ...doc, roofs: (doc.roofs ?? []).filter((r) => r.id !== id) } : doc);
}
