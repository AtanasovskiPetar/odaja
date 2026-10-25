// Cutting one polygon with another, for any simple polygons, convex or not
// (Greiner–Hormann). Used to open floors over stairs and the ground and
// areas over pools, and to measure overlaps.
//
// Touching edges and vertices lying exactly on the other polygon's edges are
// the method's weak spot, and on a plan they're common (a stair against a
// wall, an area along a room). The cutting polygon is nudged by a hair to
// keep clear of them; nothing that small shows.
import { pointInPolygon, type Vec } from "./geometry";

export interface Piece {
  outer: Vec[];
  holes: Vec[][];
}

interface Node {
  p: Vec;
  next: Node;
  prev: Node;
  // Crossing points only: the same point in the other polygon's list, how
  // far along its edge it lies, whether walking forward here goes into the
  // other polygon, and whether a result already used it.
  crossing: boolean;
  neighbour?: Node;
  alpha: number;
  entering: boolean;
  visited: boolean;
}

function ring(points: Vec[]): Node {
  const nodes = points.map((p) => ({ p, crossing: false, alpha: 0, entering: false, visited: false }) as unknown as Node);
  nodes.forEach((n, i) => {
    n.next = nodes[(i + 1) % nodes.length];
    n.prev = nodes[(i + nodes.length - 1) % nodes.length];
  });
  return nodes[0];
}

const each = (start: Node, fn: (n: Node) => void) => {
  let n = start;
  do {
    fn(n);
    n = n.next;
  } while (n !== start);
};

function insertBetween(node: Node, from: Node, to: Node) {
  // Keep crossings on one edge ordered by alpha.
  let at = from;
  while (at.next !== to && at.next.alpha < node.alpha) at = at.next;
  node.next = at.next;
  node.prev = at;
  at.next.prev = node;
  at.next = node;
}

function segmentCrossing(a: Vec, b: Vec, c: Vec, d: Vec): [number, number] | null {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? [t, u] : null;
}

// Nudge a polygon off lines and points it might share with another.
const nudge = (poly: Vec[]): Vec[] => poly.map(([x, y], i) => [x + 0.0137 + (i % 3) * 0.0011, y + 0.0091 + (i % 2) * 0.0013]);

function crossings(subject: Vec[], clip: Vec[]): { s: Node; c: Node; count: number } {
  const s = ring(subject);
  const c = ring(clip);
  let count = 0;
  // The original edges (crossings get inserted into them as we go).
  const sVerts: Node[] = [];
  each(s, (n) => sVerts.push(n));
  const cVerts: Node[] = [];
  each(c, (n) => cVerts.push(n));
  for (let i = 0; i < sVerts.length; i++) {
    const [a, a2] = [sVerts[i], sVerts[(i + 1) % sVerts.length]];
    for (let j = 0; j < cVerts.length; j++) {
      const [b, b2] = [cVerts[j], cVerts[(j + 1) % cVerts.length]];
      const hit = segmentCrossing(a.p, a2.p, b.p, b2.p);
      if (!hit) continue;
      const p: Vec = [a.p[0] + (a2.p[0] - a.p[0]) * hit[0], a.p[1] + (a2.p[1] - a.p[1]) * hit[0]];
      const ns = { p, crossing: true, alpha: hit[0], entering: false, visited: false } as unknown as Node;
      const nc = { p, crossing: true, alpha: hit[1], entering: false, visited: false } as unknown as Node;
      ns.neighbour = nc;
      nc.neighbour = ns;
      insertBetween(ns, a, a2);
      insertBetween(nc, b, b2);
      count++;
    }
  }
  return { s, c, count };
}

// Mark, for each crossing of `start`'s list, whether walking forward enters `other`.
function markEntries(start: Node, other: Vec[]) {
  let inside = pointInPolygon(start.p, other);
  each(start, (n) => {
    if (!n.crossing) return;
    n.entering = !inside;
    inside = !inside;
  });
}

const signedArea = (poly: Vec[]) => poly.reduce((s, p, i) => s + (p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1]), 0) / 2;

// Walk the crossing lists into result rings. keepSubjectOutside: subject
// minus clip (else subject and clip's overlap).
function trace(s: Node, keepSubjectOutside: boolean): Vec[][] {
  const out: Vec[][] = [];
  const crossingsOnS: Node[] = [];
  each(s, (n) => n.crossing && crossingsOnS.push(n));
  for (const startNode of crossingsOnS) {
    if (startNode.visited) continue;
    const poly: Vec[] = [];
    let cur = startNode;
    let onSubject = true;
    let guard = 0;
    do {
      cur.visited = true;
      if (cur.neighbour) cur.neighbour.visited = true;
      // On the subject: forward where it runs outside the clip (difference)
      // or inside it (overlap). On the clip: the way that runs inside the
      // subject.
      const forward = onSubject ? cur.entering !== keepSubjectOutside : cur.entering;
      do {
        poly.push(cur.p);
        cur = forward ? cur.next : cur.prev;
      } while (!cur.crossing && guard++ < 100000);
      cur = cur.neighbour!;
      onSubject = !onSubject;
    } while (!cur.visited && guard++ < 100000);
    if (poly.length >= 3 && Math.abs(signedArea(poly)) > 0.5) out.push(poly);
  }
  return out;
}

// What's left of `subject` once `cut` is taken out.
export function subtract(subject: Vec[], cut: Vec[]): Piece[] {
  const clip = nudge(cut);
  const { s, count } = crossings(subject, clip);
  if (count === 0) {
    if (subject.every((p) => pointInPolygon(p, clip))) return [];
    if (clip.every((p) => pointInPolygon(p, subject))) return [{ outer: subject, holes: [cut] }];
    return [{ outer: subject, holes: [] }];
  }
  markBoth(s, clip, subject);
  return trace(s, true).map((outer) => ({ outer, holes: [] }));
}

// Entry flags on both lists: the subject's relative to the clip, the clip's
// relative to the subject (marked from one of its original vertices).
function markBoth(s: Node, clip: Vec[], subject: Vec[]) {
  markEntries(s, clip);
  let first: Node | null = null;
  each(s, (n) => {
    if (n.crossing && !first) first = n.neighbour!;
  });
  if (!first) return;
  let v: Node = first;
  while (v.crossing) v = v.next;
  markEntries(v, subject);
}

// The part of `subject` inside `clip`.
export function intersect(subject: Vec[], clip: Vec[]): Vec[][] {
  const nudged = nudge(clip);
  const { s, count } = crossings(subject, nudged);
  if (count === 0) {
    if (subject.every((p) => pointInPolygon(p, nudged))) return [subject];
    if (nudged.every((p) => pointInPolygon(p, subject))) return [clip];
    return [];
  }
  markBoth(s, nudged, subject);
  return trace(s, false);
}

export const overlapArea = (a: Vec[], b: Vec[]) => intersect(a, b).reduce((sum, p) => sum + Math.abs(signedArea(p)), 0);

// A surface with openings cut out: one or more pieces, each with the
// openings that lie wholly inside it as holes.
export function cutOut(outline: Vec[], openings: Vec[][]): Piece[] {
  let pieces: Piece[] = [{ outer: outline, holes: [] }];
  for (const opening of openings) {
    pieces = pieces.flatMap((piece) => {
      const cut = subtract(piece.outer, opening);
      // Holes the piece already had go to whichever new piece holds them.
      return cut.map((c) => ({ outer: c.outer, holes: [...c.holes, ...piece.holes.filter((h) => pointInPolygon(h[0], c.outer))] }));
    });
  }
  return pieces;
}
