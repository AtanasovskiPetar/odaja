import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Light } from "../model/schema";
import { M } from "../model/units";

const EXPOSURE = 0.1;
const SHADOW_LAMPS = 4;

export function kelvinColor(kelvin: number): THREE.Color {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

const lamps = new Set<THREE.PointLight | THREE.SpotLight>();

export function LampLight({ light }: { light: Light }) {
  const [lamp, setLamp] = useState<THREE.PointLight | THREE.SpotLight | null>(null);
  const [target] = useState(() => new THREE.Object3D());
  const color = useMemo(() => kelvinColor(light.kelvin), [light.kelvin]);
  const [x, y, z] = light.at;
  const position: [number, number, number] = [M(x), M(z), M(y)];

  useEffect(() => {
    if (!lamp) return;
    lamp.castShadow = false;
    lamp.shadow.mapSize.set(512, 512);
    lamp.shadow.bias = -0.002;
    lamp.shadow.normalBias = 0.02;
    lamp.shadow.camera.near = 0.05;
    lamp.shadow.camera.far = 15;
    lamps.add(lamp);
    return () => void lamps.delete(lamp);
  }, [lamp]);

  if (light.type === "spot") {
    const half = ((light.angle / 2) * Math.PI) / 180;
    const candela = light.lumens / (2 * Math.PI * (1 - Math.cos(half)));
    return (
      <>
        <primitive object={target} position={[position[0], position[1] - 1, position[2]]} />
        <spotLight ref={setLamp} position={position} target={target} color={color} intensity={candela * EXPOSURE} angle={half} penumbra={0.3} decay={2} />
      </>
    );
  }
  return <pointLight ref={setLamp} position={position} color={color} intensity={(light.lumens / (4 * Math.PI)) * EXPOSURE} decay={2} />;
}

export function LampShadows() {
  const since = useRef(0);
  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, delta) => {
    since.current += delta;
    if (since.current < 0.25) return;
    since.current = 0;
    const nearest = [...lamps]
      .map((lamp) => ({ lamp, d: lamp.getWorldPosition(at).distanceToSquared(camera.position) }))
      .sort((a, b) => a.d - b.d);
    nearest.forEach(({ lamp }, i) => (lamp.castShadow = i < SHADOW_LAMPS));
  });
  return null;
}
