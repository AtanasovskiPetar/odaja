export const FALLOFF_GLSL = /* glsl */ `
  float falloffTowardAway(vec3 dir, vec3 n) {
    return 0.5 - 0.5 * dot(dir, n);
  }

  float falloffPerpParallel(vec3 dir, vec3 n) {
    return 1.0 - abs(dot(dir, n));
  }

  float falloffFresnel(vec3 dir, vec3 n, float ior) {
    float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
    float cosTheta = clamp(dot(dir, n), 0.0, 1.0);
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
  }

  float falloffDistance(float dist, float nearD, float farD) {
    return clamp((dist - farD) / max(nearD - farD, 1e-4), 0.0, 1.0);
  }

  // startDeg < stopDeg: 1 inside start, 0 outside stop.
  float falloffAngular(vec3 dir, vec3 axis, float startDeg, float stopDeg) {
    float c = dot(normalize(dir), normalize(axis));
    return smoothstep(cos(radians(stopDeg)), cos(radians(startDeg)), c);
  }
`;
