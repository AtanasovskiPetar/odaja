// Image decoding and encoding for the AI photo tools in the browser: the
// browser's own image decoder and a canvas, no library needed.
import type { ImageCodec, Raster } from "./photos";

function canvas(width: number, height: number) {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("this browser can't edit images");
  return { c, ctx };
}

function toCanvas(r: Raster) {
  const out = canvas(r.width, r.height);
  const pixels = new Uint8ClampedArray(r.width * r.height * 4);
  pixels.set(r.data);
  out.ctx.putImageData(new ImageData(pixels, r.width, r.height), 0, 0);
  return out;
}

const read = (ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): Raster => ({
  width,
  height,
  data: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer),
});

export const canvasCodec: ImageCodec = {
  async decode(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const { width, height } = bitmap;
    const { ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close(); // Releases it: width and height read 0 after this.
    return read(ctx, width, height);
  },
  async encodeJpeg(r, quality) {
    const blob = await toCanvas(r).c.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
    return new Uint8Array(await blob.arrayBuffer());
  },
  async resize(r, width, height) {
    const source = toCanvas(r).c;
    const { ctx } = canvas(width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    return read(ctx, width, height);
  },
};
