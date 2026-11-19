import { useMemo } from "react";
import * as THREE from "three";
import type { Material } from "../model/schema";
import { useOdaja } from "../store";
import { tileTexture } from "./textures";
import { proceduralMaps, type DetailKind } from "./render/proceduralMaps";
import { FALLOFF_GLSL } from "./render/falloff";

const FALLBACK: Material = { color: "#c8c8c8", roughness: 0.8, metalness: 0, opacity: 1 };
const WHITE = new THREE.Color("#ffffff");

// Runtime escape hatch for Three.js's full-scene transmission pass. Off by
// default: transmission renders all opaque meshes a second time into a linear
// render target, which also flips outputColorSpace/toneMapping and forces
// Three's initMaterial cache check twice per mesh per frame. Glass uses
// alpha-blended physical clearcoat/IOR reflections instead.
export const materialRendering = { transmission: false };

const EMPTY_MATERIALS: Record<string, Material> = {};
const sharedCaches = new WeakMap<Record<string, Material>, Map<string, THREE.MeshStandardMaterial>>();

function materialCacheFor(materials: Record<string, Material> | undefined): Map<string, THREE.MeshStandardMaterial> {
  const key = materials ?? EMPTY_MATERIALS;
  let cache = sharedCaches.get(key);
  if (!cache) {
    cache = new Map();
    sharedCaches.set(key, cache);
  }
  return cache;
}

function makeMaterial(m: Material, name: string | undefined, transmission: boolean, plan: boolean): THREE.MeshStandardMaterial {
  // Tiles carry their colour in the texture (patterned) or the photo.
  const map = tileTexture(m);
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const fabric = /(?:^|[^a-z])(fabric|curtains?|rugs?|textile|linen|velvet|upholstery|wool|lampshades?|shades?)(?:$|[^a-z])/i.test(name ?? "");
  const velvet = /(?:^|[^a-z])velvet(?:$|[^a-z])/i.test(name ?? "");
  const wood = /(?:^|[^a-z])(oak|walnut|wood)(?:$|[^a-z])/i.test(name ?? "");
  const clean = m.opacity < 1 || m.metalness >= 0.1 || /(?:^|[^a-z])(metal|steel|aluminium|aluminum|brass|chrome|glass|ceramic|porcelain)(?:$|[^a-z])/i.test(name ?? "");
  const kind: DetailKind | null = plan || clean ? null : fabric ? "fabric" : wood ? "wood" : m.roughness > 0.8 ? "plaster" : null;
  const detail = kind ? proceduralMaps(kind) : null;
  const strength = kind === "fabric" ? 0.24 : kind === "wood" ? 0.16 : 0.05;
  const coated = !plan && !fabric && m.opacity === 1 && m.metalness < 0.2 && m.roughness < 0.35;
  const isGlass = !plan && m.opacity > 0 && m.opacity < 0.5 && m.roughness < 0.2 && m.metalness < 0.2;
  const transmissiveGlass = transmission && isGlass;
  const sheen = !plan && fabric && m.metalness < 0.2 ? (velvet ? 0.65 : 0.35) : 0;
  const needsPhysical = isGlass || coated || sheen > 0;

  const common: THREE.MeshStandardMaterialParameters = {
    color: map ? "#ffffff" : transmissiveGlass ? "#ffffff" : m.color,
    map,
    roughness: m.roughness,
    roughnessMap: detail?.roughnessMap ?? null,
    normalMap: detail?.normalMap ?? null,
    normalScale: new THREE.Vector2(strength, strength),
    metalness: m.metalness,
    // Transmissive glass uses Three's transmission pass with full opacity so
    // Fresnel specular reflections are not crushed by alpha blending.
    transparent: transmissiveGlass ? false : m.opacity < 1,
    opacity: transmissiveGlass ? 1 : m.opacity,
    depthWrite: transmissiveGlass ? true : m.opacity >= 1,
    dithering: true,
  };

  // Only pay for MeshPhysicalMaterial's heavier shader when a physical-only
  // lobe (glass, clearcoat, or fabric sheen) is actually active.
  const material: THREE.MeshStandardMaterial = needsPhysical
    ? new THREE.MeshPhysicalMaterial({
        ...common,
        clearcoat: isGlass && !transmissiveGlass ? 1 : coated ? 0.25 + 0.15 * (1 - m.roughness / 0.35) : 0,
        clearcoatRoughness: isGlass && !transmissiveGlass ? Math.min(0.08, m.roughness) : m.roughness * 0.5,
        transmission: transmissiveGlass ? Math.max(0.82, 1 - m.opacity) : 0,
        thickness: transmissiveGlass ? 0.015 : 0,
        attenuationColor: transmissiveGlass ? new THREE.Color(m.color) : WHITE,
        attenuationDistance: transmissiveGlass ? 0.5 : Infinity,
        ior: 1.5,
        reflectivity: isGlass ? 1 : 0.5,
        envMapIntensity: isGlass && !transmissiveGlass ? 1.4 : 1,
        // Anisotropy needs UVs or tangents; not all parametric parts have them.
        // Leave it off rather than introduce undefined tangent frames.
        sheen,
        sheenColor: new THREE.Color(m.color).lerp(WHITE, 0.35),
        sheenRoughness: velvet ? 0.5 : 0.72,
      })
    : new THREE.MeshStandardMaterial(common);

  const fabricSheen = sheen > 0;
  const glassEdge = isGlass && !transmissiveGlass;
  if (detail || fabricSheen || glassEdge) {
    const cacheKey = [
      detail ? "rough-centered" : "",
      fabricSheen ? "fabric-falloff" : "",
      glassEdge ? "glass-falloff" : "",
    ].filter(Boolean).join("|") + "-v1";
    material.onBeforeCompile = (shader) => {
      let fs = shader.fragmentShader;
      if (fabricSheen || glassEdge) {
        fs = `${FALLOFF_GLSL}\n${fs}`;
      }
      if (detail) {
        // Three normally multiplies roughness by the map. Recenter our 0.5 ±
        // 0.06 data at 1 so a rough plaster does not become half as rough.
        fs = fs.replace(
          "roughnessFactor *= texelRoughness.g;",
          "roughnessFactor *= (texelRoughness.g + 0.5);",
        );
      }
      if (glassEdge) {
        fs = fs.replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          float glassFresnel = falloffFresnel(normalize(vViewPosition), normal, 1.5);
          diffuseColor.a = mix(diffuseColor.a * 0.85, min(1.0, diffuseColor.a + 0.18), glassFresnel);`,
        );
      }
      if (fabricSheen) {
        fs = fs.replace(
          "#include <lights_physical_fragment>",
          `#include <lights_physical_fragment>
          #ifdef USE_SHEEN
            float fabricFresnel = falloffFresnel(normalize(vViewPosition), normal, 1.4);
            material.sheenColor *= mix(1.0, 0.75 + 0.25 * fabricFresnel, 0.5);
          #endif`,
        );
      }
      shader.fragmentShader = fs;
    };
    material.customProgramCacheKey = () => cacheKey;
  }
  return material;
}

// Returns a lookup from a material name (or an explicit #rrggbb colour) to a
// shared three.js material, rebuilt when the project's materials change.
export function useMaterials() {
  const materials = useOdaja((s) => s.project?.materials);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const transmission = materialRendering.transmission && !plan;
  return useMemo(() => {
    const cache = materialCacheFor(materials);
    const suffix = `\0${transmission ? 1 : 0}\0${plan ? 1 : 0}`;
    return (name?: string, color?: string) => {
      // An explicit colour also works as the material name: "#aabbcc".
      if (!color && name?.startsWith("#") && /^#[0-9a-fA-F]{6}$/.test(name)) color = name;
      // Colour overrides must not alias materials with different roughness,
      // opacity, texture or name-derived fabric lobes.
      const key = `${name ?? ""}\0${color ?? ""}${suffix}`;
      let material = cache.get(key);
      if (!material) {
        const base = (name && materials?.[name]) || FALLBACK;
        material = makeMaterial(color ? { ...base, color } : base, name, transmission, plan);
        cache.set(key, material);
      }
      return material;
    };
  }, [materials, transmission, plan]);
}
