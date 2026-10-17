// Photos shared in a chat, and edits made to them by the AI before anything
// is kept. Photos stay in the conversation; edits live in memory until
// save_texture writes a finished texture into the project (or library).
import { Jimp } from "jimp";

export interface Raster {
  width: number;
  height: number;
  data: Buffer; // RGBA
}

// Edits made this session, by id ("edit-3"). Small, short-lived; not saved.
const edits = new Map<string, Raster>();
let editCounter = 0;

export async function decode(base64OrBuffer: string | Buffer): Promise<Raster> {
  const buffer = typeof base64OrBuffer === "string" ? Buffer.from(base64OrBuffer, "base64") : base64OrBuffer;
  const image = await Jimp.fromBuffer(buffer);
  return { width: image.bitmap.width, height: image.bitmap.height, data: Buffer.from(image.bitmap.data) };
}

export async function encodeJpeg(r: Raster, quality = 88): Promise<Buffer> {
  const image = new Jimp({ width: r.width, height: r.height });
  r.data.copy(image.bitmap.data as Buffer);
  return image.getBuffer("image/jpeg", { quality });
}

export function storeEdit(r: Raster): string {
  const id = `edit-${++editCounter}`;
  edits.set(id, r);
  // Keep memory bounded: forget the oldest edits.
  if (edits.size > 40) edits.delete(edits.keys().next().value!);
  return id;
}

export function getEdit(id: string): Raster | undefined {
  return edits.get(id);
}

// --- pixel operations -----------------------------------------------------

function sample(r: Raster, x: number, y: number, out: number[]) {
  // Bilinear sample with clamping.
  const x0 = Math.max(0, Math.min(r.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(r.height - 1, Math.floor(y)));
  const x1 = Math.min(r.width - 1, x0 + 1);
  const y1 = Math.min(r.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  for (let c = 0; c < 4; c++) {
    const a = r.data[(y0 * r.width + x0) * 4 + c];
    const b = r.data[(y0 * r.width + x1) * 4 + c];
    const d = r.data[(y1 * r.width + x0) * 4 + c];
    const e = r.data[(y1 * r.width + x1) * 4 + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}

export function rotate(r: Raster, degrees: 0 | 90 | 180 | 270): Raster {
  if (degrees === 0) return r;
  const swap = degrees !== 180;
  const width = swap ? r.height : r.width;
  const height = swap ? r.width : r.height;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Clockwise rotation: map output pixel back to the source.
      const [sx, sy] = degrees === 90 ? [y, r.height - 1 - x] : degrees === 180 ? [r.width - 1 - x, r.height - 1 - y] : [r.width - 1 - y, x];
      r.data.copy(data, (y * width + x) * 4, (sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4);
    }
  }
  return { width, height, data };
}

export function crop(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const width = Math.max(1, Math.min(r.width - x0, Math.round(w)));
  const height = Math.max(1, Math.min(r.height - y0, Math.round(h)));
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) r.data.copy(data, row * width * 4, ((y0 + row) * r.width + x0) * 4, ((y0 + row) * r.width + x0 + width) * 4);
  return { width, height, data };
}

// Solve the 8 homography parameters mapping the unit square's corners to
// the four given points (top-left, top-right, bottom-right, bottom-left).
function homography(corners: [number, number][], w: number, h: number) {
  const src: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = corners[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination.
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let j = i + 1; j < 8; j++) {
      const f = A[j][i] / A[i][i];
      for (let k = i; k < 8; k++) A[j][k] -= f * A[i][k];
      b[j] -= f * b[i];
    }
  }
  const p = new Array(8).fill(0);
  for (let i = 7; i >= 0; i--) {
    let sum = b[i];
    for (let k = i + 1; k < 8; k++) sum -= A[i][k] * p[k];
    p[i] = sum / A[i][i];
  }
  return (x: number, y: number): [number, number] => {
    const d = p[6] * x + p[7] * y + 1;
    return [(p[0] * x + p[1] * y + p[2]) / d, (p[3] * x + p[4] * y + p[5]) / d];
  };
}

// Straighten a photographed surface: the quadrilateral given by four corners
// (pixels, clockwise from top-left) becomes a rectangle.
export function rectify(r: Raster, corners: [number, number][], maxSide = 1600): Raster {
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let width = (dist(corners[0], corners[1]) + dist(corners[3], corners[2])) / 2;
  let height = (dist(corners[0], corners[3]) + dist(corners[1], corners[2])) / 2;
  const k = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(8, Math.round(width * k));
  height = Math.max(8, Math.round(height * k));
  const map = homography(corners, width, height);
  const data = Buffer.alloc(width * height * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = map(x + 0.5, y + 0.5);
      sample(r, sx - 0.5, sy - 0.5, px);
      const o = (y * width + x) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

// Remove a colour cast and even out levels, gently. White balance comes from
// the brightest 5% of pixels (grout, highlights, white edges are usually
// neutral), limited to ±25% per channel so strongly coloured tiles keep
// their colour. Levels stretch only the extreme ends.
export function autoColor(r: Raster): Raster {
  const n = r.width * r.height;
  const lum = new Float32Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * r.data[o] + 0.7152 * r.data[o + 1] + 0.0722 * r.data[o + 2];
    hist[Math.min(255, Math.round(lum[i]))]++;
  }
  const percentile = (p: number) => {
    for (let v = 0, acc = 0; v < 256; v++) if ((acc += hist[v]) >= n * p) return v;
    return 255;
  };
  const brightCut = percentile(0.95);
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (lum[i] < brightCut) continue;
    for (let c = 0; c < 3; c++) sum[c] += r.data[i * 4 + c];
    count++;
  }
  const avg = sum.map((v) => v / Math.max(1, count));
  const grey = (avg[0] + avg[1] + avg[2]) / 3;
  const gain = avg.map((a) => Math.max(0.8, Math.min(1.25, a > 1 ? grey / a : 1)));
  const lo = Math.min(percentile(0.005), 30);
  const hi = Math.max(percentile(0.995), 225);
  const scale = 255 / Math.max(1, hi - lo);
  const data = Buffer.alloc(r.data.length);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, (r.data[o + c] * gain[c] - lo) * scale));
    data[o + 3] = 255;
  }
  return { width: r.width, height: r.height, data };
}

// brightness and contrast in -1..1.
export function adjust(r: Raster, brightness = 0, contrast = 0): Raster {
  if (!brightness && !contrast) return r;
  const k = Math.tan(((contrast + 1) * Math.PI) / 4);
  const data = Buffer.alloc(r.data.length);
  for (let i = 0; i < r.data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, (r.data[i + c] - 128) * k + 128 + brightness * 128));
    data[i + 3] = 255;
  }
  return { width: r.width, height: r.height, data };
}

// Make a texture repeat without visible seams: blend it with a copy shifted
// by half its size, keeping the original in the middle and the shifted copy
// (which wraps continuously) at the edges.
export function seamless(r: Raster): Raster {
  const { width: w, height: h } = r;
  const data = Buffer.alloc(r.data.length);
  for (let y = 0; y < h; y++) {
    const fy = 1 - Math.abs((2 * (y + 0.5)) / h - 1);
    for (let x = 0; x < w; x++) {
      const fx = 1 - Math.abs((2 * (x + 0.5)) / w - 1);
      const t = Math.min(1, Math.min(fx, fy) * 2.5);
      const o = (y * w + x) * 4;
      const s = (((y + (h >> 1)) % h) * w + ((x + (w >> 1)) % w)) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = r.data[o + c] * t + r.data[s + c] * (1 - t);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export async function fit(r: Raster, maxSide: number): Promise<Raster> {
  if (Math.max(r.width, r.height) <= maxSide) return r;
  const k = maxSide / Math.max(r.width, r.height);
  const image = new Jimp({ width: r.width, height: r.height });
  r.data.copy(image.bitmap.data as Buffer);
  image.resize({ w: Math.round(r.width * k), h: Math.round(r.height * k) });
  return { width: image.bitmap.width, height: image.bitmap.height, data: Buffer.from(image.bitmap.data) };
}
