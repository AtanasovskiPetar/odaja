// The 3D lighting. Normally a fixed soft light; with the sunlight view on
// (and a site set) the real sky for the chosen day and time: the sun's
// direction, strength and colour, sharp shadows through the windows, a dimmer
// room so the patches of sun stand out, and a sky that follows the time. After
// sunset the moon takes over, by its phase; lamps add to either.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { shellBounds } from "../model/geometry";
import { siteBounds } from "../model/site";
import { skyColor, sunDirection, sunlight } from "../model/sun";
import { M } from "../model/units";
import { useOdaja } from "../store";
import { useLamps } from "../ui/lampState";
import { useSun } from "../ui/sunState";
import { isDark } from "../ui/themePref";
import { LampShadows } from "./LampLight";
import { WindowLight } from "./render/WindowLight";
import { useSky, type Sky } from "./sky";
import type { SceneTheme } from "./theme";

// The night's fill, toward which the sky's light fades after sunset.
const NIGHT_SKY = "#9cb6d8";
const NIGHT_GROUND = "#343b48";
const MOON_COLOR = "#aebfdd";
// A full moon high up, against the sun's 2.6: far brighter than the real
// ratio so a moonlit room reads, yet below the sun at sunset, so evenings
// only get darker.
const MOON_LIGHT = 0.15;

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

function Sun({ theme, walk, sky }: { theme: SceneTheme; walk: boolean; sky: Sky }) {
  const shell = useOdaja((s) => s.shell);
  const whole = useOdaja((s) => s.wholeShell);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const light = useRef<THREE.DirectionalLight>(null);

  // The shadow-only ceiling covers the house; shadows fall across the plot.
  const house = useMemo(() => (shell ? shellBounds(shell) : null), [shell]);
  const bounds = useMemo(() => (whole ? siteBounds(whole) : null), [whole]);
  // Once the sun is down the same light is the moon: one light, so the
  // shaders stay the same (ShaderGate). It shows as the sky darkens.
  const sun = sunlight(sky.sun.altitude);
  const byMoon = sun.strength === 0;
  const dir = sunDirection(byMoon ? sky.moon : sky.sun, sky.north);
  const color = byMoon ? MOON_COLOR : sun.color;
  const moonIn = Math.min(1, (-1 - sky.sun.altitude) / 7); // from no sun to the sun 8° down
  const intensity = byMoon ? MOON_LIGHT * sky.moonlight * moonIn : 2.6 * sun.strength;
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
    invalidate();
  }, [center[0], center[1], center[2], invalidate]);

  const background = skyColor(sky.sun.altitude, isDark());
  // A small fill from the sky (PMREM gives most of it), keeping deep
  // interiors readable. It fades with the daylight to the night's, which
  // the moon brightens; never black.
  const night = 1 - sky.daylight;
  const nightFill = 0.1 + 0.06 * sky.moonlight;
  const ambient = nightFill + ((walk ? 0.3 : 0.35) - nightFill) * sky.daylight;
  const fillSky = useMemo(() => new THREE.Color(background).lerp(new THREE.Color(NIGHT_SKY), night), [background, night]);
  const fillGround = useMemo(() => new THREE.Color(theme.ground).lerp(new THREE.Color(NIGHT_GROUND), night), [theme.ground, night]);
  const distance = radius + 30;

  return (
    <>
      <color attach="background" args={[background]} />
      <hemisphereLight color={fillSky} groundColor={fillGround} intensity={ambient} />
      <directionalLight
        ref={light}
        position={[center[0] + dir[0] * distance, Math.max(0.5, dir[1] * distance), center[2] + dir[2] * distance]}
        color={color}
        intensity={intensity}
        // Casting at all times (sun, moon or neither), so the time passing
        // sunset doesn't change every shader; a dark light's shadow isn't redrawn.
        castShadow
        shadow-autoUpdate={intensity > 0}
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
  const sky = useSky();
  const lampsOn = useLamps((s) => s.on);
  const lamps = lampsOn && !plan && <LampShadows />;
  if (sky && !plan) {
    return (
      <>
        <Sun theme={theme} walk={walk} sky={sky} />
        <SunPlayer />
        <WindowLight />
        {lamps}
      </>
    );
  }
  return (
    <>
      <color attach="background" args={[plan ? theme.paper : walk ? theme.walk : theme.room]} />
      {!plan && <WindowLight />}
      {lamps}
      <hemisphereLight args={["#ffffff", theme.ground, plan ? 2.2 : walk ? 0.3 : 0.35]} />
      {/* Bias keeps sloped surfaces (roofs) from shadowing themselves in rings. */}
      <directionalLight position={[6, 12, 4]} intensity={plan ? 0.8 : 1.4} castShadow={!plan} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.02}>
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.5, 40]} />
      </directionalLight>
    </>
  );
}
