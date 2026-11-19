// Project files use centimetres on a top-down plan: x to the right, y down the
// page (south), height measured up from the floor, rotations in degrees
// clockwise when seen from above. Three.js uses metres with Y up, so plan y
// maps to three z.
export const M = (cm: number) => cm / 100;

export const planToWorld = (x: number, y: number, height = 0): [number, number, number] => [M(x), M(height), M(y)];

export const rotationToWorld = (degrees: number) => (-degrees * Math.PI) / 180;

export const worldToPlan = (x: number, z: number): [number, number] => [round(x * 100), round(z * 100)];

// Keep files tidy: positions are stored to 0.1 cm.
export const round = (cm: number) => Math.round(cm * 10) / 10;

export type UnitSystem = "metric" | "imperial";

const CM_PER_INCH = 2.54;
const CM2_PER_SQFT = 929.0304;

// Compact architectural feet/inches rounded to the nearest 1/2 inch (e.g. 8' 2½", 11").
export function formatImperial(cm: number): string {
  const sign = cm < 0 ? "-" : "";
  const totalHalfInches = Math.round((Math.abs(cm) / CM_PER_INCH) * 2);
  const wholeInches = Math.floor(totalHalfInches / 2);
  const half = totalHalfInches % 2 === 1 ? "½" : "";
  const feet = Math.floor(wholeInches / 12);
  const inches = wholeInches % 12;
  if (feet === 0) return `${sign}${inches}${half}"`;
  return `${sign}${feet}' ${inches}${half}"`;
}

// Compact dimension label (no "cm" suffix in metric, matching architectural plans).
export function formatDim(cm: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") return formatImperial(cm);
  const r = Math.round(cm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// Explicit length with unit suffix (e.g. "245 cm" or "8' 0½"").
export function formatLength(cm: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") return formatImperial(cm);
  return `${formatDim(cm, "metric")} cm`;
}

// Room / area label (e.g. "14.2 m²" or "153 sq ft").
export function formatArea(cm2: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") {
    const sqft = cm2 / CM2_PER_SQFT;
    return sqft < 10 ? `${sqft.toFixed(1)} sq ft` : `${Math.round(sqft)} sq ft`;
  }
  return `${(cm2 / 10000).toFixed(1)} m²`;
}

// Parse user-typed length in metric or imperial (e.g. "420", "4.2m", "12' 6\"", "96\"").
// Bare numbers use the active display unit (cm for metric, inches for imperial).
export function parseLength(raw: string, defaultUnit: UnitSystem = "metric"): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;

  // Feet + optional inches: 12' 6", 12'6.5, 12ft 6in, 12'
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (ftIn) {
    const feet = Number(ftIn[1]);
    const inches = ftIn[2] ? Number(ftIn[2]) : 0;
    const cm = (feet * 12 + inches) * CM_PER_INCH;
    return cm > 0 && Number.isFinite(cm) ? cm : null;
  }

  // Inches: 96", 96 in
  const inch = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)$/);
  if (inch) {
    const cm = Number(inch[1]) * CM_PER_INCH;
    return cm > 0 && Number.isFinite(cm) ? cm : null;
  }

  // Explicit metric units: mm, cm, m
  const metric = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/);
  if (metric) {
    const v = Number(metric[1]);
    const mult = metric[2] === "m" ? 100 : metric[2] === "mm" ? 0.1 : 1;
    const cm = v * mult;
    return cm > 0 && Number.isFinite(cm) ? cm : null;
  }

  // Bare number: cm in metric, inches in imperial
  const bare = Number(s);
  if (Number.isFinite(bare) && bare > 0) {
    return defaultUnit === "imperial" ? bare * CM_PER_INCH : bare;
  }
  return null;
}
