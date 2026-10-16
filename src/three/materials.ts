import { useMemo } from "react";
import * as THREE from "three";
import type { Material } from "../model/schema";
import { useOdaja } from "../store";

const FALLBACK: Material = { color: "#c8c8c8", roughness: 0.8, metalness: 0, opacity: 1 };

function makeMaterial(m: Material) {
  return new THREE.MeshStandardMaterial({
    color: m.color,
    roughness: m.roughness,
    metalness: m.metalness,
    transparent: m.opacity < 1,
    opacity: m.opacity,
    depthWrite: m.opacity >= 1,
  });
}

// Returns a lookup from a material name (or an explicit #rrggbb colour) to a
// shared three.js material, rebuilt when the project's materials change.
export function useMaterials() {
  const materials = useOdaja((s) => s.project?.materials);
  return useMemo(() => {
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    return (name?: string, color?: string) => {
      const key = color ?? name ?? "";
      let material = cache.get(key);
      if (!material) {
        const base = (name && materials?.[name]) || FALLBACK;
        material = makeMaterial(color ? { ...base, color } : base);
        cache.set(key, material);
      }
      return material;
    };
  }, [materials]);
}
