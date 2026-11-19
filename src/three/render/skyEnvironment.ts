import * as THREE from "three";
import { daylightLeft, sunDirection, sunlight } from "../../model/sun";
import { SkyDome } from "./sky";

export interface EnvironmentSettings {
  altitude: number;
  azimuth: number;
  /** Moonlight, 0 (none) to 1 (a full moon high up). */
  moon: number;
  turbidity: number;
  groundAlbedo: number;
  /** Radians. */
  blendAngle: number;
  /** Radians. */
  horizonOffset: number;
  intensityMultiplier: number;
  /** Custom sky implements Preetham-style scattering; 1/2/3 fall back to 0. */
  skyModel: 0 | 1 | 2 | 3;
}

// Numeric defaults aligned with TexSky; no V-Ray code or assets are used.
export const ENVIRONMENT_DEFAULTS: Omit<EnvironmentSettings, "altitude" | "azimuth" | "moon"> = {
  turbidity: 3,
  groundAlbedo: 0.2,
  blendAngle: 0.10017,
  horizonOffset: 0,
  intensityMultiplier: 1,
  skyModel: 0,
};

// How far the day sky has given way to the night sky: from the sun 2° up to
// 10° down (the sky's colours; its brightness follows daylightLeft).
export const nightSky = (altitude: number) => 1 - THREE.MathUtils.smoothstep(altitude, -10, 2);

// Two-degree buckets avoid rebaking for tiny slider changes; time playback is
// additionally capped at five PMREMs/second by Environment.tsx.
export function environmentKey(s: EnvironmentSettings): string {
  const moon = Math.round(s.moon * 10);
  return nightSky(s.altitude) >= 1 ? `night:${moon}` : [
    Math.round(s.altitude / 2), Math.round(s.azimuth / 2), moon,
    s.turbidity, s.intensityMultiplier,
    s.groundAlbedo, s.blendAngle, s.horizonOffset, s.skyModel,
  ].join(":");
}

export function environmentIntensity(s: EnvironmentSettings, plan: boolean): number {
  if (plan) return 0;
  // Fading with the daylight to the night's, which the moon brightens.
  const night = 0.15 + 0.08 * s.moon;
  const base = night + (0.9 - night) * daylightLeft(s.altitude);
  // Overall environment gain. Daytime integration bakes the multiplier into
  // the dome, so it requests unit multiplier here to avoid applying it twice.
  return base * Math.max(0, s.intensityMultiplier);
}

/** One-entry GPU cache, owned by a single Canvas/renderer (never by a camera). */
export class SkyEnvironment {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly sky = new SkyDome({ showSunDisc: false });
  private readonly nightDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private target: THREE.WebGLRenderTarget | null = null;
  private key = "";
  lastGenerated = -Infinity;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(100);
    // Cool twilight upper hemisphere + dim warm-neutral interior bounce below
    // so metals, glass and fabrics pick up directional night reflections.
    // Drawn over the day sky, more of it as dusk deepens; brighter with the moon.
    this.nightDome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
        uniforms: { opacity: { value: 1 }, brightness: { value: 1 } },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float opacity;
          uniform float brightness;
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 zenith = vec3(0.10, 0.17, 0.34);
            vec3 horizon = vec3(0.24, 0.35, 0.54);
            vec3 ground = vec3(0.11, 0.09, 0.07);
            vec3 skyCol = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.65));
            vec3 col = mix(ground, skyCol, smoothstep(-0.18, 0.14, y));
            gl_FragColor = vec4(col * brightness, opacity);
          }
        `,
      }),
    );
    this.nightDome.visible = false;
    // Direct sun already has a shadow-casting light: do not put a second,
    // unoccluded sun disc into the diffuse/specular environment.
    // The shader supplies the lower hemisphere: no competing hard ground plane.
    this.scene.add(this.sky);
    this.scene.add(this.nightDome);
  }

  get(s: EnvironmentSettings): THREE.Texture {
    const key = environmentKey(s);
    if (this.target && key === this.key) return this.target.texture;
    const night = nightSky(s.altitude);
    this.sky.setVisible(night < 1);
    this.nightDome.visible = night > 0;
    this.nightDome.material.uniforms.opacity.value = night;
    this.nightDome.material.uniforms.brightness.value = 0.3 + 0.2 * s.moon;
    this.scene.background = null;
    if (night < 1) {
      // Below the horizon the day sky stays as at sunset (the model alone
      // would go black at once); the night sky covers it as dusk deepens.
      const altitude = Math.max(0, Math.round(s.altitude / 2) * 2);
      const azimuth = Math.round(s.azimuth / 2) * 2;
      const light = sunlight(altitude);
      this.sky.update({
        // Environment.tsx already adds site north to azimuth; do not add it twice.
        sunDirection: new THREE.Vector3(...sunDirection({ altitude, bearing: azimuth }, 0)),
        // THREE.Color converts the CSS sRGB sunlight color to linear RGB.
        sunColor: new THREE.Color(light.color),
        // Twilight stays bright for a while after sunset (at least what the
        // sun gives 2.6° up).
        sunIntensity: Math.max(light.strength, 0.3),
        turbidity: s.turbidity,
        groundAlbedo: s.groundAlbedo,
        blendAngle: s.blendAngle,
        horizonOffset: s.horizonOffset,
        skyModel: s.skyModel,
        sizeMultiplier: 1,
        intensityMultiplier: s.intensityMultiplier,
        showSunDisc: false,
      });
    }
    const target = this.pmrem.fromScene(this.scene, 0, 0.1, 1000, { size: 128 });
    const old = this.target;
    this.target = target;
    this.key = key;
    this.lastGenerated = performance.now();
    old?.dispose();
    return target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.nightDome.geometry.dispose();
    this.nightDome.material.dispose();
    this.sky.dispose();
    this.pmrem.dispose();
  }
}
