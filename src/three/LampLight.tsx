import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import type { Light } from "../model/schema";
import { M } from "../model/units";
import { useSky } from "./sky";

RectAreaLightUniformsLib.init();

// Scale lamp output with physical inverse-square falloff (decay = 2) so lamps
// create natural pools of light instead of flooding distant walls. Because the
// viewport uses fixed exposure (no auto-exposure), lamps also adapt to daylight:
// subtle warm accents in full sun/daylight (~28%), ramping smoothly through dusk
// to full brightness at night.
const POINT_EXPOSURE = 0.048;
const SPOT_EXPOSURE = 0.075;
const AREA_EXPOSURE = 0.016;
const POINT_DECAY = 2;
const SPOT_DECAY = 2;
const DAYLIGHT_LAMP_SCALE = 0.28;
const SHADOW_LAMPS = 4;

export function kelvinColor(kelvin: number): THREE.Color {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

type Lamp = THREE.PointLight | THREE.SpotLight;
// Every lit lamp, with its lumens.
const lamps = new Map<Lamp, number>();

// The brightest lamps cast shadows, whatever the viewpoint. Choosing by the
// camera would make rooms light up differently as you move (a lamp without a
// shadow shines through walls), and a new mix of point and spot shadows
// recompiles every shader (see ShaderGate).
function chooseShadows() {
  [...lamps]
    .sort((a, b) => b[1] - a[1])
    .forEach(([lamp], i) => (lamp.castShadow = i < SHADOW_LAMPS));
}

export function LampLight({ light }: { light: Light }) {
  const [lamp, setLamp] = useState<Lamp | null>(null);
  const rectRef = useRef<THREE.RectAreaLight | null>(null);
  const [target] = useState(() => new THREE.Object3D());
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const sky = useSky();
  const daylight = sky ? sky.daylight : 1;
  const adaptation = DAYLIGHT_LAMP_SCALE + (1 - DAYLIGHT_LAMP_SCALE) * (1 - daylight);
  const color = useMemo(() => kelvinColor(light.kelvin), [light.kelvin]);
  const [x, y, z] = light.at;
  const [tx, ty, tz] = light.target;
  const [sw, sd] = light.size;
  const position: [number, number, number] = [M(x), M(z), M(y)];
  const targetPos: [number, number, number] = [M(tx), M(tz), M(ty)];

  useEffect(() => {
    if (!lamp) return;
    const point = lamp instanceof THREE.PointLight;
    // 512 cube map with radius 2.5 matches 1024/4.5 angular sharpness (0.0049
    // vs 0.0044 rad) at 4x lower fillrate and VRAM per point lamp.
    lamp.shadow.mapSize.set(point ? 512 : 1024, point ? 512 : 1024);
    lamp.shadow.bias = -0.0006;
    lamp.shadow.normalBias = 0.025;
    lamp.shadow.radius = point ? 2.5 : 3;
    lamp.shadow.intensity = point ? 0.72 : 0.78;
    lamp.shadow.camera.near = 0.15;
    lamp.shadow.camera.far = 15;
    lamps.set(lamp, light.lumens);
    chooseShadows();
    gl.shadowMap.needsUpdate = true;
    invalidate();
    return () => {
      lamps.delete(lamp);
      chooseShadows();
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
  }, [lamp, light.lumens, gl, invalidate]);

  // Refresh shadows when the light emitter or spot target moves.
  useEffect(() => {
    if (!lamp) return;
    target.updateMatrixWorld();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [lamp, target, x, y, z, tx, ty, tz, light.angle, gl, invalidate]);

  // Aim RectAreaLight toward `targetPos` (RectAreaLight emits along local -Z
  // and Object3D.lookAt points -Z at the target for lights).
  useEffect(() => {
    const rect = rectRef.current;
    if (!rect || light.type !== "area") return;
    rect.position.set(position[0], position[1], position[2]);
    // Avoid degenerate lookAt when target coincides with position.
    const dx = targetPos[0] - position[0];
    const dy = targetPos[1] - position[1];
    const dz = targetPos[2] - position[2];
    if (dx * dx + dy * dy + dz * dz < 1e-6) {
      rect.lookAt(position[0], position[1] - 1, position[2]);
    } else {
      rect.lookAt(targetPos[0], targetPos[1], targetPos[2]);
    }
    rect.updateMatrixWorld();
    invalidate();
  }, [light.type, position[0], position[1], position[2], targetPos[0], targetPos[1], targetPos[2], sw, sd, invalidate]);

  if (light.type === "area") {
    const w = Math.max(0.05, M(sw));
    const d = Math.max(0.05, M(sd));
    const area = Math.max(w * d, 0.01);
    const intensity = (light.lumens / (Math.PI * area)) * AREA_EXPOSURE * adaptation;
    return <rectAreaLight ref={rectRef} position={position} color={color} intensity={intensity} width={w} height={d} />;
  }

  if (light.type === "spot") {
    const half = ((light.angle / 2) * Math.PI) / 180;
    const candela = light.lumens / (2 * Math.PI * (1 - Math.cos(half)));
    // Tight recessed downlights (60°) keep a crisp 0.6 cone; wide ceiling
    // fixtures / ring chandeliers (100–140°) feather smoothly up to 0.92.
    const penumbra = light.penumbra ?? THREE.MathUtils.clamp(0.6 + ((light.angle - 60) / 60) * 0.32, 0.6, 0.92);
    return (
      <>
        <primitive object={target} position={targetPos} />
        <spotLight ref={setLamp} position={position} target={target} color={color} intensity={candela * SPOT_EXPOSURE * adaptation} angle={half} penumbra={penumbra} decay={SPOT_DECAY} />
      </>
    );
  }
  return <pointLight ref={setLamp} position={position} color={color} intensity={(light.lumens / (4 * Math.PI)) * POINT_EXPOSURE * adaptation} decay={POINT_DECAY} />;
}

// 3D editor visualizer for a selected lamp: shows the exact bulb position
// (visible through shades) and, for spotlights / area lights, the aim line and
// beam cone or emitter rectangle.
export function LightHelper({
  light,
  active = true,
  onSelect,
}: {
  light: Light;
  active?: boolean;
  onSelect?: () => void;
}) {
  const color = useMemo(() => kelvinColor(light.kelvin), [light.kelvin]);
  const [x, y, z] = light.at;
  const [tx, ty, tz] = light.target;
  const [sw, sd] = light.size;
  const at: [number, number, number] = [M(x), M(z), M(y)];
  const to: [number, number, number] = [M(tx), M(tz), M(ty)];

  const guideLine = useMemo(() => {
    if (light.type === "point") return null;
    const a = new THREE.Vector3(...at);
    const b = new THREE.Vector3(...to);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.01) dir.set(0, -1, 0);
    else dir.divideScalar(len);
    const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
    const u = new THREE.Vector3().crossVectors(dir, up).normalize();
    const v = new THREE.Vector3().crossVectors(dir, u).normalize();

    const verts: number[] = [];
    // Aim axis line
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z);

    if (light.type === "spot") {
      const coneLen = Math.max(0.4, Math.min(len || 1, 2.5));
      const half = Math.min((light.angle * Math.PI) / 360, Math.PI * 0.46);
      const radius = Math.tan(half) * coneLen;
      const center = a.clone().addScaledVector(dir, coneLen);
      const segs = 24;
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        ring.push(center.clone().addScaledVector(u, Math.cos(th) * radius).addScaledVector(v, Math.sin(th) * radius));
      }
      for (let i = 0; i < segs; i++) {
        const p0 = ring[i]!;
        const p1 = ring[(i + 1) % segs]!;
        verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        if (i % 6 === 0) verts.push(a.x, a.y, a.z, p0.x, p0.y, p0.z);
      }
    } else if (light.type === "area") {
      const hw = M(sw) / 2;
      const hd = M(sd) / 2;
      const c0 = a.clone().addScaledVector(u, -hw).addScaledVector(v, -hd);
      const c1 = a.clone().addScaledVector(u, hw).addScaledVector(v, -hd);
      const c2 = a.clone().addScaledVector(u, hw).addScaledVector(v, hd);
      const c3 = a.clone().addScaledVector(u, -hw).addScaledVector(v, hd);
      verts.push(
        c0.x, c0.y, c0.z, c1.x, c1.y, c1.z,
        c1.x, c1.y, c1.z, c2.x, c2.y, c2.z,
        c2.x, c2.y, c2.z, c3.x, c3.y, c3.z,
        c3.x, c3.y, c3.z, c0.x, c0.y, c0.z,
        // Diagonal cross to make the emitter plane obvious
        c0.x, c0.y, c0.z, c2.x, c2.y, c2.z,
        c1.x, c1.y, c1.z, c3.x, c3.y, c3.z,
      );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: active ? 0.78 : 0.35 });
    const seg = new THREE.LineSegments(geom, mat);
    seg.renderOrder = 900;
    seg.frustumCulled = false;
    seg.userData.noAo = true;
    seg.userData.measureHelper = true;
    return seg;
  }, [light.type, light.angle, sw, sd, at[0], at[1], at[2], to[0], to[1], to[2], color, active]);

  useEffect(() => () => {
    if (!guideLine) return;
    guideLine.geometry.dispose();
    (guideLine.material as THREE.Material).dispose();
  }, [guideLine]);

  return (
    <group userData={{ noAo: true, measureHelper: true }}>
      <mesh
        position={at}
        renderOrder={901}
        userData={{ noAo: true, measureHelper: true }}
        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      >
        <sphereGeometry args={[active ? 0.044 : 0.032, 14, 14]} />
        <meshBasicMaterial color={active ? color : "#d8c4a8"} depthTest={false} transparent opacity={light.on ? (active ? 0.95 : 0.6) : 0.35} />
      </mesh>
      {light.type !== "point" && (
        <>
          {guideLine && <primitive object={guideLine} />}
          {active && (
            <mesh position={to} renderOrder={901} userData={{ noAo: true, measureHelper: true }}>
              <sphereGeometry args={[0.032, 12, 12]} />
              <meshBasicMaterial color="#c85a32" depthTest={false} transparent opacity={0.9} />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}
