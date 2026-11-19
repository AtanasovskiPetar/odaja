import * as THREE from "three";

// Linear visibility 1 is neutral, including unsupported/disabled pipelines.
const whiteTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
whiteTexture.colorSpace = THREE.NoColorSpace;
whiteTexture.needsUpdate = true;

export function createAoUniforms() {
  return {
    tAo: { value: whiteTexture as THREE.Texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };
}

export type AoUniforms = ReturnType<typeof createAoUniforms>;

// Materials are cached by the editor and can outlive the Canvas/effect.
const patches = new WeakMap<THREE.Material, { uniforms: AoUniforms }>();

export function applyAoToMaterial(material: THREE.Material, uniforms: AoUniforms): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.transparent ||
      ("transmission" in material && Number(material.transmission) > 0) ||
      !material.colorWrite || material.userData.noAo) return;
  const existing = patches.get(material);
  if (existing) {
    // Keep compiled uniform objects alive when an effect is remounted.
    existing.uniforms = uniforms;
    return;
  }
  const patch = { uniforms };
  patches.set(material, patch);
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.tAo = { get value() { return patch.uniforms.tAo.value; } };
    shader.uniforms.uResolution = { get value() { return patch.uniforms.uResolution.value; } };
    shader.fragmentShader = "uniform sampler2D tAo;\nuniform vec2 uResolution;\n" + shader.fragmentShader;
    // RectAreaLight (window sky fill) has no shadow map; gating it with Guided
    // AO keeps window fill from leaking under furniture in any room layout.
    const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(
      "rectAreaLight = rectAreaLights[ i ];",
      "rectAreaLight = rectAreaLights[ i ];\nrectAreaLight.color *= aoVisibility;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_begin>",
      "float aoVisibility = texture2D(tAo, gl_FragCoord.xy / uResolution).r;\n" +
      lightsBegin + "\n" +
      "irradiance *= aoVisibility;\n" +
      // r186 splits ambient from image-based diffuse; AO must gate both or the
      // dominant sky term stays unoccluded and corners look flat.
      "iblIrradiance *= aoVisibility;",
    );
  };
  const nextKey = `${previousKey}|odaja-guided-ao-v2`;
  material.customProgramCacheKey = () => nextKey;
  material.needsUpdate = true;
}

export function updateAoUniforms(
  uniforms: AoUniforms, texture: THREE.Texture | null, width: number, height: number,
): void {
  uniforms.tAo.value = texture ?? whiteTexture;
  uniforms.uResolution.value.set(Math.max(1, width), Math.max(1, height));
}
