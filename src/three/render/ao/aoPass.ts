import * as THREE from "three";
import { FullscreenPass, guideGlsl, guideUniforms } from "./common";
import type { AoSettings } from "./types";

export class AoPass extends FullscreenPass {
  constructor() {
    super(`
precision highp float;
precision highp int;
${guideGlsl}
uniform mat4 projection;
uniform float radiusPx;
uniform float threshold;
uniform bool autoRadius;
uniform bool perspective;
uniform int rays;
out vec4 result;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  ivec2 p = guidePixel(ivec2(gl_FragCoord.xy));
  if (!validAt(p)) { result = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 P = positionAt(p), N = normalAt(p);
  float z = max(0.001, -P.z);
  float px = radiusPx / ((autoRadius && perspective) ? max(z, 0.1) : 1.0);
  float radius = 2.0 * px / (float(fullSize.y) * abs(projection[1][1]));
  if (perspective) radius *= z;
  vec3 T = normalize(cross(abs(N.z) < 0.9 ? vec3(0,0,1) : vec3(0,1,0), N));
  vec3 B = cross(N, T);
  float rotation = hash(vec2(p)) * 6.28318530718;
  float k = 0.0;
  for (int i = 0; i < 8; ++i) {
    if (i >= rays) break;
    float u = (float(i) + 0.5) / float(rays);
    float phi = rotation + float(i) * 2.39996323;
    vec3 direction = T * (sqrt(u) * cos(phi)) + B * (sqrt(u) * sin(phi)) + N * sqrt(1.0-u);
    bool hit = false;
    for (int step = 1; step <= 6; ++step) {
      vec3 Q = P + N * threshold + direction * radius * (float(step) / 6.0);
      vec4 clip = projection * vec4(Q, 1.0);
      if (clip.w <= 0.0) continue;
      vec3 ndc = clip.xyz / clip.w;
      if (abs(ndc.z) > 1.0) continue;
      ivec2 q = ivec2(floor((ndc.xy * 0.5 + 0.5) * vec2(fullSize)));
      if (!inside(q, fullSize) || !validAt(q)) continue;
      vec3 S = positionAt(q);
      float behind = S.z - Q.z;
      if (behind > threshold && behind < radius && length(S-P) < radius) { hit = true; break; }
    }
    if (!hit) k += 1.0;
  }
  float n = float(rays), a = k + 0.5, b = n - k + 0.5;
  float variance = a*b / ((a+b)*(a+b)*(a+b+1.0));
  result = vec4(clamp(k/n, 0.0, 1.0), variance, 0.0, 1.0);
}`, {
      ...guideUniforms(),
      projection: { value: new THREE.Matrix4() },
      radiusPx: { value: 8 },
      threshold: { value: 0.015 },
      autoRadius: { value: true },
      perspective: { value: true },
      rays: { value: 8 },
    });
  }

  configure(settings: AoSettings, camera: THREE.Camera): void {
    const u = this.material.uniforms;
    u.projection!.value.copy(camera.projectionMatrix);
    u.perspective!.value = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    for (const key of ["radiusPx", "threshold", "autoRadius", "rays"] as const) u[key]!.value = settings[key];
  }
}
