import * as THREE from "three";
import { sunDirection, sunlight } from "../../model/sun";
import { SkyDome } from "./sky";

export interface EnvironmentSettings {
  altitude: number;
  azimuth: number;
  night: boolean;
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
export const ENVIRONMENT_DEFAULTS: Omit<EnvironmentSettings, "altitude" | "azimuth" | "night"> = {
  turbidity: 3,
  groundAlbedo: 0.2,
  blendAngle: 0.10017,
  horizonOffset: 0,
  intensityMultiplier: 1,
  skyModel: 0,
};

// Two-degree buckets avoid rebaking for tiny slider changes; time playback is
// additionally capped at five PMREMs/second by Environment.tsx.
export function environmentKey(s: EnvironmentSettings): string {
  return s.night ? "night" : [
    Math.round(s.altitude / 2), Math.round(s.azimuth / 2),
    s.turbidity, s.intensityMultiplier,
    s.groundAlbedo, s.blendAngle, s.horizonOffset, s.skyModel,
  ].join(":");
}

export function environmentIntensity(s: EnvironmentSettings, plan: boolean): number {
  if (plan) return 0;
  const base = s.night ? 0.30 : THREE.MathUtils.lerp(0.1, 0.9, THREE.MathUtils.clamp((s.altitude + 6) / 22, 0, 1));
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
    this.nightDome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 zenith = vec3(0.10, 0.17, 0.34);
            vec3 horizon = vec3(0.24, 0.35, 0.54);
            vec3 ground = vec3(0.11, 0.09, 0.07);
            vec3 skyCol = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.65));
            vec3 col = mix(ground, skyCol, smoothstep(-0.18, 0.14, y));
            gl_FragColor = vec4(col, 1.0);
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
    this.sky.setVisible(!s.night);
    this.nightDome.visible = s.night;
    this.scene.background = null;
    if (s.night) this.sky.update({ sunIntensity: 0, showSunDisc: false });
    if (!s.night) {
      const altitude = Math.round(s.altitude / 2) * 2;
      const azimuth = Math.round(s.azimuth / 2) * 2;
      const light = sunlight(altitude);
      this.sky.update({
        // Environment.tsx already adds site north to azimuth; do not add it twice.
        sunDirection: new THREE.Vector3(...sunDirection({ altitude, bearing: azimuth }, 0)),
        // THREE.Color converts the CSS sRGB sunlight color to linear RGB.
        sunColor: new THREE.Color(light.color),
        sunIntensity: light.strength,
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
