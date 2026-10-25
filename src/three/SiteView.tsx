// The garden in 3D: the plot's ground, outdoor areas (flat, raised as a deck
// or terrace, or water in a basin) and fences by style. Drawn at the first
// level's floor height, by ShellView.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec } from "../model/geometry";
import type { Area, Fence, Shell } from "../model/schema";
import { areaMaterial, fenceHeight, fenceLength, fenceMaterial, fenceSpans, fenceThickness, PLOT_COLOR } from "../model/site";
import { flatShapes } from "./ShellView";
import { M } from "../model/units";
import { useMaterials } from "./materials";

const WATER = new THREE.MeshStandardMaterial({ color: "#5fa8cc", roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72 });
// A pool's basin is drawn from inside: only the faces turned away from the
// viewer, which are its walls and floor seen through the water.
const BASIN = new THREE.MeshStandardMaterial({ color: "#cfe3ea", roughness: 0.6, side: THREE.BackSide });
const POOL_DEPTH = 120;
const WATER_LEVEL = 8; // cm below the ground

// Shape coordinates are (x, -y) so that after laying the shape flat (rotating
// -90° about X) plan y ends up on world +z.
const flat = (poly: Vec[]) => poly.map(([x, y]) => new THREE.Vector2(M(x), -M(y)));
const LAY_FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

// The plot's ground, just under the floors, open where there's water.
function PlotGround({ shell }: { shell: Shell }) {
  const material = useMaterials();
  const plot = shell.plot!;
  const geometry = useMemo(() => {
    const water = shell.areas.filter((a) => a.kind === "water").map((a) => a.polygon);
    return new THREE.ShapeGeometry(flatShapes(plot.polygon, water));
  }, [plot.polygon, shell.areas]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} rotation={LAY_FLAT} position={[0, -0.012, 0]} receiveShadow material={material(plot.material ?? PLOT_COLOR)} />;
}

// `layer`: areas listed later lie on top (a path across a lawn), a hair
// higher so they don't flicker. `pools`: water, which other surfaces are
// open over.
function AreaView({ area, layer, pools }: { area: Area; layer: number; pools: Vec[][] }) {
  const material = useMaterials();
  const height = area.height ?? 0;
  const water = area.kind === "water";
  const { surface, solid } = useMemo(() => {
    const shapes = water ? [new THREE.Shape(flat(area.polygon))] : flatShapes(area.polygon, pools);
    return {
      surface: new THREE.ShapeGeometry(shapes),
      // A raised deck or terrace, or a pool's basin.
      solid: water || height > 0 ? new THREE.ExtrudeGeometry(shapes, { depth: M(water ? POOL_DEPTH : height), bevelEnabled: false }) : null,
    };
  }, [area.polygon, height, water, pools]);
  useEffect(() => () => [surface, solid].forEach((g) => g?.dispose()), [surface, solid]);
  if (water) {
    return (
      <group userData={{ kind: "garden", id: area.id }}>
        {/* Water takes no shadows: on a see-through surface they only speckle. */}
        <mesh geometry={solid!} rotation={LAY_FLAT} position={[0, -M(POOL_DEPTH), 0]} material={BASIN} />
        <mesh geometry={surface} rotation={LAY_FLAT} position={[0, -M(WATER_LEVEL), 0]} material={area.material ? material(area.material) : WATER} />
      </group>
    );
  }
  return (
    <group userData={{ kind: "garden", id: area.id }}>
      {solid ? (
        <mesh geometry={solid} rotation={LAY_FLAT} castShadow receiveShadow material={material(areaMaterial(area))} />
      ) : (
        <mesh geometry={surface} rotation={LAY_FLAT} position={[0, 0.004 + layer * 0.0008, 0]} receiveShadow material={material(areaMaterial(area))} />
      )}
    </group>
  );
}

// A fence's pieces in its own frame (x along it from `from`, y up, z across),
// merged into one geometry.
function fenceGeometry(f: Fence): THREE.BufferGeometry | null {
  const h = M(fenceHeight(f));
  const t = M(fenceThickness(f));
  const boxes: THREE.BufferGeometry[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, depth = t) => {
    if (x1 - x0 < 0.001) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, depth);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    boxes.push(g);
  };
  for (const [s0, s1] of fenceSpans(f).map(([a, b]) => [M(a), M(b)])) {
    if (f.style === "slats") {
      // Upright slats with gaps, on two rails behind.
      const slat = 0.08;
      const gap = 0.03;
      const count = Math.max(1, Math.floor((s1 - s0 + gap) / (slat + gap)));
      const start = s0 + (s1 - s0 - (count * slat + (count - 1) * gap)) / 2;
      for (let i = 0; i < count; i++) box(start + i * (slat + gap), start + i * (slat + gap) + slat, 0.04, h, t);
      for (const y of [0.25 * h, 0.8 * h]) box(s0, s1, y, y + 0.06, t * 0.5);
    } else if (f.style === "rail") {
      // Posts at most 2 m apart, two rails.
      const posts = Math.max(1, Math.ceil((s1 - s0) / 2));
      for (let i = 0; i <= posts; i++) {
        const x = s0 + ((s1 - s0) * i) / posts;
        box(Math.max(s0, x - 0.05), Math.min(s1, x + 0.05), 0, h, Math.max(t, 0.1));
      }
      for (const y of [0.45 * h, 0.9 * h]) box(s0, s1, y - 0.05, y + 0.05, 0.05);
    } else {
      // Boards, a hedge or a garden wall: one solid stretch.
      box(s0, s1, 0, h);
    }
  }
  if (!boxes.length) return null;
  const merged = mergeGeometries(boxes);
  boxes.forEach((b) => b.dispose());
  return merged;
}

function FenceView({ fence }: { fence: Fence }) {
  const material = useMaterials();
  const geometry = useMemo(() => fenceGeometry(fence), [fence]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry || fenceLength(fence) < 1) return null;
  const angle = Math.atan2(fence.to[1] - fence.from[1], fence.to[0] - fence.from[0]);
  return (
    <mesh
      geometry={geometry}
      position={[M(fence.from[0]), 0, M(fence.from[1])]}
      rotation={[0, -angle, 0]}
      castShadow
      receiveShadow
      material={material(fenceMaterial(fence))}
      userData={{ kind: "fence", id: fence.id }}
    />
  );
}

export function SiteView({ shell }: { shell: Shell }) {
  const pools = useMemo(() => shell.areas.filter((a) => a.kind === "water").map((a) => a.polygon), [shell.areas]);
  return (
    <group>
      {shell.plot && <PlotGround shell={shell} />}
      {shell.areas.map((a, i) => (
        <AreaView key={a.id} area={a} layer={i} pools={pools} />
      ))}
      {shell.fences.map((f) => (
        <FenceView key={f.id} fence={f} />
      ))}
    </group>
  );
}
