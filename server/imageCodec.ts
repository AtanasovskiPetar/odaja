// Image decoding and encoding for the AI photo tools on the server (jimp).
import { Jimp } from "jimp";
import type { ImageCodec, Raster } from "../src/agent/photos";

const arrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function toJimp(r: Raster) {
  const image = new Jimp({ width: r.width, height: r.height });
  image.bitmap.data.set(r.data);
  return image;
}

const fromJimp = (image: { bitmap: { width: number; height: number; data: Uint8Array } }): Raster => ({
  width: image.bitmap.width,
  height: image.bitmap.height,
  data: new Uint8Array(image.bitmap.data),
});

export const jimpCodec: ImageCodec = {
  decode: async (bytes) => fromJimp(await Jimp.fromBuffer(arrayBuffer(bytes))),
  encodeJpeg: async (r, quality) => new Uint8Array(await toJimp(r).getBuffer("image/jpeg", { quality })),
  resize: async (r, width, height) => fromJimp(toJimp(r).resize({ w: width, h: height })),
};
