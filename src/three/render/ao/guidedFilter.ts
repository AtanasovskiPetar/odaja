import { FullscreenPass, guideGlsl, guideUniforms } from "./common";

/** One reusable pass; pipeline invokes with strides 1 and 2 and separate destinations. */
export class GuidedFilter extends FullscreenPass {
  constructor() {
    super(`
precision highp float;
precision highp int;
${guideGlsl}
uniform sampler2D signalTexture;
uniform sampler2D initialSignal;
uniform int stride;
uniform float strength;
uniform float radiusPx;
out vec4 result;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), gp = guidePixel(p);
  vec2 center = texelFetch(signalTexture, p, 0).rg;
  if (!validAt(gp)) { result = vec4(1,0,0,1); return; }
  vec3 P = positionAt(gp), N = normalAt(gp);
  float sumW = 0.0, sumV = 0.0, sumVariance = 0.0;
  for (int y = -1; y <= 1; ++y) for (int x = -1; x <= 1; ++x) {
    ivec2 offset = ivec2(x,y) * stride;
    ivec2 q = p + offset;
    if (!inside(q, halfSize)) continue;
    ivec2 gq = guidePixel(q);
    if (!validAt(gq)) continue;
    vec3 Q = positionAt(gq), M = normalAt(gq), delta = Q-P;
    float h = max(0.005, 0.01 * max(0.0, -P.z));
    float e = max(abs(dot(N,delta)), abs(dot(M,delta)));
    float plane = pow(max(0.0, 1.0 - (e/h)*(e/h)), 2.0);
    float normal = smoothstep(0.75, 0.95, dot(N,M));
    vec2 s = texelFetch(signalTexture, q, 0).rg;
    float sigma = max(0.0001, strength * sqrt(max(0.0, center.g + s.g)));
    float D = (center.r-s.r) / sigma;
    float kernel = float((x == 0 ? 2 : 1) * (y == 0 ? 2 : 1)) / 16.0;
    float distancePx = length(vec2(guidePixel(q) - gp));
    float wRadius = 1.0 / (1.0 + pow(distancePx / max(1.0, radiusPx), 2.0));
    float w = kernel * wRadius * plane * normal / (1.0 + D*D);
    sumW += w;
    sumV += w*s.r;
    sumVariance += w*w*s.g;
  }
  float initialVariance = texelFetch(initialSignal, p, 0).g;
  if (sumW <= 0.0) { result = vec4(center,0,1); return; }
  result = vec4(clamp(sumV/sumW,0.0,1.0), max(0.25*initialVariance, sumVariance/(sumW*sumW)), 0,1);
}`, {
      ...guideUniforms(),
      signalTexture: { value: null },
      initialSignal: { value: null },
      stride: { value: 1 },
      strength: { value: 1 },
      radiusPx: { value: 8 },
    });
  }
}
