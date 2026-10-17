// Mapping between a floor plan image's pixels and the plan (cm).
import type { Vec } from "./geometry";
import type { Underlay, UnderlayDoc } from "./schema";

const rotate = ([x, y]: Vec, degrees: number): Vec => {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

type U = Pick<Underlay, "width" | "height" | "scale" | "center"> & { rotation?: number };

// Image pixel (u right, v down) → plan point (cm).
export function pixelToPlan(u: U, [px, py]: Vec): Vec {
  const [dx, dy] = rotate([(px - u.width / 2) * u.scale, (py - u.height / 2) * u.scale], u.rotation ?? 0);
  return [u.center[0] + dx, u.center[1] + dy];
}

// Plan point (cm) → image pixel.
export function planToPixel(u: U, [x, y]: Vec): Vec {
  const [dx, dy] = rotate([x - u.center[0], y - u.center[1]], -(u.rotation ?? 0));
  return [dx / u.scale + u.width / 2, dy / u.scale + u.height / 2];
}

// Rescale so the distance between two plan points becomes `realCm`,
// keeping the first point where it is on the plan.
export function calibrate(u: UnderlayDoc, a: Vec, b: Vec, realCm: number): UnderlayDoc {
  const current = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (current < 0.01 || !(realCm > 0)) return u;
  const pa = planToPixel(u, a);
  const scale = u.scale * (realCm / current);
  const next = { ...u, scale };
  const moved = pixelToPlan(next, pa);
  return { ...next, center: [u.center[0] + a[0] - moved[0], u.center[1] + a[1] - moved[1]] };
}

// A first guess for a new plan image: about 12 m across, centred at the origin area.
export function defaultUnderlay(image: string, width: number, height: number): UnderlayDoc {
  const scale = 1200 / Math.max(width, height);
  return { image, width, height, scale, center: [(width * scale) / 2, (height * scale) / 2], rotation: 0, opacity: 0.5, visible: true };
}
