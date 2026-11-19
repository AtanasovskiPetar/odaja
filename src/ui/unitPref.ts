// Display unit preference (metric cm/m vs imperial ft/in). Stored per browser
// in localStorage; project files always stay in centimetres.
import { useSyncExternalStore } from "react";
import type { UnitSystem } from "../model/units";

const KEY = "odaja:units";
const listeners = new Set<() => void>();

function read(): UnitSystem {
  try {
    return localStorage.getItem(KEY) === "imperial" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

let pref: UnitSystem = read();

export function unitSystem(): UnitSystem {
  return pref;
}

export function setUnitSystem(next: UnitSystem) {
  if (pref === next) return;
  pref = next;
  try {
    if (next === "metric") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {}
  listeners.forEach((l) => l());
}

export function toggleUnitSystem() {
  setUnitSystem(pref === "metric" ? "imperial" : "metric");
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useUnitSystem(): UnitSystem {
  return useSyncExternalStore(subscribe, unitSystem, () => "metric" as UnitSystem);
}
