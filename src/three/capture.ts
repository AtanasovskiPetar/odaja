// Screenshots of the viewport for AI tools. The plan view includes the
// dimension overlay, so a model can read measurements off the image.
import type * as THREE from "three";
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
const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin", "opacity", "font-size", "font-weight", "font-family", "paint-order", "text-anchor", "dominant-baseline"];

async function overlayImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = svg.querySelectorAll("*");
  const target = clone.querySelectorAll("*");
  source.forEach((el, i) => {
    const computed = getComputedStyle(el);
    (target[i] as SVGElement).setAttribute("style", STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(";"));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
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

export async function captureView(view: ViewMode): Promise<{ data: string; mimeType: string }> {
  const state = useOdaja.getState();
  const previous = state.viewMode;
  if (view !== previous) {
    state.setViewMode(view);
    await frames(4);
  }
  try {
    const { gl, scene, camera } = viewport;
    if (!gl || !scene || !camera) throw new Error("the 3D view isn't ready");
    gl.render(scene, camera);
    const src = gl.domElement;
    const k = Math.min(1, MAX_WIDTH / src.clientWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(src.clientWidth * k);
    canvas.height = Math.round(src.clientHeight * k);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const overlay = document.querySelector<SVGSVGElement>(".plan-overlay");
    if (view === "plan" && overlay) ctx.drawImage(await overlayImage(overlay), 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  } finally {
    if (view !== previous) useOdaja.getState().setViewMode(previous);
  }
}
