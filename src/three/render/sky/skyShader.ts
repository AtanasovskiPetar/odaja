export const skyVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    // Background depth: no far-plane clipping and always behind scene geometry.
    vec4 clip = projectionMatrix * viewMatrix * worldPosition;
    gl_Position = clip.xyww;
  }
`;

export const skyFragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPosition;
  uniform vec3 betaRayleigh;
  uniform vec3 betaMie;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 groundAlbedo;
  uniform float sunIntensity;
  uniform float intensityMultiplier;
  uniform float sizeMultiplier;
  uniform float blendAngle;
  uniform float horizonOffset;
  uniform bool showSunDisc;
  // Reserved for actual CIE/Hosek implementations; model 0 does not use these.
  uniform float ozone;
  uniform float waterVapour;
  uniform int skyModel;

  const float PI = 3.141592653589793;

  vec3 safeDirection(vec3 value) {
    float magnitude = length(value);
    return magnitude > 1.0e-8 ? value / magnitude : vec3(0.0, 1.0, 0.0);
  }

  // Kasten-Young relative optical air mass, evaluated only at zenith <= 90 deg.
  float airMass(float elevationCosine) {
    float mu = clamp(elevationCosine, 0.0, 1.0);
    float zenithDegrees = acos(mu) * (180.0 / PI);
    return 1.0 / max(mu + 0.50572 * pow(max(96.07995 - zenithDegrees, 0.001), -1.6364), 0.001);
  }

  void main() {
    vec3 vWorldDirection = safeDirection(vWorldPosition - cameraPosition);
    vec3 sun = safeDirection(sunDirection);
    float cosTheta = clamp(dot(vWorldDirection, sun), -1.0, 1.0);
    float viewMass = airMass(vWorldDirection.y);
    float sunMass = airMass(sun.y);
    vec3 verticalDepth = betaRayleigh * 8400.0 + betaMie * 1200.0;
    vec3 viewDepth = verticalDepth * viewMass;
    vec3 sunTransmission = exp(-min(verticalDepth * sunMass, vec3(80.0)));
    vec3 viewTransmission = exp(-min(viewDepth, vec3(80.0)));
    float rayleighPhase = 3.0 * (1.0 + cosTheta * cosTheta) / (16.0 * PI);
    // Henyey-Greenstein aerosol phase; g is intentionally fixed, not a TexSky control.
    float g = 0.76;
    float miePhase = (1.0 - g * g) / (4.0 * PI
      * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 0.001), 1.5));
    vec3 phaseDepth = betaRayleigh * 8400.0 * rayleighPhase
      + betaMie * 1200.0 * miePhase;
    vec3 scattering = phaseDepth / max(verticalDepth, vec3(1.0e-6))
      * (vec3(1.0) - viewTransmission) * sunTransmission;
    // Smooth terminator approximation, not an automatic night-sky/exposure switch.
    float solarVisibility = smoothstep(-0.08, 0.02, sun.y);
    vec3 skyColor = 20.0 * scattering * solarVisibility;

    if (showSunDisc && sizeMultiplier > 0.0) {
      float radius = (0.54 * PI / 180.0) * 0.5 * sizeMultiplier;
      float angle = acos(cosTheta);
      float edge = max(radius * 0.025, 0.00001);
      float disc = 1.0 - smoothstep(max(radius - edge, 0.0), radius + edge, angle);
      float r = clamp(angle / max(radius, 0.00001), 0.0, 1.0);
      float limb = 0.4 + 0.6 * sqrt(max(1.0 - r * r, 0.0));
      skyColor += 20000.0 * disc * limb * sunTransmission * solarVisibility;
    }
    float h = vWorldDirection.y - sin(horizonOffset);
    // Epsilon gives a well-defined limiting transition for blendAngle == 0.
    float width = max(sin(blendAngle), 0.00001);
    float b = smoothstep(-width, width, h);
    vec3 color = mix(groundAlbedo, skyColor, b);
    color *= sunColor * sunIntensity * intensityMultiplier;
    // Linear HDR only: the destination renderer/PMREM owns display transforms.
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  }
`;
