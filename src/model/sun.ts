// Where the sun and moon are for a place and moment (and the moon's phase),
// and where that is on the plan. The formulas are the standard low-precision
// ones (as in SunCalc, after Astronomy Answers): good to a fraction of a
// degree for the sun and about a degree for the moon, offline.
import type { Site } from "./schema";

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const SUN_DISTANCE = 149598000; // km

const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;

function sunCoords(d: number) {
  const m = RAD * (357.5291 + 0.98560028 * d);
  const center = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const longitude = m + center + RAD * 102.9372 + Math.PI;
  return {
    declination: Math.asin(Math.sin(OBLIQUITY) * Math.sin(longitude)),
    rightAscension: Math.atan2(Math.sin(longitude) * Math.cos(OBLIQUITY), Math.cos(longitude)),
  };
}

// The moon's place in the sky (geocentric, distance in km).
function moonCoords(d: number) {
  const l0 = RAD * (218.316 + 13.176396 * d); // mean longitude
  const m = RAD * (134.963 + 13.064993 * d); // mean anomaly
  const f = RAD * (93.272 + 13.22935 * d); // mean distance from its node
  const longitude = l0 + RAD * 6.289 * Math.sin(m);
  const latitude = RAD * 5.128 * Math.sin(f);
  return {
    declination: Math.asin(Math.sin(latitude) * Math.cos(OBLIQUITY) + Math.cos(latitude) * Math.sin(OBLIQUITY) * Math.sin(longitude)),
    rightAscension: Math.atan2(Math.sin(longitude) * Math.cos(OBLIQUITY) - Math.tan(latitude) * Math.sin(OBLIQUITY), Math.cos(longitude)),
    distance: 385001 - 20905 * Math.cos(m),
  };
}

export interface SunPosition {
  // Degrees above the horizon (negative: below).
  altitude: number;
  // Compass bearing, degrees clockwise from north (90 = east).
  bearing: number;
}

// Where something at these celestial coordinates is in the sky.
function skyPosition(d: number, latitude: number, longitude: number, c: { declination: number; rightAscension: number }): SunPosition {
  const phi = RAD * latitude;
  const hourAngle = RAD * (280.16 + 360.9856235 * d) + RAD * longitude - c.rightAscension;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(c.declination) + Math.cos(phi) * Math.cos(c.declination) * Math.cos(hourAngle));
  // Measured from south, westward.
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(c.declination) * Math.cos(phi));
  return { altitude: altitude / RAD, bearing: (((azimuth / RAD + 180) % 360) + 360) % 360 };
}

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const d = toDays(date);
  return skyPosition(d, latitude, longitude, sunCoords(d));
}

export interface MoonPosition extends SunPosition {
  // How much of the moon is lit, 0 (new) to 1 (full), and whether it's growing.
  lit: number;
  waxing: boolean;
}

export function moonPosition(date: Date, latitude: number, longitude: number): MoonPosition {
  const d = toDays(date);
  const sun = sunCoords(d);
  const moon = moonCoords(d);
  // The angle between sun and moon seen from the earth, then from the moon.
  const elongation = Math.acos(
    Math.sin(sun.declination) * Math.sin(moon.declination) +
      Math.cos(sun.declination) * Math.cos(moon.declination) * Math.cos(sun.rightAscension - moon.rightAscension),
  );
  const phase = Math.atan2(SUN_DISTANCE * Math.sin(elongation), moon.distance - SUN_DISTANCE * Math.cos(elongation));
  const side = Math.atan2(
    Math.cos(sun.declination) * Math.sin(sun.rightAscension - moon.rightAscension),
    Math.sin(sun.declination) * Math.cos(moon.declination) - Math.cos(sun.declination) * Math.sin(moon.declination) * Math.cos(sun.rightAscension - moon.rightAscension),
  );
  return { ...skyPosition(d, latitude, longitude, moon), lit: (1 + Math.cos(phase)) / 2, waxing: side < 0 };
}

// Unit vector pointing at the sun in the 3D scene (x = plan x, y up,
// z = plan y), turned by where north is on the plan.
export function sunDirection(pos: SunPosition, north: number): [number, number, number] {
  const angle = RAD * (north + pos.bearing); // clockwise from the plan's up (−y)
  const up = Math.sin(RAD * pos.altitude);
  const flat = Math.cos(RAD * pos.altitude);
  return [Math.sin(angle) * flat, up, -Math.cos(angle) * flat];
}

// A moment on a given day of the year (1 = 1 January) and minute of the day,
// in this computer's time zone.
export function momentOf(year: number, dayOfYear: number, minutes: number): Date {
  return new Date(year, 0, dayOfYear, Math.floor(minutes / 60), minutes % 60);
}

export function dayOfYear(date: Date): number {
  return Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf() - new Date(date.getFullYear(), 0, 0).valueOf()) / DAY_MS);
}

// Sunrise and sunset that day, in minutes of the day (local time), found by
// stepping through the day; null when the sun doesn't rise or set (polar).
export function daylight(year: number, day: number, site: Pick<Site, "latitude" | "longitude">): { sunrise: number; sunset: number } | null {
  const up = (minutes: number) => sunPosition(momentOf(year, day, minutes), site.latitude, site.longitude).altitude > -0.833;
  let sunrise: number | null = null;
  let sunset: number | null = null;
  for (let m = 0; m < 1440; m += 5) {
    const a = up(m);
    const b = up(m + 5);
    if (!a && b && sunrise === null) sunrise = m + 5;
    if (a && !b) sunset = m;
  }
  return sunrise !== null && sunset !== null ? { sunrise, sunset } : null;
}

// Light from the sun at that altitude: how strong (0 at night) and its colour,
// warmer near the horizon.
export function sunlight(altitude: number): { strength: number; color: string } {
  if (altitude <= -1) return { strength: 0, color: "#ffb47a" };
  const t = Math.min(1, Math.max(0, (altitude + 1) / 25));
  const strength = Math.min(1, Math.max(0, (altitude + 1) / 12));
  // From warm orange at the horizon to near white high up.
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const color = `rgb(${mix(255, 255)}, ${mix(170, 246)}, ${mix(110, 232)})`;
  return { strength, color };
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// How much of the day's sky light is left: 1 with the sun 18° up, falling
// smoothly through dusk to 0 once the sky is dark (the sun 12° down). All the
// light from the sky follows it, so evenings darken without jumps.
export function daylightLeft(altitude: number): number {
  return smooth((altitude + 12) / 30);
}

// Light from the moon: 0 (new, or below the horizon) to 1 (full and high).
// Its brightness falls off fast with the phase; a half moon gives a fraction.
export function moonlight(moon: MoonPosition): number {
  return moon.lit * moon.lit * smooth((moon.altitude + 1) / 16);
}

// Sky colour for the time: night blue, warm at sunrise and sunset, day blue.
export function skyColor(altitude: number, dark: boolean): string {
  const stops: [number, [number, number, number]][] = dark
    ? [
        [-12, [16, 20, 30]],
        [-2, [44, 40, 58]],
        [4, [120, 90, 80]],
        [15, [70, 96, 128]],
        [40, [62, 92, 128]],
      ]
    : [
        [-12, [40, 48, 70]],
        [-2, [120, 110, 140]],
        [4, [240, 196, 160]],
        [15, [190, 214, 236]],
        [40, [176, 206, 236]],
      ];
  if (altitude <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
  for (let i = 1; i < stops.length; i++) {
    const [a0, c0] = stops[i - 1];
    const [a1, c1] = stops[i];
    if (altitude <= a1) {
      const t = (altitude - a0) / (a1 - a0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(",")})`;
    }
  }
  return `rgb(${stops.at(-1)![1].join(",")})`;
}
