import * as THREE from "three";

const _viewport = new THREE.Vector4();
const _scissor = new THREE.Vector4();
const _color = new THREE.Color();

/** All target/state mutations in this module go through this exception-safe guard. */
export function withRendererState<T>(renderer: THREE.WebGLRenderer, run: () => T): T {
  const target = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mip = renderer.getActiveMipmapLevel();
  renderer.getViewport(_viewport);
  const vx = _viewport.x, vy = _viewport.y, vz = _viewport.z, vw = _viewport.w;
  renderer.getScissor(_scissor);
  const sx = _scissor.x, sy = _scissor.y, sz = _scissor.z, sw = _scissor.w;
  const scissorTest = renderer.getScissorTest();
  renderer.getClearColor(_color);
  const cr = _color.r, cg = _color.g, cb = _color.b;
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  const xr = renderer.xr.enabled;
  const shadowEnabled = renderer.shadowMap.enabled;
  const shadowUpdate = renderer.shadowMap.autoUpdate;
  try {
    renderer.autoClear = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setScissorTest(false);
    return run();
  } finally {
    renderer.setRenderTarget(target, face, mip);
    renderer.setViewport(vx, vy, vz, vw);
    renderer.setScissor(sx, sy, sz, sw);
    renderer.setScissorTest(scissorTest);
    _color.setRGB(cr, cg, cb);
    renderer.setClearColor(_color, alpha);
    renderer.autoClear = autoClear;
    renderer.xr.enabled = xr;
    renderer.shadowMap.enabled = shadowEnabled;
    renderer.shadowMap.autoUpdate = shadowUpdate;
  }
}

export function signalTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGFormat,
    type: THREE.HalfFloatType,
    internalFormat: "RG16F",
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace,
  });
}

export function checkTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
  withRendererState(renderer, () => {
    renderer.setRenderTarget(target);
    const gl = renderer.getContext();
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`AO framebuffer incomplete (${target.texture.internalFormat ?? "RGBA8"})`);
    }
  });
}

export class FullscreenPass {
  readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    withRendererState(renderer, () => {
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, target.width, target.height);
      renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Half-res texels always refer to the same exact full-res guide pixel, even at odd sizes. */
export const guideGlsl = `
uniform sampler2D depthGuide;
uniform sampler2D normalGuide;
uniform ivec2 fullSize;
uniform ivec2 halfSize;
uniform mat4 projectionInverse;
ivec2 guidePixel(ivec2 p) { return min(p * 2 + ivec2(1), fullSize - 1); }
bool inside(ivec2 p, ivec2 size) { return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, size)); }
vec3 positionAt(ivec2 p) {
  vec2 uv = (vec2(p) + 0.5) / vec2(fullSize);
  float d = texelFetch(depthGuide, p, 0).r;
  vec4 v = projectionInverse * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
vec3 normalAt(ivec2 p) { return normalize(texelFetch(normalGuide, p, 0).xyz * 2.0 - 1.0); }
bool validAt(ivec2 p) { return texelFetch(normalGuide, p, 0).a > 0.5 && texelFetch(depthGuide, p, 0).r < 1.0; }
`;

export function guideUniforms() {
  return {
    depthGuide: { value: null as THREE.Texture | null },
    normalGuide: { value: null as THREE.Texture | null },
    fullSize: { value: new THREE.Vector2() },
    halfSize: { value: new THREE.Vector2() },
    projectionInverse: { value: new THREE.Matrix4() },
  };
}
