// Pictures of the viewport: screenshots for AI tools (small JPEGs) and image
// exports (full size). The plan view includes the dimension overlay, so the
// measurements are in the picture.
import type * as THREE from "three";
import serifItalic from "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2?url";
import serifRegular from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url";
import { useOdaja, type ViewMode } from "../store";

export const viewport: { gl: THREE.WebGLRenderer | null; scene: THREE.Scene | null; camera: THREE.Camera | null } = {
  gl: null,
  scene: null,
  camera: null,
};

const MAX_WIDTH = 1400;
const frames = (n: number) => new Promise<void>((r) => {
  const step = (left: number) => (left <= 0 ? r() : requestAnimationFrame(() => step(left - 1)));
  step(n);
});

// Styles that matter for drawing the SVG overlay outside the page.
const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin", "opacity", "font-size", "font-weight", "font-style", "font-family", "letter-spacing", "paint-order", "text-anchor", "dominant-baseline"];

// An SVG drawn as an image can't use the page's fonts, so the serif used for
// room names is embedded in it.
let fontFaces: Promise<string> | null = null;
function embeddedFonts(): Promise<string> {
  const asDataUrl = (url: string) =>
    fetch(url)
      .then((r) => r.blob())
      .then((b) => new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(b);
      }));
  fontFaces ??= Promise.all([asDataUrl(serifRegular), asDataUrl(serifItalic)])
    .then(
      ([regular, italic]) =>
        `@font-face{font-family:"Instrument Serif";font-style:normal;src:url(${regular}) format("woff2")}` +
        `@font-face{font-family:"Instrument Serif";font-style:italic;src:url(${italic}) format("woff2")}`,
    )
    .catch(() => "");
  return fontFaces;
}

async function overlayImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = svg.querySelectorAll("*");
  const target = clone.querySelectorAll("*");
  source.forEach((el, i) => {
    const computed = getComputedStyle(el);
    (target[i] as SVGElement).setAttribute("style", STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(";"));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = await embeddedFonts();
  clone.insertBefore(style, clone.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draw a view into a canvas: the 3D picture plus, in the plan, the overlay.
// `maxWidth` limits the size (screenshots); otherwise it's the full screen
// resolution (exports). `level` shows that level for the picture.
export async function renderView(view: ViewMode, maxWidth?: number, level?: string): Promise<HTMLCanvasElement> {
  const state = useOdaja.getState();
  const previous = state.viewMode;
  const previousLevel = state.level;
  const otherLevel = level !== undefined && level !== previousLevel;
  if (otherLevel) state.setLevel(level);
  if (view !== previous) state.setViewMode(view);
  if (view !== previous || otherLevel) await frames(4);
  try {
    const { gl, scene, camera } = viewport;
    if (!gl || !scene || !camera) throw new Error("the 3D view isn't ready");
    gl.render(scene, camera);
    const src = gl.domElement;
    const width = maxWidth ? Math.min(maxWidth, src.clientWidth) : src.width;
    const k = width / src.clientWidth;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(src.clientWidth * k);
    canvas.height = Math.round(src.clientHeight * k);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const overlay = document.querySelector<SVGSVGElement>(".plan-overlay");
    if (view === "plan" && overlay) ctx.drawImage(await overlayImage(overlay), 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if (view !== previous) useOdaja.getState().setViewMode(previous);
    if (otherLevel) useOdaja.getState().setLevel(previousLevel);
  }
}

// A small JPEG for AI tools.
export async function captureView(view: ViewMode, level?: string): Promise<{ data: string; mimeType: string }> {
  const canvas = await renderView(view, MAX_WIDTH, level);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
}

// A full-size image of a view, to save.
export async function exportViewImage(view: ViewMode, format: "png" | "jpeg"): Promise<Blob> {
  const canvas = await renderView(view);
  if (format === "jpeg") {
    // JPEG has no transparency: put the paper colour behind the drawing.
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper") || "#f1ede4";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return new Promise((resolve, reject) => flat.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't make the image"))), "image/jpeg", 0.92));
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't make the image"))), "image/png"));
}
