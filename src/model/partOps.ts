// Editing the parts of an object (the shape editor and the chat). Works on
// the scene file as written; parts are addressed by their index.
import { partBox } from "./parts";
import { PartSchema, type Part, type PartInput, type SceneDoc } from "./schema";

type Vec3 = [number, number, number];
const r1 = (n: number) => Math.round(n * 10) / 10;

function withParts(doc: SceneDoc, objectId: string, change: (parts: PartInput[]) => PartInput[]): SceneDoc {
  return {
    ...doc,
    objects: (doc.objects ?? []).map((o) => (o.id === objectId && o.parts ? { ...o, parts: change(o.parts) } : o)),
  };
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function addPart(objectId: string, part: PartInput) {
  return (doc: SceneDoc) => withParts(doc, objectId, (parts) => [...parts, clean(part)]);
}

export function updatePart(objectId: string, index: number, patch: Partial<Record<string, unknown>>) {
  return (doc: SceneDoc) =>
    withParts(doc, objectId, (parts) => parts.map((p, i) => (i === index ? (clean({ ...p, ...patch }) as PartInput) : p)));
}

export function replacePart(objectId: string, index: number, part: PartInput) {
  return (doc: SceneDoc) => withParts(doc, objectId, (parts) => parts.map((p, i) => (i === index ? clean(part) : p)));
}

export function removeParts(objectId: string, indices: number[]) {
  const set = new Set(indices);
  return (doc: SceneDoc) => withParts(doc, objectId, (parts) => (parts.length - set.size < 1 ? parts : parts.filter((_, i) => !set.has(i))));
}

const atOf = (p: PartInput): Vec3 => (p.at ?? [0, 0, 0]) as Vec3;

export function duplicateParts(objectId: string, indices: number[], offset: Vec3 = [5, 5, 0]) {
  return (doc: SceneDoc) =>
    withParts(doc, objectId, (parts) => [
      ...parts,
      ...indices.filter((i) => parts[i]).map((i) => {
        const at = atOf(parts[i]);
        return { ...structuredClone(parts[i]), name: parts[i].name ? `${parts[i].name}-copy` : undefined, at: [r1(at[0] + offset[0]), r1(at[1] + offset[1]), r1(at[2] + offset[2])] as Vec3 };
      }),
    ]);
}

// A mirrored copy of each part across the object's centre: "x" mirrors left
// to right, "y" front to back. Great for legs, arms and pairs of doors.
export function mirrorParts(objectId: string, indices: number[], axis: "x" | "y") {
  const flip = (p: PartInput): PartInput => {
    const at = atOf(p);
    const out: PartInput = structuredClone(p);
    out.at = axis === "x" ? [-at[0], at[1], at[2]] : [at[0], -at[1], at[2]];
    // Mirroring a turned part turns it the other way.
    if (p.rotation) out.rotation = (axis === "x" ? -p.rotation : 180 - p.rotation + 360) % 360 || undefined;
    if (out.repeat) out.repeat = { ...out.repeat, step: axis === "x" ? [-out.repeat.step[0], out.repeat.step[1], out.repeat.step[2]] : [out.repeat.step[0], -out.repeat.step[1], out.repeat.step[2]] };
    if (out.shape === "extrusion") {
      const ax = out.axis ?? "z";
      // Profiles: axis z (x, y), axis y (x, up), axis x (y, up).
      const flipA = (axis === "x" && (ax === "z" || ax === "y")) || (axis === "y" && ax === "x");
      const flipB = axis === "y" && ax === "z";
      out.profile = out.profile.map(([a, b]) => [flipA ? -a : a, flipB ? -b : b]);
    }
    if ((out.shape === "box" || out.shape === "extrusion") && out.holes) {
      out.holes = out.holes.map((h) => ({ ...h, at: axis === "x" ? [-h.at[0], h.at[1]] : [h.at[0], -h.at[1]] }));
    }
    if (out.shape === "wedge" && axis === "y") {
      // A wedge mirrored front to back faces the other way.
      out.rotation = ((p.rotation ?? 0) + 180) % 360 || undefined;
    }
    if (p.name) out.name = `${p.name}-mirror`;
    return clean(out);
  };
  return (doc: SceneDoc) => withParts(doc, objectId, (parts) => [...parts, ...indices.filter((i) => parts[i]).map((i) => flip(parts[i]))]);
}

// Axis-aligned bounds of a part in the object's frame (cm).
export function partBounds(part: PartInput) {
  const parsed = PartSchema.parse(part);
  const b = partBox({ ...parsed, repeat: undefined });
  const xs = b.corners.map((c) => c[0]);
  const ys = b.corners.map((c) => c[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), minZ: b.bottom, maxZ: b.top };
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.1;

// Put a part on top of whatever is under it in the same object (or on the floor).
export function sitOnTop(objectId: string, index: number) {
  return (doc: SceneDoc) =>
    withParts(doc, objectId, (parts) => {
      const me = partBounds(parts[index]);
      let z = 0;
      parts.forEach((p, i) => {
        if (i === index) return;
        const b = partBounds(p);
        if (overlaps(me.minX, me.maxX, b.minX, b.maxX) && overlaps(me.minY, me.maxY, b.minY, b.maxY) && b.maxZ <= me.maxZ + 0.1) z = Math.max(z, b.maxZ);
      });
      const at = atOf(parts[index]);
      const lift = z - (me.minZ - at[2]);
      return parts.map((p, i) => (i === index ? { ...p, at: [at[0], at[1], r1(lift)] as Vec3 } : p));
    });
}

// Snap a part being moved so its faces line up with or touch other parts'
// faces when within `tolerance` cm, on each axis separately.
export function snapPart(parts: PartInput[], index: number, at: Vec3, tolerance = 2): Vec3 {
  const moved = { ...parts[index], at };
  const me = partBounds(moved);
  const result: Vec3 = [...at];
  const axes: [keyof typeof me, keyof typeof me, number][] = [
    ["minX", "maxX", 0],
    ["minY", "maxY", 1],
    ["minZ", "maxZ", 2],
  ];
  for (const [lo, hi, k] of axes) {
    let best: number | null = null;
    parts.forEach((p, i) => {
      if (i === index) return;
      const b = partBounds(p);
      for (const target of [b[lo], b[hi]]) {
        for (const edge of [me[lo], me[hi]]) {
          const d = target - edge;
          if (Math.abs(d) <= tolerance && (best === null || Math.abs(d) < Math.abs(best))) best = d;
        }
      }
    });
    if (best !== null) result[k] = r1(result[k] + best);
  }
  // Never below the object's floor.
  const lowest = me.minZ + (result[2] - at[2]);
  if (lowest < 0) result[2] = r1(result[2] - lowest);
  return result;
}

// Leave out default values so parts read like hand-written ones.
export function compactPart(part: Part): PartInput {
  const { rotation, at, repeat, ...rest } = part;
  const out: Record<string, unknown> = { ...rest };
  if (rotation) out.rotation = rotation;
  if (at.some((v) => v !== 0)) out.at = at;
  if (repeat && repeat.count > 1) out.repeat = repeat;
  if (out.shape === "box" && out.radius === 0) delete out.radius;
  if ((out.shape === "cylinder" || out.shape === "extrusion") && out.axis === "z") delete out.axis;
  if (!out.name) delete out.name;
  return clean(out) as PartInput;
}
