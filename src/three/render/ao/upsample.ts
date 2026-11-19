import { FullscreenPass, guideGlsl, guideUniforms } from "./common";

export class UpsamplePass extends FullscreenPass {
  constructor() {
    super(`
precision highp float;
precision highp int;
${guideGlsl}
uniform sampler2D signalTexture;
out vec4 result;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!validAt(p)) { result = vec4(1,0,0,1); return; }
  vec3 P = positionAt(p), N = normalAt(p);
  // Half guides are at full pixel 2*q+1; do not stretch odd-sized images.
  vec2 coord = (vec2(p)-1.0)*0.5;
  ivec2 base = ivec2(floor(coord));
  float sumW = 0.0, sumV = 0.0, sumVariance = 0.0;
  for (int y=0; y<2; ++y) for (int x=0; x<2; ++x) {
    ivec2 q = base + ivec2(x,y);
    if (!inside(q,halfSize)) continue;
    ivec2 gq = guidePixel(q);
    if (!validAt(gq)) continue;
    vec3 Q = positionAt(gq), M = normalAt(gq);
    float h = max(0.005, 0.01 * max(0.0,-P.z));
    float dz = abs(P.z-Q.z);
    float e = max(abs(dot(N,Q-P)),abs(dot(M,Q-P)));
    if (dz >= h || e >= h || dot(N,M) <= 0.75) continue;
    vec2 d = abs(vec2(p-gq))*0.5;
    float spatial = max(0.0,1.0-d.x)*max(0.0,1.0-d.y);
    float w = spatial * pow(1.0-dz/h,2.0) * smoothstep(0.75,0.95,dot(N,M));
    vec2 s = texelFetch(signalTexture,q,0).rg;
    sumW += w; sumV += w*s.r; sumVariance += w*w*s.g;
  }
  // No compatible half-res sample: neutral visibility, never borrow another surface.
  result = sumW > 0.0 ? vec4(clamp(sumV/sumW,0.0,1.0),sumVariance/(sumW*sumW),0,1) : vec4(1,0,0,1);
}`, { ...guideUniforms(), signalTexture: { value: null } });
  }
}
