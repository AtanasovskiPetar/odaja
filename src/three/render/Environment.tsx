import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { skyColor, sunDirection, sunlight } from "../../model/sun";
import { useOdaja } from "../../store";
import { useIsDark } from "../../ui/themePref";
import { useSky } from "../sky";
import { ENVIRONMENT_DEFAULTS, environmentIntensity, nightSky, SkyEnvironment, type EnvironmentSettings } from "./skyEnvironment";
import { configureExposure } from "./exposure";
import { PresentationSky } from "./PresentationSky";

export function Environment() {
  const { gl, scene, invalidate } = useThree();
  const plan = useOdaja((s) => s.viewMode === "plan");
  const sky = useSky();
  const dark = useIsDark();
  const cache = useRef<SkyEnvironment | null>(null);
  const presentation = useRef<PresentationSky | null>(null);
  const bakeTimer = useRef<number | null>(null);
  const latestSettings = useRef<EnvironmentSettings | null>(null);
  // Without the sunlight view: a fixed bright day.
  const position = sky?.sun ?? { altitude: 55, bearing: 124 };
  const settings: EnvironmentSettings = {
    ...ENVIRONMENT_DEFAULTS,
    altitude: position.altitude,
    azimuth: position.bearing + (sky?.north ?? 0),
    moon: sky?.moonlight ?? 0,
  };

  useLayoutEffect(() => {
    const previous = { environment: scene.environment, intensity: scene.environmentIntensity };
    const owned = new SkyEnvironment(gl);
    const sky = new PresentationSky();
    scene.add(sky);
    presentation.current = sky;
    cache.current = owned;
    return () => {
      if (bakeTimer.current !== null) {
        window.clearTimeout(bakeTimer.current);
        bakeTimer.current = null;
      }
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.intensity;
      cache.current = null;
      presentation.current = null;
      scene.remove(sky);
      sky.dispose();
      owned.dispose();
    };
  }, [gl, scene]);

  // Camera-centred even in walk mode: the background has no parallax and
  // cannot be walked out of. This does not request continuous rendering.
  useFrame(({ camera }) => {
    const background = presentation.current;
    if (background?.visible) camera.getWorldPosition(background.position);
  });

  useLayoutEffect(() => {
    const background = presentation.current;
    if (!background) return;
    background.visible = !plan;
    const { altitude } = position;
    const night = nightSky(altitude);
    const light = sunlight(altitude);
    const horizon = new THREE.Color(skyColor(altitude, dark));
    const zenith = horizon.clone().multiply(new THREE.Color().setRGB(0.48, 0.65, 0.88));
    // Preserve the existing warm sunset horizon, but keep the upper sky blue.
    const sunset = 1 - THREE.MathUtils.smoothstep(altitude, 4, 18);
    zenith.lerp(new THREE.Color("#527caa"), sunset * 0.65 * (1 - night));
    background.update({
      horizonColor: horizon,
      zenithColor: zenith,
      groundColor: new THREE.Color("#898d80").multiplyScalar(THREE.MathUtils.lerp(0.65, 0.035, night)),
      sunColor: new THREE.Color(light.color),
      sunDir: new THREE.Vector3(...sunDirection({ altitude, bearing: settings.azimuth }, 0)),
      sunGlow: 0.6 * light.strength,
      // The moon, pale by day and bright at night, by how much of it is lit.
      moonDir: new THREE.Vector3(...(sky ? sunDirection(sky.moon, sky.north) : [0, -1, 0])),
      moonGlow: sky ? sky.moon.lit * (0.3 + 0.7 * night) : 0,
    });
    invalidate();
  }, [gl, scene, plan, sky, dark, invalidate]);

  // Preserve R3F's original renderer calibration in plan mode, including
  // screenshots. Only 3D/walk use the new tone curve; no per-frame exposure.
  useLayoutEffect(() => {
    const previous = { toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure, colorSpace: gl.outputColorSpace };
    if (!plan) configureExposure(gl);
    invalidate();
    return () => {
      gl.toneMapping = previous.toneMapping;
      gl.toneMappingExposure = previous.exposure;
      gl.outputColorSpace = previous.colorSpace;
    };
  }, [gl, plan, invalidate]);

  useLayoutEffect(() => {
    const owned = cache.current;
    if (!owned) return;
    if (plan) {
      if (bakeTimer.current !== null) {
        window.clearTimeout(bakeTimer.current);
        bakeTimer.current = null;
      }
      scene.environment = null;
      scene.environmentIntensity = 0;
      invalidate();
      return;
    }
    latestSettings.current = settings;
    const update = () => {
      bakeTimer.current = null;
      const cur = latestSettings.current;
      const env = cache.current;
      if (!cur || !env) return;
      scene.environment = env.get(cur);
      // The day sky's multiplier is already baked by SkyDome. The night sky
      // has none, so there it remains a scene-level gain.
      scene.environmentIntensity = environmentIntensity(
        nightSky(cur.altitude) >= 1 ? cur : { ...cur, intensityMultiplier: 1 }, false,
      );
      invalidate();
    };
    // Trailing update always uses the latest state. Keep an already-scheduled
    // timer instead of cancelling/rescheduling it on every playback frame.
    const wait = Math.max(0, 200 - (performance.now() - owned.lastGenerated));
    if (wait === 0) {
      if (bakeTimer.current !== null) {
        window.clearTimeout(bakeTimer.current);
        bakeTimer.current = null;
      }
      update();
      return;
    }
    if (bakeTimer.current === null) {
      bakeTimer.current = window.setTimeout(update, wait);
    }
  }, [gl, scene, plan, sky, invalidate]);

  return null;
}
