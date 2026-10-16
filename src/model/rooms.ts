// Finding enclosed areas between walls, so a room can be made by clicking
// inside one. Walls are treated as a planar graph of their centrelines (split
// where walls meet or cross); its faces are the candidate rooms.
import { dist, pointInPolygon, polygonArea, type Vec } from "./geometry";
import type { Shell } from "./schema";

const EPS = 0.5;

function segmentIntersection(a: Vec, b: Vec, c: Vec, d: Vec): number | null {
  // Returns t along a→b where it meets c→d, if they cross or touch.
  const r: Vec = [b[0] - a[0], b[1] - a[1]];
  const s: Vec = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return null;
  const w: Vec = [c[0] - a[0], c[1] - a[1]];
  const t = (w[0] * s[1] - w[1] * s[0]) / denom;
  const u = (w[0] * r[1] - w[1] * r[0]) / denom;
  const len = Math.hypot(r[0], r[1]);
  const slen = Math.hypot(s[0], s[1]);
  if (t * len < -EPS || t * len > len + EPS || u * slen < -EPS || u * slen > slen + EPS) return null;
  return Math.min(1, Math.max(0, t));
}

// All faces (closed loops) of the wall graph, as polygons.
export function wallFaces(shell: Shell): Vec[][] {
  const nodes: Vec[] = [];
  const nodeId = (raw: Vec) => {
    const p: Vec = [Math.round(raw[0] * 10) / 10, Math.round(raw[1] * 10) / 10];
    const i = nodes.findIndex((n) => dist(n, p) < EPS);
    if (i !== -1) return i;
    nodes.push(p);
    return nodes.length - 1;
  };

  // Split every wall at the points where other walls touch or cross it.
  const edges = new Set<string>();
  for (const wall of shell.walls) {
    const ts = new Set<number>([0, 1]);
    for (const other of shell.walls) {
      if (other === wall) continue;
      const t = segmentIntersection(wall.from, wall.to, other.from, other.to);
      if (t !== null) ts.add(Math.round(t * 1e6) / 1e6);
    }
    const sorted = [...ts].sort((a, b) => a - b);
    const ids = sorted.map((t) =>
      nodeId([wall.from[0] + (wall.to[0] - wall.from[0]) * t, wall.from[1] + (wall.to[1] - wall.from[1]) * t]),
    );
    for (let i = 0; i + 1 < ids.length; i++) {
      if (ids[i] !== ids[i + 1]) {
        edges.add(`${ids[i]}>${ids[i + 1]}`);
        edges.add(`${ids[i + 1]}>${ids[i]}`);
      }
    }
  }

  // Outgoing edges at each node, sorted by angle.
  const out = new Map<number, number[]>();
  for (const e of edges) {
    const [a, b] = e.split(">").map(Number);
    out.set(a, [...(out.get(a) ?? []), b]);
  }
  const angle = (a: number, b: number) => Math.atan2(nodes[b][1] - nodes[a][1], nodes[b][0] - nodes[a][0]);
  for (const [a, list] of out) list.sort((x, y) => angle(a, x) - angle(a, y));

  // Walk each directed edge once; at every node turn to the next edge in
  // angular order after the reverse edge. Each walk traces one face.
  const used = new Set<string>();
  const faces: Vec[][] = [];
  for (const e of edges) {
    if (used.has(e)) continue;
    const loop: number[] = [];
    let [a, b] = e.split(">").map(Number);
    for (let guard = 0; guard < edges.size + 1; guard++) {
      const key = `${a}>${b}`;
      if (used.has(key)) break;
      used.add(key);
      loop.push(a);
      const list = out.get(b) ?? [];
      const back = list.indexOf(a);
      const next = list[(back - 1 + list.length) % list.length];
      [a, b] = [b, next];
    }
    if (loop.length >= 3) faces.push(loop.map((i) => nodes[i]));
  }
  return faces;
}

// The smallest enclosed area containing p, or null if p isn't enclosed.
export function enclosedArea(shell: Shell, p: Vec): Vec[] | null {
  let best: Vec[] | null = null;
  let bestArea = Infinity;
  for (const face of wallFaces(shell)) {
    if (!pointInPolygon(p, face)) continue;
    const area = polygonArea(face);
    if (area > 1 && area < bestArea) {
      best = face;
      bestArea = area;
    }
  }
  return best && simplify(best);
}

// Remove points that lie on a straight line between their neighbours.
function simplify(polygon: Vec[]): Vec[] {
  return polygon.filter((p, i) => {
    const a = polygon[(i - 1 + polygon.length) % polygon.length];
    const b = polygon[(i + 1) % polygon.length];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    return Math.abs(cross) / (dist(a, b) || 1) > 0.1;
  });
}
