import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { momentOf, skyColor, sunDirection, sunlight, sunPosition } from "../../model/sun";
import { useOdaja } from "../../store";
import { useLamps } from "../../ui/lampState";
import { SUN_YEAR, useSun } from "../../ui/sunState";
import { useIsDark } from "../../ui/themePref";
import { ENVIRONMENT_DEFAULTS, environmentIntensity, SkyEnvironment, type EnvironmentSettings } from "./skyEnvironment";
import { configureExposure } from "./exposure";
import { PresentationSky } from "./PresentationSky";

export function Environment() {
  const { gl, scene, invalidate } = useThree();
  const plan = useOdaja((s) => s.viewMode === "plan");
  const site = useOdaja((s) => s.project?.site);
  const sunOn = useSun((s) => s.on);
  const day = useSun((s) => s.day);
  const minutes = useSun((s) => s.minutes);
  const lampsOn = useLamps((s) => s.on);
  const dark = useIsDark();
  const cache = useRef<SkyEnvironment | null>(null);
  const presentation = useRef<PresentationSky | null>(null);
  const bakeTimer = useRef<number | null>(null);
  const latestSettings = useRef<EnvironmentSettings | null>(null);
  const position = sunOn && site
    ? sunPosition(momentOf(SUN_YEAR, day, minutes), site.latitude, site.longitude)
    : { altitude: 55, bearing: 124 };
  const night = sunOn && site ? position.altitude <= -6 : lampsOn;
  const settings: EnvironmentSettings = {
    ...ENVIRONMENT_DEFAULTS,
    altitude: position.altitude,
    azimuth: position.bearing + (sunOn && site ? site.north : 0),
    night,
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
    const sky = presentation.current;
    if (sky?.visible) camera.getWorldPosition(sky.position);
  });

  useLayoutEffect(() => {
    const sky = presentation.current;
    if (!sky) return;
    sky.visible = !plan;
    const altitude = night ? Math.min(-12, position.altitude) : position.altitude;
    const light = sunlight(altitude);
    const horizon = new THREE.Color(skyColor(altitude, dark));
    const zenith = horizon.clone().multiply(new THREE.Color().setRGB(0.48, 0.65, 0.88));
    // Preserve the existing warm sunset horizon, but keep the upper sky blue.
    const sunset = 1 - THREE.MathUtils.smoothstep(altitude, 4, 18);
    if (!night) zenith.lerp(new THREE.Color("#527caa"), sunset * 0.65);
    sky.update({
      horizonColor: horizon,
      zenithColor: zenith,
      groundColor: new THREE.Color("#898d80").multiplyScalar(night ? 0.035 : 0.65),
      sunColor: new THREE.Color(light.color),
      sunDir: new THREE.Vector3(...sunDirection({ altitude: position.altitude, bearing: settings.azimuth }, 0)),
      sunGlow: night ? 0 : 0.6 * light.strength,
    });
    invalidate();
  }, [gl, scene, plan, sunOn, site, day, minutes, lampsOn, dark, invalidate]);

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
      // Daytime multiplier is already baked by SkyDome. The neutral night
      // fallback has no dome, so its multiplier remains a scene-level gain.
      scene.environmentIntensity = environmentIntensity(
        cur.night ? cur : { ...cur, intensityMultiplier: 1 }, false,
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
  }, [gl, scene, plan, sunOn, site, day, minutes, lampsOn, invalidate]);

  return null;
}
