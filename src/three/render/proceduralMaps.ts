import * as THREE from "three";

export type DetailKind = "value" | "plaster" | "fabric" | "wood";
interface DetailMaps {
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

// Finite options bound this permanent cache to 32 pairs. Strength belongs on
// material.normalScale, not on the shared textures.
const cache = new Map<string, DetailMaps>();
let maxAnisotropy = 1;
const repeats: Record<DetailKind, [number, number]> = {
  value: [4, 4], plaster: [2, 2], fabric: [6, 6], wood: [4, 4],
};

// Apply renderer anisotropy once at startup instead of checking on every draw call.
export function setProceduralAnisotropy(anisotropy: number): void {
  const next = Math.max(1, anisotropy);
  if (next === maxAnisotropy) return;
  maxAnisotropy = next;
  for (const maps of cache.values()) {
    for (const texture of [maps.roughnessMap, maps.normalMap]) {
      if (texture.anisotropy !== next) {
        texture.anisotropy = next;
        texture.needsUpdate = true;
      }
    }
  }
}

function lattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Periodic lattice coordinates and smooth interpolation make both the height
// and its derivatives continuous over the repeating unit.
function noise(x: number, y: number, cellsX: number, cellsY: number, seed: number): number {
  const px = x * cellsX;
  const py = y * cellsY;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const u = smooth(px - ix);
  const v = smooth(py - iy);
  const a = lattice(ix % cellsX, iy % cellsY, seed);
  const b = lattice((ix + 1) % cellsX, iy % cellsY, seed);
  const c = lattice(ix % cellsX, (iy + 1) % cellsY, seed);
  const d = lattice((ix + 1) % cellsX, (iy + 1) % cellsY, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

function canvasMap(size: number, pixels: Uint8ClampedArray, kind: DetailKind): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.repeat.set(...repeats[kind]);
  return texture;
}

export function proceduralMaps(kind: DetailKind, size: 64 | 128 = 128, seed: 0 | 1 | 2 | 3 = 0): DetailMaps {
  const key = `${kind}:${size}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const fine = kind === "value" ? 8 : 32;
      const base = noise(u, v, fine, kind === "wood" ? 4 : fine, seed);
      const grain = noise(u, v, 64, 64, seed + 11);
      const weave = kind === "fabric" ? 0.08 * Math.cos(u * Math.PI * 64) * Math.cos(v * Math.PI * 64) : 0;
      heights[y * size + x] = 0.75 * base + 0.25 * grain + weave;
    }
  }
  const roughness = new Uint8ClampedArray(size * size * 4);
  const normals = new Uint8ClampedArray(size * size * 4);
  const height = (x: number, y: number) => heights[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const value = Math.round(255 * (0.5 + 0.06 * THREE.MathUtils.clamp((height(x, y) - 0.5) * 2, -1, 1)));
      roughness.set([value, value, value, 255], i);
      // Wrapped central differences from exactly the same height field.
      const nx = (height(x - 1, y) - height(x + 1, y)) * 2;
      const ny = (height(x, y - 1) - height(x, y + 1)) * 2;
      const length = Math.hypot(nx, ny, 1);
      normals.set([Math.round(127.5 * (nx / length + 1)), Math.round(127.5 * (ny / length + 1)), Math.round(127.5 * (1 / length + 1)), 255], i);
    }
  }
  const maps = { roughnessMap: canvasMap(size, roughness, kind), normalMap: canvasMap(size, normals, kind) };
  cache.set(key, maps);
  return maps;
}
