import * as THREE from "three";

export type SkyModel = 0 | 1 | 2 | 3;

/** Colors are linear RGB; angles are radians; directions use world Y-up. */
export interface SkySettings {
  turbidity: number;
  ozone: number;
  waterVapour: number;
  intensityMultiplier: number;
  sizeMultiplier: number;
  groundAlbedo: number | THREE.Color;
  blendAngle: number;
  horizonOffset: number;
  skyModel: SkyModel;
  showSunDisc: boolean;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
}

export const SKY_DEFAULTS: Readonly<SkySettings> = {
  turbidity: 3,
  ozone: 0.35,
  waterVapour: 2,
  intensityMultiplier: 1,
  sizeMultiplier: 1,
  groundAlbedo: 0.2,
  blendAngle: 0.10017,
  horizonOffset: 0,
  skyModel: 0,
  showSunDisc: true,
  sunDirection: new THREE.Vector3(0, 1, 0),
  sunColor: new THREE.Color(1, 1, 1),
  sunIntensity: 1,
};

export function finiteClamp(value: number, low: number, high: number, fallback: number): number {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, low, high) : fallback;
}

/** Sea-level Rayleigh coefficients at representative linear RGB wavelengths. */
export function rayleighCoefficients(): THREE.Vector3 {
  const n = 1.0003;
  const numberDensity = 2.545e25;
  const depolarization = 0.035;
  const factor = 8 * Math.PI ** 3 * (n * n - 1) ** 2
    / (3 * numberDensity) * (6 + 3 * depolarization) / (6 - 7 * depolarization);
  return new THREE.Vector3(...([680e-9, 550e-9, 440e-9].map(
    wavelength => factor / wavelength ** 4,
  ) as [number, number, number]));
}

/** Angstrom aerosol optical depth, distributed over a 1200 m scale height. */
export function mieCoefficients(turbidity: number): THREE.Vector3 {
  const t = finiteClamp(turbidity, 2, 20, 3);
  const tau550 = 0.04608 * t - 0.04586;
  return new THREE.Vector3(...([680, 550, 440].map(
    wavelength => tau550 * (wavelength / 550) ** -1.3 / 1200,
  ) as [number, number, number]));
}

export function createSkyUniforms() {
  return {
    betaRayleigh: { value: rayleighCoefficients() },
    betaMie: { value: mieCoefficients(3) },
    ozone: { value: 0.35 },
    waterVapour: { value: 2 },
    skyModel: { value: 0 },
    intensityMultiplier: { value: 1 },
    sizeMultiplier: { value: 1 },
    groundAlbedo: { value: new THREE.Color(0.2, 0.2, 0.2) },
    blendAngle: { value: 0.10017 },
    horizonOffset: { value: 0 },
    showSunDisc: { value: true },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(1, 1, 1) },
    sunIntensity: { value: 1 },
  };
}

export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

export function updateSkyUniforms(uniforms: SkyUniforms, settings: SkySettings): void {
  uniforms.betaMie.value.copy(mieCoefficients(settings.turbidity));
  uniforms.ozone.value = finiteClamp(settings.ozone, 0, 1, 0.35);
  uniforms.waterVapour.value = finiteClamp(settings.waterVapour, 0, 100, 2);
  // Models 1/2/3 deliberately fall back to model 0. No CIE/Hosek data is used.
  uniforms.skyModel.value = 0;
  uniforms.intensityMultiplier.value = finiteClamp(settings.intensityMultiplier, 0, 1e6, 1);
  uniforms.sizeMultiplier.value = finiteClamp(settings.sizeMultiplier, 0, 100, 1);
  uniforms.blendAngle.value = finiteClamp(settings.blendAngle, 0, Math.PI / 2, 0.10017);
  uniforms.horizonOffset.value = finiteClamp(settings.horizonOffset, -Math.PI / 2, Math.PI / 2, 0);
  uniforms.showSunDisc.value = settings.showSunDisc;
  uniforms.sunIntensity.value = finiteClamp(settings.sunIntensity, 0, 1e6, 1);
  const direction = uniforms.sunDirection.value.copy(settings.sunDirection);
  const length = direction.length();
  if (!Number.isFinite(length) || length < 1e-8) direction.set(0, 1, 0);
  else direction.multiplyScalar(1 / length);
  const albedo = settings.groundAlbedo;
  const ground = uniforms.groundAlbedo.value;
  if (typeof albedo === "number") {
    const scalar = finiteClamp(albedo, 0, 1, 0.2);
    ground.setRGB(scalar, scalar, scalar, THREE.LinearSRGBColorSpace);
  } else {
    ground.setRGB(finiteClamp(albedo.r, 0, 1, 0.2), finiteClamp(albedo.g, 0, 1, 0.2),
      finiteClamp(albedo.b, 0, 1, 0.2), THREE.LinearSRGBColorSpace);
  }
  const color = settings.sunColor;
  uniforms.sunColor.value.setRGB(
    finiteClamp(color.r, 0, 1e6, 1), finiteClamp(color.g, 0, 1e6, 1),
    finiteClamp(color.b, 0, 1e6, 1), THREE.LinearSRGBColorSpace,
  );
}
