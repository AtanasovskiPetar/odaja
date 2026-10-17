// Colours for the 3D views, matching the app's paper-and-ink palette in
// day and night (the app's theme setting), so the drawing sits on the same
// paper as the chrome around it.
import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { isDark, subscribeTheme } from "../ui/themePref";

const day = {
  paper: "#f1ede4",
  room: "#ebe6dc",
  walk: "#dde5ea",
  ink: "#24211c",
  glazing: "#fdfbf6",
  gridCell: "#ddd7cb",
  gridSection: "#c6bfb1",
  ground: "#b8b0a4",
  accent: "#c4462c",
  ghost: "#b9b2a6",
  wash: 0.42,
};

const night: typeof day = {
  paper: "#151412",
  room: "#191816",
  walk: "#1d2226",
  ink: "#e9e2d4",
  glazing: "#2a2824",
  gridCell: "#26241f",
  gridSection: "#36332d",
  ground: "#4a453d",
  accent: "#e2694c",
  ghost: "#6d675d",
  wash: 0.18,
};

export type SceneTheme = typeof day;


export function sceneTheme(): SceneTheme {
  return isDark() ? night : day;
}

export function useSceneTheme(): SceneTheme {
  return useSyncExternalStore(subscribeTheme, isDark, () => false) ? night : day;
}

// Shared plan-view materials, recoloured when the theme changes.
export const planMaterials = {
  wall: new THREE.MeshBasicMaterial({ color: day.ink }),
  glazing: new THREE.MeshBasicMaterial({ color: day.glazing }),
  wash: new THREE.MeshBasicMaterial({ color: day.paper, transparent: true, opacity: day.wash, depthWrite: false }),
};

export function applyPlanTheme(t: SceneTheme) {
  planMaterials.wall.color.set(t.ink);
  planMaterials.glazing.color.set(t.glazing);
  planMaterials.wash.color.set(t.paper);
  planMaterials.wash.opacity = t.wash;
}
