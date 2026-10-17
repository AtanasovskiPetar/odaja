// Light, dark, or whatever the system uses. Kept per browser in
// localStorage and applied as data-theme on <html>, which the stylesheet and
// the 3D views both follow.
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "odaja:theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref: ThemePref = read();

function apply() {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {}
  // Ease the colour change rather than flash it (skipped for reduced motion).
  const root = document.documentElement;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("theme-changing");
    window.setTimeout(() => root.classList.remove("theme-changing"), 320);
  }
  apply();
  listeners.forEach((l) => l());
}

export function themePref() {
  return pref;
}

// Whether the app is showing its dark palette right now.
export function isDark() {
  return pref === "dark" || (pref === "system" && (media?.matches ?? false));
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  media?.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    media?.removeEventListener("change", cb);
  };
}

export function useThemePref() {
  return useSyncExternalStore(subscribeTheme, themePref, () => "system" as ThemePref);
}

export function useIsDark() {
  return useSyncExternalStore(subscribeTheme, isDark, () => false);
}

if (typeof document !== "undefined") apply();
