import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { pointInPolygon, pointOnWall, wallLength, wallNormal, type Vec } from "../../model/geometry";
import { levelById, levelShell, levelsOf } from "../../model/levels";
import type { Shell } from "../../model/schema";
import { skyColor, sunlight } from "../../model/sun";
import { M } from "../../model/units";
import { useOdaja } from "../../store";
import { useSun } from "../../ui/sunState";
import { useSky } from "../sky";

RectAreaLightUniformsLib.init();

const DAY_FILL = 4.02;
const NIGHT_COLOR = "#9bb8df";
const WINDOW_DIRECTIONAL = 0.32;

type WindowLightPair = {
  area: THREE.RectAreaLight;
  spot: THREE.SpotLight;
};

function centroid(polygon: Vec[]): Vec {
  let area = 0;
  let x = 0;
  let y = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  });
  return Math.abs(area) > 1e-6
    ? [x / (3 * area), y / (3 * area)]
    : polygon.reduce<Vec>((sum, p) => [sum[0] + p[0] / polygon.length, sum[1] + p[1] / polygon.length], [0, 0]);
}

// The number of window lights stays the same while the house is edited or
// another level is viewed: enough for the level with the most windows,
// rounded up to 4, the spare ones dark. A different number would change every
// shader (see ShaderGate); dark ones cost almost nothing (aoMaterial skips them).
function poolSize(whole: Shell | null): number {
  if (!whole) return 0;
  const windows = levelsOf(whole).map((l) => levelShell(whole, l.id).openings.filter((o) => o.type === "window").length);
  return Math.ceil(Math.max(0, ...windows) / 4) * 4;
}

function windowLights(shell: Shell): WindowLightPair[] {
  const rooms = shell.rooms.map((room) => ({ polygon: room.polygon, center: centroid(room.polygon) }));
  const walls = new Map(shell.walls.map((wall) => [wall.id, wall]));
  return shell.openings.flatMap((opening) => {
    if (opening.type !== "window") return [];
    const wall = walls.get(opening.wall);
    if (!wall || wallLength(wall) < 1e-6 || !rooms.length) return [];
    const along = opening.offset + opening.width / 2;
    const center = pointOnWall(wall, along);
    const normal = wallNormal(wall);
    const inset = wall.thickness / 2 + 6;
    // Prefer the room immediately beside this opening, not a nearer centroid
    // belonging to a different room. Fall back for imperfect room outlines.
    const room = rooms.find((r) => [-1, 1].some((side) => pointInPolygon(pointOnWall(wall, along, side * inset), r.polygon)))
      ?? rooms.reduce((best, r) => Math.hypot(r.center[0] - center[0], r.center[1] - center[1]) < Math.hypot(best.center[0] - center[0], best.center[1] - center[1]) ? r : best);
    // Keep the rectangle parallel to its wall; its emitting normal points
    // toward the room centroid, regardless of the wall's drawing direction.
    const side = (room.center[0] - center[0]) * normal[0] + (room.center[1] - center[1]) * normal[1] >= 0 ? 1 : -1;
    const inside = pointOnWall(wall, along, side * inset);
    const area = new THREE.RectAreaLight("#ffffff", 0, M(opening.width) * 0.92, M(opening.height) * 0.92);
    area.name = `window-fill:${opening.id}`;
    area.position.set(M(inside[0]), M(opening.sill + opening.height / 2), M(inside[1]));
    // RectAreaLight emits along local -Z. It has no shadow support; the sun
    // remains responsible for shadowed direct light through the opening.
    area.lookAt(area.position.x + normal[0] * side, area.position.y, area.position.z + normal[1] * side);
    const spot = new THREE.SpotLight("#ffffff", 0, 0, 1.25, 0.9, 2);
    spot.name = `window-spot:${opening.id}`;
    spot.position.copy(area.position);
    spot.target.position.set(
      area.position.x + normal[0] * side * 2,
      area.position.y,
      area.position.z + normal[1] * side * 2,
    );
    spot.castShadow = false;
    return [{ area, spot }];
  });
}

export function WindowLight() {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const shell = useOdaja((s) => s.shell);
  const whole = useOdaja((s) => s.wholeShell);
  const level = useOdaja((s) => s.level);
  const on = useSun((s) => s.on);
  const sky = useSky();
  const lights = useRef<WindowLightPair[]>([]);
  const active = useMemo(() => shell ?? (whole ? levelShell(whole, levelById(whole, level).id) : null), [shell, whole, level]);
  const pool = useMemo(() => poolSize(whole), [whole]);

  useEffect(() => {
    const windows = active ? windowLights(active) : [];
    const spares: WindowLightPair[] = Array.from({ length: Math.max(0, pool - windows.length) }, () => {
      const area = new THREE.RectAreaLight("#ffffff", 0);
      const spot = new THREE.SpotLight("#ffffff", 0, 0, 1.25, 0.9, 2);
      spot.castShadow = false;
      return { area, spot };
    });
    const all = [...windows, ...spares];
    lights.current = windows;
    all.forEach(({ area, spot }) => {
      scene.add(area);
      scene.add(spot);
      scene.add(spot.target);
    });
    invalidate();
    return () => {
      all.forEach(({ area, spot }) => {
        scene.remove(area);
        scene.remove(spot);
        scene.remove(spot.target);
        area.dispose();
        spot.dispose();
      });
      lights.current = [];
      invalidate();
    };
  }, [active, pool, scene, invalidate]);

  useEffect(() => {
    // Daylight through the windows, in the sky's colour (warm at sunset),
    // fading with the daylight to a cool night fill that the moon brightens.
    // Without the sunlight view a soft cool fill; with it but no site set, a
    // bright neutral one.
    let color = new THREE.Color(on ? "#dce8f5" : "#8a9ab8");
    let intensity = on ? 3 : 0.5;
    if (sky) {
      const altitude = sky.sun.altitude;
      const day = new THREE.Color(sunlight(altitude).color).lerp(new THREE.Color(skyColor(altitude, false)), 0.45);
      const night = 0.4 + 0.4 * sky.moonlight;
      color = new THREE.Color(NIGHT_COLOR).lerp(day, sky.daylight);
      intensity = night + (DAY_FILL - night) * sky.daylight;
    }
    const spotAngle = THREE.MathUtils.lerp(1.25, 0.55, WINDOW_DIRECTIONAL);
    lights.current.forEach(({ area, spot }) => {
      area.color.copy(color);
      area.intensity = intensity;
      spot.color.copy(color);
      spot.intensity = intensity * WINDOW_DIRECTIONAL * 0.35;
      spot.angle = spotAngle;
    });
    invalidate();
  }, [active, pool, scene, sky, on, invalidate]);

  return null;
}
