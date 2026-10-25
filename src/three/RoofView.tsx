// Roofs in 3D: each face a slab of the roof's thickness following its slope,
// and the gable ends under it in the walls' material. Drawn by ShellView on
// top of their level's walls.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vec } from "../model/geometry";
import { roofFaces, roofGables, roofMaterial, roofThickness } from "../model/roofs";
import type { Roof } from "../model/schema";
import { M } from "../model/units";
import { useMaterials } from "./materials";

type P3 = [number, number, number];

// Newell's normal of a polygon (not normalised).
function normal(poly: P3[]): P3 {
  const n: P3 = [0, 0, 0];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  return n;
}

// A polygon turned so it faces `out`.
const facing = (poly: P3[], out: P3): P3[] => {
  const n = normal(poly);
  return n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [...poly].reverse() : poly;
};

// Triangles from a list of quads and convex polygons, in world metres.
function build(polys: P3[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const poly of polys) {
    for (let i = 1; i + 1 < poly.length; i++) positions.push(...poly[0], ...poly[i], ...poly[i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function roofGeometry(roof: Roof, base: number) {
  const t = roofThickness(roof);
  const at = ([x, y]: Vec, h: number): P3 => [M(x), M(base + h), M(y)];
  // Every face turned outwards (up, down, or away from the face's middle),
  // so the roof can be drawn one-sided and doesn't shadow itself.
  const cover: P3[][] = [];
  for (const face of roofFaces(roof)) {
    const top = face.poly.map((p) => at(p, face.height(p) + t));
    const bottom = face.poly.map((p) => at(p, face.height(p)));
    cover.push(facing(top, [0, 1, 0]), facing(bottom, [0, -1, 0]));
    const c = face.poly.reduce((s, p) => [s[0] + p[0] / face.poly.length, s[1] + p[1] / face.poly.length], [0, 0]);
    // The edges: fascias at the eaves and verges.
    face.poly.forEach((p, i) => {
      const q = face.poly[(i + 1) % face.poly.length];
      const out: P3 = [(p[0] + q[0]) / 2 - c[0], 0, (p[1] + q[1]) / 2 - c[1]];
      cover.push(facing([at(p, face.height(p)), at(q, face.height(q)), at(q, face.height(q) + t), at(p, face.height(p) + t)], out));
    });
  }
  const gables = roofGables(roof).map(({ a, b, ha, hb }) => [at(a, 0), at(b, 0), at(b, hb), at(a, ha)]);
  return { cover: build(cover), gables: gables.length ? build(gables) : null };
}

// `base`: the top of the walls it stands on, cm above the level's floor.
export function RoofView({ roof, base }: { roof: Roof; base: number }) {
  const material = useMaterials();
  const { cover, gables } = useMemo(() => roofGeometry(roof, base), [roof, base]);
  useEffect(() => () => [cover, gables].forEach((g) => g?.dispose()), [cover, gables]);
  const roofMat = useMemo(() => {
    const m = material(roofMaterial(roof)).clone();
    m.side = THREE.FrontSide;
    m.shadowSide = THREE.BackSide;
    return m;
  }, [material, roof]);
  const wallMat = useMemo(() => {
    const m = material("wall").clone();
    m.side = THREE.DoubleSide;
    return m;
  }, [material]);
  useEffect(() => () => [roofMat, wallMat].forEach((m) => m.dispose()), [roofMat, wallMat]);
  return (
    <group userData={{ kind: "roof", id: roof.id }}>
      <mesh geometry={cover} castShadow receiveShadow material={roofMat} />
      {gables && <mesh geometry={gables} castShadow receiveShadow material={wallMat} />}
    </group>
  );
}
