import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { Light } from "../model/schema";
import { M } from "../model/units";

// Scale lamp output without changing the viewport's exposure or window fill.
// Point lamps represent broad shaded emitters in a single-bounce renderer:
// a gentler decay softens near-wall hotspots while keeping room-scale reach.
const POINT_EXPOSURE = 0.055;
const SPOT_EXPOSURE = 0.085;
const POINT_DECAY = 1.55;
const SPOT_DECAY = 1.85;
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
  const [target] = useState(() => new THREE.Object3D());
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const color = useMemo(() => kelvinColor(light.kelvin), [light.kelvin]);
  const [x, y, z] = light.at;
  const position: [number, number, number] = [M(x), M(z), M(y)];

  useEffect(() => {
    if (!lamp) return;
    const point = lamp instanceof THREE.PointLight;
    // 512 cube map with radius 2.5 matches 1024/4.5 angular sharpness (0.0049
    // vs 0.0044 rad) at 4x lower fillrate and VRAM per point lamp.
    lamp.shadow.mapSize.set(point ? 512 : 1024, point ? 512 : 1024);
    lamp.shadow.bias = -0.0008;
    lamp.shadow.normalBias = 0.02;
    lamp.shadow.radius = point ? 2.5 : 3;
    lamp.shadow.intensity = point ? 0.85 : 0.9;
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

  if (light.type === "spot") {
    const half = ((light.angle / 2) * Math.PI) / 180;
    const candela = light.lumens / (2 * Math.PI * (1 - Math.cos(half)));
    return (
      <>
        <primitive object={target} position={[position[0], position[1] - 1, position[2]]} />
        <spotLight ref={setLamp} position={position} target={target} color={color} intensity={candela * SPOT_EXPOSURE} angle={half} penumbra={0.6} decay={SPOT_DECAY} />
      </>
    );
  }
  return <pointLight ref={setLamp} position={position} color={color} intensity={(light.lumens / (4 * Math.PI)) * POINT_EXPOSURE} decay={POINT_DECAY} />;
}
