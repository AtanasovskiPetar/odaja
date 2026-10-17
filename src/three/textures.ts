// Real-scale textures for tile materials. Patterned tiles are drawn on a
// canvas (tile colour, grout lines, optional colour variation); photo tiles
// load the image. Textures repeat every pattern unit, and surfaces give them
// UVs in metres, so a 60 cm tile is 60 cm everywhere.
import * as THREE from "three";
import type { Material, Tile } from "../model/schema";
import { platform } from "../platform";

const PX_PER_CM = 4;
const MAX_CANVAS = 1536;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// One repeating unit of the pattern (cm) and the tiles in it. Tiles may poke
// out of the unit; they're drawn wrapped so the texture repeats seamlessly.
export function patternUnit(tile: Tile): { width: number; height: number; tiles: Rect[]; rotate45?: boolean } {
  const [w, h] = tile.size;
  switch (tile.pattern) {
    case "brick":
      return { width: w, height: 2 * h, tiles: [{ x: 0, y: 0, w, h }, { x: w / 2, y: h, w, h }] };
    case "third":
      return { width: w, height: 3 * h, tiles: [0, 1, 2].map((i) => ({ x: (i * w) / 3, y: i * h, w, h })) };
    case "vertical":
      return { width: h, height: w, tiles: [{ x: 0, y: 0, w: h, h: w }] };
    case "herringbone": {
      // Planks L x W with L = n·W. The pattern repeats every 2L both ways:
      // staircases of (horizontal, vertical) plank pairs stepping by (W, W),
      // one staircase every (L, -L).
      const W = Math.min(w, h);
      const n = Math.max(1, Math.round(Math.max(w, h) / W));
      const L = n * W;
      const tiles: Rect[] = [];
      for (let j = -4; j <= 4; j++) {
        for (let k = -2 * n - 4; k <= 2 * n + 4; k++) {
          const x = k * W + j * L;
          const y = k * W - j * L;
          tiles.push({ x, y, w: L, h: W }, { x: x + L, y: y + W - L, w: W, h: L });
        }
      }
      return { width: 2 * L, height: 2 * L, tiles: tiles.filter((t) => t.x < 2 * L && t.x + t.w > 0 && t.y < 2 * L && t.y + t.h > 0) };
    }
    case "diagonal": {
      // Square tiles turned 45°: the unit is one tile's diagonal both ways.
      const d = w * Math.SQRT2;
      return { width: d, height: d, tiles: [{ x: 0, y: 0, w, h: w }], rotate45: true };
    }
    default:
      return { width: w, height: h, tiles: [{ x: 0, y: 0, w, h }] };
  }
}

// Deterministic per-tile shade so variation doesn't flicker between renders.
function shade(base: THREE.Color, amount: number, seed: number): string {
  const r = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  const t = (r - Math.floor(r) - 0.5) * 2 * amount * 0.18;
  const c = base.clone();
  c.offsetHSL(0, 0, t);
  return `#${c.getHexString()}`;
}

function drawPattern(tile: Tile, color: string): { canvas: HTMLCanvasElement; width: number; height: number } {
  const unit = patternUnit(tile);
  const scale = Math.min(PX_PER_CM, MAX_CANVAS / Math.max(unit.width, unit.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(4, Math.round(unit.width * scale));
  canvas.height = Math.max(4, Math.round(unit.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = tile.groutColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const base = new THREE.Color(color);
  const g = (tile.grout * scale) / 2;
  ctx.save();
  ctx.scale(canvas.width / unit.width, canvas.height / unit.height);
  if (unit.rotate45) {
    // Draw a grid of square tiles rotated 45° around the unit's centre.
    const d = unit.width;
    ctx.translate(d / 2, d / 2);
    ctx.rotate(Math.PI / 4);
    const s = tile.size[0];
    let i = 0;
    for (let x = -2; x <= 1; x++) {
      for (let y = -2; y <= 1; y++) {
        ctx.fillStyle = shade(base, tile.variation, i++);
        ctx.fillRect(x * s + g / scale, y * s + g / scale, s - (2 * g) / scale, s - (2 * g) / scale);
      }
    }
  } else {
    let i = 0;
    for (const t of unit.tiles) {
      ctx.fillStyle = shade(base, tile.variation, i++);
      for (const dx of [-unit.width, 0, unit.width]) {
        for (const dy of [-unit.height, 0, unit.height]) {
          ctx.fillRect(t.x + dx + g / scale, t.y + dy + g / scale, t.w - (2 * g) / scale, t.h - (2 * g) / scale);
        }
      }
    }
  }
  ctx.restore();
  return { canvas, width: unit.width, height: unit.height };
}

const cache = new Map<string, THREE.Texture>();

// A repeating texture for a tile material, scaled for UVs in metres.
export function tileTexture(material: Material): THREE.Texture | null {
  const tile = material.tile;
  if (!tile) return null;
  const key = JSON.stringify([tile, material.color]);
  const cached = cache.get(key);
  if (cached) return cached;
  let texture: THREE.Texture;
  let unit: [number, number];
  if (tile.image) {
    texture = new THREE.TextureLoader().load(platform.fileUrl(tile.image));
    unit = tile.size;
  } else {
    const drawn = drawPattern(tile, material.color);
    texture = new THREE.CanvasTexture(drawn.canvas);
    unit = [drawn.width, drawn.height];
  }
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(100 / unit[0], 100 / unit[1]);
  cache.set(key, texture);
  return texture;
}

// A small preview of a material for the editor (data URL).
export function materialSwatch(material: Material, sizeCm = 120): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = material.color;
  ctx.fillRect(0, 0, 96, 96);
  if (material.tile && !material.tile.image) {
    const { canvas: unit, width, height } = drawPattern(material.tile, material.color);
    const k = 96 / sizeCm;
    const pattern = ctx.createPattern(unit, "repeat")!;
    pattern.setTransform(new DOMMatrix().scale((width * k) / unit.width, (height * k) / unit.height));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, 96, 96);
  }
  return canvas.toDataURL();
}
