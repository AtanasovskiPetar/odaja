import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { pointInPolygon, pointOnWall, wallLength, wallNormal, type Vec } from "../../model/geometry";
import { levelById, levelShell } from "../../model/levels";
import type { Shell } from "../../model/schema";
import { momentOf, skyColor, sunlight, sunPosition } from "../../model/sun";
import { M } from "../../model/units";
import { useOdaja } from "../../store";
import { SUN_YEAR, useSun } from "../../ui/sunState";

RectAreaLightUniformsLib.init();

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

function windowLights(shell: Shell): THREE.RectAreaLight[] {
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
    const light = new THREE.RectAreaLight("#ffffff", 0, M(opening.width) * 0.92, M(opening.height) * 0.92);
    light.name = `window-fill:${opening.id}`;
    light.position.set(M(inside[0]), M(opening.sill + opening.height / 2), M(inside[1]));
    // RectAreaLight emits along local -Z. It has no shadow support; the sun
    // remains responsible for shadowed direct light through the opening.
    light.lookAt(light.position.x + normal[0] * side, light.position.y, light.position.z + normal[1] * side);
    return [light];
  });
}

export function WindowLight({ evening = false }: { evening?: boolean }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const shell = useOdaja((s) => s.shell);
  const whole = useOdaja((s) => s.wholeShell);
  const level = useOdaja((s) => s.level);
  const site = useOdaja((s) => s.project?.site);
  const on = useSun((s) => s.on);
  const day = useSun((s) => s.day);
  const minutes = useSun((s) => s.minutes);
  const lights = useRef<THREE.RectAreaLight[]>([]);
  const active = useMemo(() => shell ?? (whole ? levelShell(whole, levelById(whole, level).id) : null), [shell, whole, level]);

  useEffect(() => {
    const windows = active ? windowLights(active) : [];
    lights.current = windows;
    windows.forEach((light) => scene.add(light));
    invalidate();
    return () => {
      windows.forEach((light) => {
        scene.remove(light);
        light.dispose();
      });
      lights.current = [];
      invalidate();
    };
  }, [active, scene, invalidate]);

  useEffect(() => {
    const altitude = on && site ? sunPosition(momentOf(SUN_YEAR, day, minutes), site.latitude, site.longitude).altitude : -18;
    const sun = sunlight(altitude);
    const color = new THREE.Color(sun.color).lerp(new THREE.Color(skyColor(altitude, false)), 0.45);
    // Artistic exposure: keep enough cool twilight window fill to balance the
    // warm local lamps, without changing the real-sun or standard views.
    const intensity = evening ? 1.25 : !on ? 0.5 : !site ? 3 : 4 * sun.strength + 0.02;
    if (evening) color.set("#9bb8df");
    else if (!on || (site && sun.strength === 0)) color.set("#8a9ab8");
    else if (!site) color.set("#dce8f5");
    lights.current.forEach((light) => {
      light.color.copy(color);
      light.intensity = intensity;
    });
    invalidate();
  }, [active, scene, site, on, day, minutes, evening, invalidate]);

  return null;
}
