// The sunlight view: on or off, and the day and time it shows. Not saved
// with the home (the site, where the flat is, is: project.json `site`).
import { create } from "zustand";
import { dayOfYear } from "../model/sun";

interface SunState {
  on: boolean;
  // Day of the year (1–366) and minute of the day, local time.
  day: number;
  minutes: number;
  playing: boolean;
  // The location form is open (also when no site is set yet).
  editingSite: boolean;
  // North while the location form is being edited, shown on the plan before saving.
  draftNorth: number | null;
  setOn(on: boolean): void;
  setDay(day: number): void;
  setMinutes(minutes: number): void;
  setPlaying(playing: boolean): void;
  setEditingSite(editing: boolean): void;
  setDraftNorth(north: number | null): void;
}

const now = new Date();

export const useSun = create<SunState>((set) => ({
  on: false,
  day: dayOfYear(now),
  minutes: Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15,
  playing: false,
  editingSite: false,
  draftNorth: null,
  setOn: (on) => set(on ? { on } : { on, playing: false, editingSite: false, draftNorth: null }),
  setDay: (day) => set({ day: Math.min(365, Math.max(1, Math.round(day))) }),
  setMinutes: (minutes) => set({ minutes: Math.min(1439, Math.max(0, Math.round(minutes))) }),
  setPlaying: (playing) => set({ playing }),
  setEditingSite: (editingSite) => set(editingSite ? { editingSite } : { editingSite, draftNorth: null }),
  setDraftNorth: (draftNorth) => set({ draftNorth }),
}));

export const SUN_YEAR = now.getFullYear();
