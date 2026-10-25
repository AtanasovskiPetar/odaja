// The site: the plot, outdoor areas (lawn, paving, a pool…) and fences.
// Sizes and colours left out of the file come from the kind or style here.
import { boundsOf, pointInPolygon, shellBounds, type Rect, type Vec } from "./geometry";
import type { Area, AreaDoc, Fence, FenceDoc, Shell, ShellDoc } from "./schema";

// Colours used when an area, fence or plot names no material ("#rrggbb"
// works anywhere a material name does).
export const AREA_LOOK: Record<Area["kind"], { label: string; color: string }> = {
  lawn: { label: "Lawn", color: "#7fa65a" },
  paving: { label: "Paving", color: "#bdb5a8" },
  gravel: { label: "Gravel", color: "#d2c9b6" },
  deck: { label: "Deck", color: "#9c7653" },
  bed: { label: "Planting bed", color: "#6a5240" },
  water: { label: "Water", color: "#5fa8cc" },
};
export const PLOT_COLOR = "#b4c294";

export const FENCE_LOOK: Record<Fence["style"], { label: string; height: number; thickness: number; color: string }> = {
  slats: { label: "Slatted fence", height: 180, thickness: 4, color: "#8b6b4e" },
  panel: { label: "Board fence", height: 180, thickness: 4, color: "#7d6048" },
  rail: { label: "Post and rail", height: 110, thickness: 8, color: "#8b6b4e" },
  hedge: { label: "Hedge", height: 150, thickness: 60, color: "#4a7a3a" },
  wall: { label: "Garden wall", height: 180, thickness: 20, color: "#d8d2c6" },
};

export const areaMaterial = (a: Area) => a.material ?? AREA_LOOK[a.kind].color;
export const fenceHeight = (f: Fence) => f.height ?? FENCE_LOOK[f.style].height;
export const fenceThickness = (f: Fence) => f.thickness ?? FENCE_LOOK[f.style].thickness;
export const fenceMaterial = (f: Fence) => f.material ?? FENCE_LOOK[f.style].color;

export const fenceLength = (f: Fence) => Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);

// The stretches of a fence between its gates: [start, end] cm from `from`.
export function fenceSpans(f: Fence): [number, number][] {
  const len = fenceLength(f);
  const gates = [...f.gates].sort((a, b) => a.offset - b.offset);
  const spans: [number, number][] = [];
  let at = 0;
  for (const g of gates) {
    if (g.offset > at + 0.5) spans.push([at, Math.min(g.offset, len)]);
    at = Math.max(at, g.offset + g.width);
  }
  if (at < len - 0.5) spans.push([at, len]);
  return spans;
}

const along = (f: Fence, s: number, side = 0): Vec => {
  const len = fenceLength(f) || 1;
  const [dx, dy] = [(f.to[0] - f.from[0]) / len, (f.to[1] - f.from[1]) / len];
  return [f.from[0] + dx * s - dy * side, f.from[1] + dy * s + dx * side];
};

// Plan outlines of a fence's solid stretches (for walking, hits and checks).
export function fenceOutlines(f: Fence): Vec[][] {
  const half = fenceThickness(f) / 2;
  return fenceSpans(f).map(([a, b]) => [along(f, a, -half), along(f, b, -half), along(f, b, half), along(f, a, half)]);
}

// A point on a fence, `s` cm from its start.
export const pointOnFence = along;

// Everything on the plan, house and garden: for framing the view and
// fitting sun shadows.
export function siteBounds(shell: Shell): Rect | null {
  const points: Vec[] = [
    ...(shell.plot?.polygon ?? []),
    ...shell.areas.flatMap((a) => a.polygon),
    ...shell.fences.flatMap((f) => [f.from, f.to]),
  ];
  const house = shellBounds(shell);
  if (house) points.push([house.minX, house.minY], [house.maxX, house.maxY]);
  return points.length ? boundsOf(points) : null;
}

// Whether a plan point is outdoors on the site: in an area or the plot.
export function onSite(shell: Shell, p: Vec): boolean {
  return shell.areas.some((a) => pointInPolygon(p, a.polygon)) || (shell.plot ? pointInPolygon(p, shell.plot.polygon) : false);
}

// --- edits ------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;
const clean = <T extends object>(x: T): T => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as T;

// A free id from a name ("terrace", "terrace-2"), or numbered from 1
// ("fence-1", "fence-2").
function freeId(doc: ShellDoc, stem: string, numbered = false): string {
  const taken = new Set([...(doc.walls ?? []), ...(doc.openings ?? []), ...(doc.rooms ?? []), ...(doc.stairs ?? []), ...(doc.areas ?? []), ...(doc.fences ?? [])].map((x) => x.id));
  const base = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";
  if (!numbered && !taken.has(base)) return base;
  for (let n = numbered ? 1 : 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function setPlot(polygon: Vec[] | null, material?: string | null) {
  return (doc: ShellDoc): ShellDoc => {
    if (polygon === null) {
      const { plot: _, ...rest } = doc;
      return rest;
    }
    const m = material === undefined ? doc.plot?.material : material ?? undefined;
    return { ...doc, plot: clean({ polygon: polygon.map(([x, y]) => [r1(x), r1(y)] as Vec), material: m }) };
  };
}

export function updatePlot(patch: { material?: string | null }) {
  return (doc: ShellDoc): ShellDoc => (doc.plot ? { ...doc, plot: clean({ ...doc.plot, material: patch.material === null ? undefined : (patch.material ?? doc.plot.material) }) } : doc);
}

export function addArea(area: Omit<AreaDoc, "id"> & { id?: string }) {
  return (doc: ShellDoc): ShellDoc => {
    const kind = area.kind ?? "lawn";
    const id = area.id && !(doc.areas ?? []).some((a) => a.id === area.id) ? area.id : freeId(doc, area.name || AREA_LOOK[kind].label);
    const polygon = area.polygon.map(([x, y]) => [r1(x), r1(y)] as Vec);
    return { ...doc, areas: [...(doc.areas ?? []), clean({ ...area, id, polygon })] };
  };
}

export function updateArea(id: string, patch: Partial<Omit<AreaDoc, "id">>) {
  return (doc: ShellDoc): ShellDoc => {
    const areas = doc.areas ?? [];
    if (!areas.some((a) => a.id === id)) return doc;
    return { ...doc, areas: areas.map((a) => (a.id === id ? clean({ ...a, ...patch }) : a)) };
  };
}

export function moveArea(id: string, [dx, dy]: Vec) {
  return (doc: ShellDoc): ShellDoc => {
    const area = (doc.areas ?? []).find((a) => a.id === id);
    if (!area || (dx === 0 && dy === 0)) return doc;
    return updateArea(id, { polygon: area.polygon.map(([x, y]) => [r1(x + dx), r1(y + dy)] as Vec) })(doc);
  };
}

export function deleteArea(id: string) {
  return (doc: ShellDoc): ShellDoc => ((doc.areas ?? []).some((a) => a.id === id) ? { ...doc, areas: (doc.areas ?? []).filter((a) => a.id !== id) } : doc);
}

// Fences along a line through `points`, one per stretch.
export function addFences(points: Vec[], fields: Omit<FenceDoc, "id" | "from" | "to"> = {}) {
  return (doc: ShellDoc): ShellDoc => {
    let next = doc;
    for (let i = 0; i + 1 < points.length; i++) {
      const [from, to] = [points[i], points[i + 1]];
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 10) continue;
      const fence = clean({ ...fields, id: freeId(next, "fence", true), from: [r1(from[0]), r1(from[1])] as Vec, to: [r1(to[0]), r1(to[1])] as Vec });
      next = { ...next, fences: [...(next.fences ?? []), fence] };
    }
    return next;
  };
}

export function updateFence(id: string, patch: Partial<Omit<FenceDoc, "id">>) {
  return (doc: ShellDoc): ShellDoc => {
    const fences = doc.fences ?? [];
    if (!fences.some((f) => f.id === id)) return doc;
    return { ...doc, fences: fences.map((f) => (f.id === id ? clean({ ...f, ...patch }) : f)) };
  };
}

export function moveFence(id: string, [dx, dy]: Vec) {
  return (doc: ShellDoc): ShellDoc => {
    const f = (doc.fences ?? []).find((x) => x.id === id);
    if (!f || (dx === 0 && dy === 0)) return doc;
    return updateFence(id, { from: [r1(f.from[0] + dx), r1(f.from[1] + dy)], to: [r1(f.to[0] + dx), r1(f.to[1] + dy)] })(doc);
  };
}

export function deleteFence(id: string) {
  return (doc: ShellDoc): ShellDoc => ((doc.fences ?? []).some((f) => f.id === id) ? { ...doc, fences: (doc.fences ?? []).filter((f) => f.id !== id) } : doc);
}

// A gate in the middle of a fence (or where asked), kept inside it.
export function addGate(id: string, width = 100, offset?: number) {
  return (doc: ShellDoc): ShellDoc => {
    const f = (doc.fences ?? []).find((x) => x.id === id);
    if (!f) return doc;
    const len = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
    const w = Math.min(width, len);
    const at = Math.max(0, Math.min(len - w, offset ?? (len - w) / 2));
    return updateFence(id, { gates: [...(f.gates ?? []), { offset: r1(at), width: r1(w) }] })(doc);
  };
}
