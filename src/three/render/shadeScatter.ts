export type ShadeScatterOptions = {
  /** Diffusion length of the weave, in metres. */
  scatterRadius: number;
  /** Thin-shell optical depth at normal incidence. */
  opticalDepth: number;
  /** Henyey-Greenstein g, -0.95..0.95. Negative = backward scattering. */
  phase: number;
  /** Radius of the bulb/diffuser, in metres. */
  bulbRadius: number;
  frontScatter: boolean;
  backScatter: boolean;
  innerStrength: number;
  outerStrength: number;
};

export const SHADE_SCATTER_DEFAULTS: ShadeScatterOptions = {
  scatterRadius: 0.075,
  opticalDepth: 0.9,
  phase: -0.12,
  bulbRadius: 0.035,
  frontScatter: true,
  backScatter: true,
  innerStrength: 0.55,
  outerStrength: 0.9,
};

export const SHADE_SCATTER_GLSL = /* glsl */ `
  vec3 shadeN = normalize(normal);
  vec3 shadeV = normalize(vViewPosition);
  float shadeNdv = clamp(abs(dot(shadeN, shadeV)), 0.0, 1.0);

  // The bulb is passed in view space so the phase angle stays in one space.
  vec3 fragView = -vViewPosition;
  vec3 toBulbView = vShadeBulbView - fragView;
  float bulbDist = length(toBulbView);
  vec3 toBulbDir = toBulbView / max(bulbDist, 1e-4);

  // Soft area emitter: a point bulb prints a hard disc on the weave.
  float softDist = max(bulbDist - shadeBulbRadius, 0.0);
  float irradiance = 1.0 / (1.0 + (softDist * softDist) / max(shadeScatterRadius * shadeScatterRadius, 1e-6));

  // Henyey-Greenstein, normalised so g = 0 gives 1.0.
  float cosTheta = clamp(dot(-toBulbDir, shadeV), -1.0, 1.0);
  float g = clamp(shadePhase, -0.95, 0.95);
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosTheta, 1e-4), 1.5);

  // Thin shell: longer path and more scattering volume at grazing angles.
  float opticalDepth = shadeOpticalDepth / max(shadeNdv, 0.25);
  float transmit = exp(-opticalDepth);
  float scatterVolume = 1.0 - transmit;

  float edge = falloffPerpParallel(shadeV, shadeN);
  float inner = shadeBack * irradiance * (0.35 + 0.65 * hg);
  float outer = shadeFront * irradiance * (0.35 * transmit + 0.65 * scatterVolume) * (0.35 + 0.65 * hg) * mix(0.45, 1.0, edge);

  if (gl_FrontFacing) {
    totalEmissiveRadiance += shadeAlbedo * outer * shadeOuterStrength;
  } else {
    totalEmissiveRadiance += shadeAlbedo * inner * shadeInnerStrength;
  }
`;
