// 3D click-to-click tape measure: raycasts onto walls, floors, and furniture
// surfaces while still letting you orbit/pan/zoom by dragging. Shift locks the
// second point to pure vertical or horizontal.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { formatLength } from "../model/units";
import { useOdaja } from "../store";
import { useUnitSystem } from "../ui/unitPref";

type Vec3 = [number, number, number];

function isPickable(object: THREE.Object3D): boolean {
  for (let cur: THREE.Object3D | null = object; cur; cur = cur.parent) {
    if (!cur.visible || cur.userData.measureHelper || cur.userData.noAo) return false;
    if (/helper|gizmo|transformcontrols/i.test(cur.type)) return false;
    if (/^(grid|underlay|sunceiling|presentationsky)$/i.test(cur.name)) return false;
  }
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat || !mat.visible || mat.colorWrite === false) return false;
  return true;
}

function lockAxis3D(from: Vec3, to: Vec3): Vec3 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const horiz = Math.hypot(dx, dz);
  // Lock pure vertical if moving mostly up/down, else pure horizontal.
  if (Math.abs(dy) > horiz) return [from[0], to[1], from[2]];
  return [to[0], from[1], to[2]];
}

function LineSegment({ points, color, dashed = false, opacity = 1 }: { points: Vec3[]; color: string; dashed?: boolean; opacity?: number }) {
  const line = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.06, depthTest: false, transparent: true, opacity })
      : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity });
    const l = new THREE.Line(geom, mat);
    l.renderOrder = 999;
    l.frustumCulled = false;
    l.userData.measureHelper = true;
    l.userData.noAo = true;
    return l;
  }, [color, dashed, opacity]);

  useEffect(() => {
    const pos = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      pos[i * 3] = points[i]![0];
      pos[i * 3 + 1] = points[i]![1];
      pos[i * 3 + 2] = points[i]![2];
    }
    line.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    line.geometry.computeBoundingSphere();
    if (dashed) line.computeLineDistances();
  }, [line, points, dashed]);

  useEffect(() => () => {
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }, [line]);

  return <primitive object={line} />;
}

export function Measure3D({ ground }: { ground: number }) {
  const active = useOdaja((s) => s.measuring && s.viewMode === "3d");
  const setMeasuring = useOdaja((s) => s.setMeasuring);
  const units = useUnitSystem();
  const { gl, scene, camera, invalidate } = useThree();

  const [a, setA] = useState<Vec3 | null>(null);
  const [b, setB] = useState<Vec3 | null>(null);
  const [hover, setHover] = useState<Vec3 | null>(null);

  const downPos = useRef<{ x: number; y: number } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitVec = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!active) {
      setA(null);
      setB(null);
      setHover(null);
      invalidate();
    }
  }, [active, invalidate]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (a || b) {
        setA(null);
        setB(null);
        invalidate();
      } else {
        setMeasuring(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, a, b, setMeasuring, invalidate]);

  useEffect(() => {
    if (!active) return;
    const dom = gl.domElement;
    dom.style.cursor = "crosshair";

    const pick = (e: PointerEvent): Vec3 | null => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);

      const candidates: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (isPickable(obj)) candidates.push(obj);
      });
      const hits = raycaster.intersectObjects(candidates, false);
      let p: Vec3 | null = null;
      if (hits.length > 0) {
        const pt = hits[0]!.point;
        p = [pt.x, pt.y, pt.z];
      } else {
        floorPlane.constant = -ground;
        if (raycaster.ray.intersectPlane(floorPlane, hitVec)) {
          p = [hitVec.x, hitVec.y, hitVec.z];
        }
      }
      if (p && e.shiftKey && a && !b) p = lockAxis3D(a, p);
      return p;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) downPos.current = { x: e.clientX, y: e.clientY };
    };

    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return; // Don't raycast while orbiting/panning.
      setHover(pick(e));
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !downPos.current) return;
      const moved = Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y);
      downPos.current = null;
      if (moved > 5) return; // Was an orbit drag, not a click.
      const pt = pick(e);
      if (!pt) return;
      if (!a || b) {
        setA(pt);
        setB(null);
      } else {
        setB(pt);
      }
      invalidate();
    };

    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    return () => {
      dom.style.cursor = "";
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
    };
  }, [active, gl, scene, camera, ground, a, b, raycaster, ndc, floorPlane, hitVec, invalidate]);

  if (!active) return null;

  const end = b ?? hover;
  const hasSpan = Boolean(a && end);
  const dx = hasSpan ? end![0] - a![0] : 0;
  const dy = hasSpan ? end![1] - a![1] : 0;
  const dz = hasSpan ? end![2] - a![2] : 0;
  const distCm = Math.hypot(dx, dy, dz) * 100;
  const horizCm = Math.hypot(dx, dz) * 100;
  const vertCm = Math.abs(dy) * 100;
  const showLegs = hasSpan && horizCm > 2 && vertCm > 2;
  const mid: Vec3 | null = hasSpan ? [(a![0] + end![0]) / 2, (a![1] + end![1]) / 2, (a![2] + end![2]) / 2] : null;
  const corner: Vec3 | null = showLegs ? [end![0], a![1], end![2]] : null;

  return (
    <group userData={{ noAo: true, measureHelper: true }}>
      {hover && !b && (
        <mesh position={hover} renderOrder={999} userData={{ noAo: true, measureHelper: true }}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshBasicMaterial color="#c85a32" depthTest={false} transparent opacity={0.75} />
        </mesh>
      )}
      {a && (
        <mesh position={a} renderOrder={999} userData={{ noAo: true, measureHelper: true }}>
          <sphereGeometry args={[0.032, 14, 14]} />
          <meshBasicMaterial color="#c85a32" depthTest={false} />
        </mesh>
      )}
      {end && hasSpan && (
        <>
          <mesh position={end} renderOrder={999} userData={{ noAo: true, measureHelper: true }}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshBasicMaterial color="#c85a32" depthTest={false} />
          </mesh>
          <LineSegment points={[a!, end]} color="#c85a32" />
        </>
      )}
      {showLegs && corner && (
        <LineSegment points={[a!, corner, end!]} color="#c85a32" dashed opacity={0.65} />
      )}
      {mid && distCm > 0.1 && (
        <Html position={mid} center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
          <div className="measure-badge measure-badge-3d">
            <strong>{formatLength(distCm, units)}</strong>
            {showLegs && (
              <span className="measure-delta">
                (↔ {formatLength(horizCm, units)} · ↕ {formatLength(vertCm, units)})
              </span>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}
