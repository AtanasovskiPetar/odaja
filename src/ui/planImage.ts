// Loading floor plans: images as they are (downscaled if huge), PDFs by
// rendering their first page. Saved into the project under assets/plans/.
import { slugify } from "../model/defaults";
import type { UnderlayDoc } from "../model/schema";
import { defaultUnderlay } from "../model/underlay";
import { platform } from "../platform";

const MAX_SIDE = 4000;

export const PLAN_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,.pdf";

async function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the plan image"))), type, 0.92));
}

export async function loadPlanFile(file: File): Promise<{ blob: Blob; width: number; height: number; ext: "png" | "jpg" }> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, 3000 / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { blob: await canvasBlob(canvas, "image/png"), width: canvas.width, height: canvas.height, ext: "png" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Use an image (PNG, JPG, WebP) or a PDF.");
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const png = file.type === "image/png";
  return { blob: await canvasBlob(canvas, png ? "image/png" : "image/jpeg"), width: canvas.width, height: canvas.height, ext: png ? "png" : "jpg" };
}

// Save a plan file into the open project; returns a background set-up for it
// (the scale is a first guess until it's set from a known measurement).
export async function savePlanFile(file: File): Promise<{ underlay: UnderlayDoc; blob: Blob }> {
  const { blob, width, height, ext } = await loadPlanFile(file);
  const name = slugify(file.name.replace(/\.[^.]+$/, "")).replace(/[^a-z0-9-]/g, "") || "plan";
  const path = `assets/plans/${name}-${Date.now().toString(36)}.${ext}`;
  await platform.writeFile(path, blob);
  return { underlay: defaultUnderlay(path, width, height), blob };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return btoa(binary);
}
