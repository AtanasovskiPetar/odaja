import * as THREE from "three";

const srgbTextures = new WeakMap<THREE.Texture, THREE.Texture>();
const linearTextures = new WeakMap<THREE.Texture, THREE.Texture>();

function textureSpace(texture: THREE.Texture | null, colorSpace: THREE.ColorSpace): THREE.Texture | null {
  if (!texture || texture.colorSpace === colorSpace) return texture;
  const cache = colorSpace === THREE.SRGBColorSpace ? srgbTextures : linearTextures;
  let converted = cache.get(texture);
  if (!converted) {
    // One source can be used for both colour and data. Do not change the
    // source in place and accidentally reinterpret another material's map.
    converted = texture.clone();
    converted.colorSpace = colorSpace;
    converted.needsUpdate = true;
    cache.set(texture, converted);
  }
  return converted;
}

function upgradeMaterial(material: THREE.Material): THREE.Material {
  // Keep plain MeshStandardMaterial as Standard rather than promoting it to
  // MeshPhysicalMaterial without physical lobes: Standard and Physical produce
  // identical PBR output with default lobes, while Standard compiles and shades
  // significantly faster.
  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhongMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshBasicMaterial
  ) {
    material.map = textureSpace(material.map, THREE.SRGBColorSpace);
    if ("emissiveMap" in material) material.emissiveMap = textureSpace(material.emissiveMap, THREE.SRGBColorSpace);
    if ("normalMap" in material) material.normalMap = textureSpace(material.normalMap, THREE.NoColorSpace);
    if ("roughnessMap" in material) material.roughnessMap = textureSpace(material.roughnessMap, THREE.NoColorSpace);
    if ("metalnessMap" in material) material.metalnessMap = textureSpace(material.metalnessMap, THREE.NoColorSpace);
    if ("envMapIntensity" in material) material.envMapIntensity = 1;
  }
  return material;
}

// Run at model mount, not in useFrame. Replacement materials are shared by
// source identity; repeated calls preserve identity and authored alpha/skinning.
export function upgradeModelMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) {
      const upgraded = object.material.map(upgradeMaterial);
      if (upgraded.some((material, i) => material !== object.material[i])) object.material = upgraded;
    } else {
      object.material = upgradeMaterial(object.material);
    }
  });
}
