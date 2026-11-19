// The sky for the sunlight view's day and time, shared by everything it
// lights: where the sun and moon are, how much daylight is left and how
// bright the moon is. Null with the sunlight view off or no site.
import { useMemo } from "react";
import { daylightLeft, momentOf, moonlight, moonPosition, sunPosition, type MoonPosition, type SunPosition } from "../model/sun";
import { useOdaja } from "../store";
import { SUN_YEAR, useSun } from "../ui/sunState";

export interface Sky {
  sun: SunPosition;
  moon: MoonPosition;
  // Where north is on the plan, degrees.
  north: number;
  // 1 by day to 0 once the sky is dark (daylightLeft).
  daylight: number;
  // 0 (no moon) to 1 (a full moon high up).
  moonlight: number;
}

export function useSky(): Sky | null {
  const site = useOdaja((s) => s.project?.site);
  const on = useSun((s) => s.on);
  const day = useSun((s) => s.day);
  const minutes = useSun((s) => s.minutes);
  return useMemo(() => {
    if (!on || !site) return null;
    const at = momentOf(SUN_YEAR, day, minutes);
    const sun = sunPosition(at, site.latitude, site.longitude);
    const moon = moonPosition(at, site.latitude, site.longitude);
    return { sun, moon, north: site.north, daylight: daylightLeft(sun.altitude), moonlight: moonlight(moon) };
  }, [on, site, day, minutes]);
}
