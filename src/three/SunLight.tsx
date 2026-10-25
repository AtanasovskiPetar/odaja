// The 3D lighting. Normally a fixed soft light; with the sunlight view on
// (and a site set) the real sun for the chosen day and time: its direction,
// strength and colour, sharp shadows through the windows, a dimmer room so the
// patches of sun stand out, and a sky that follows the time.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { shellBounds } from "../model/geometry";
import { siteBounds } from "../model/site";
import { momentOf, skyColor, sunDirection, sunlight, sunPosition } from "../model/sun";
import { M } from "../model/units";
import { useOdaja } from "../store";
import { SUN_YEAR, useSun } from "../ui/sunState";
import { isDark } from "../ui/themePref";
import type { SceneTheme } from "./theme";

// Blocks sun from above (the 3D view has no ceiling), invisible otherwise:
// it only casts shadows.
const SHADOW_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

function SunCeiling({ bounds, height }: { bounds: { minX: number; minY: number; maxX: number; maxY: number }; height: number }) {
  const w = M(bounds.maxX - bounds.minX);
  const d = M(bounds.maxY - bounds.minY);
  return (
    <mesh position={[M((bounds.minX + bounds.maxX) / 2), M(height) + 0.01, M((bounds.minY + bounds.maxY) / 2)]} material={SHADOW_ONLY} castShadow>
      <boxGeometry args={[w, 0.02, d]} />
    </mesh>
  );
}

function Sun({ theme, walk }: { theme: SceneTheme; walk: boolean }) {
  const site = useOdaja((s) => s.project?.site);
  const shell = useOdaja((s) => s.shell);
  const whole = useOdaja((s) => s.wholeShell);
  const day = useSun((s) => s.day);
  const minutes = useSun((s) => s.minutes);
  const scene = useThree((s) => s.scene);
  const light = useRef<THREE.DirectionalLight>(null);

  // The shadow-only ceiling covers the house; shadows fall across the plot.
  const house = useMemo(() => (shell ? shellBounds(shell) : null), [shell]);
  const bounds = useMemo(() => (whole ? siteBounds(whole) : null), [whole]);
  const pos = sunPosition(momentOf(SUN_YEAR, day, minutes), site!.latitude, site!.longitude);
  const dir = sunDirection(pos, site!.north);
  const { strength, color } = sunlight(pos.altitude);
  const center: [number, number, number] = bounds ? [M((bounds.minX + bounds.maxX) / 2), 0, M((bounds.minY + bounds.maxY) / 2)] : [0, 0, 0];
  // The shadow box just covers the house and garden, for the sharpest shadows.
  const radius = bounds ? Math.hypot(M(bounds.maxX - bounds.minX), M(bounds.maxY - bounds.minY)) / 2 + 1 : 10;

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    scene.add(l.target);
    return () => void scene.remove(l.target);
  }, [scene]);
  useEffect(() => {
    light.current?.target.position.set(...center);
    light.current?.target.updateMatrixWorld();
  });

  const sky = skyColor(pos.altitude, isDark());
  // Daylight in the room comes mostly from the sky through the windows: dimmer
  // indoors at night, never black.
  const ambient = (walk ? 1.15 : 1.3) * (0.3 + 0.7 * Math.min(1, Math.max(0, (pos.altitude + 6) / 20)));
  const distance = radius + 30;

  return (
    <>
      <color attach="background" args={[sky]} />
      <hemisphereLight args={[sky, theme.ground, ambient]} />
      <directionalLight
        ref={light}
        position={[center[0] + dir[0] * distance, Math.max(0.5, dir[1] * distance), center[2] + dir[2] * distance]}
        color={color}
        intensity={3.2 * strength}
        castShadow={strength > 0}
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-radius, radius, radius, -radius, 0.5, distance + radius * 2]} />
      </directionalLight>
      {house && shell && <SunCeiling bounds={house} height={shell.wallHeight} />}
    </>
  );
}

// Moves the time along while playing: a day in about 20 seconds.
function SunPlayer() {
  useFrame((_, delta) => {
    const s = useSun.getState();
    if (!s.playing) return;
    const next = s.minutes + delta * 72;
    if (next >= 1439) {
      s.setMinutes(1439);
      s.setPlaying(false);
    } else useSun.setState({ minutes: next });
  });
  return null;
}

export function Lights({ theme, plan, walk }: { theme: SceneTheme; plan: boolean; walk: boolean }) {
  const sunOn = useSun((s) => s.on);
  const hasSite = useOdaja((s) => Boolean(s.project?.site));
  if (sunOn && hasSite && !plan) {
    return (
      <>
        <Sun theme={theme} walk={walk} />
        <SunPlayer />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={[plan ? theme.paper : walk ? theme.walk : theme.room]} />
      <hemisphereLight args={["#ffffff", theme.ground, plan ? 2.2 : walk ? 2.0 : 1.4]} />
      <directionalLight position={[6, 12, 4]} intensity={plan ? 0.8 : 1.6} castShadow={!plan} shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.5, 40]} />
      </directionalLight>
    </>
  );
}
