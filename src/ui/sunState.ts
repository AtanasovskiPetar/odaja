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
  // The panel is open; closed, a small chip with the time stands in for it,
  // so it doesn't cover the room.
  panel: boolean;
  // The location form is open (also when no site is set yet).
  editingSite: boolean;
  // North while the location form is being edited, shown on the plan before saving.
  draftNorth: number | null;
  setOn(on: boolean): void;
  setDay(day: number): void;
  setMinutes(minutes: number): void;
  setPlaying(playing: boolean): void;
  setPanel(panel: boolean): void;
  setEditingSite(editing: boolean): void;
  setDraftNorth(north: number | null): void;
}

const now = new Date();

export const useSun = create<SunState>((set) => ({
  // Sunlight is the best default for a home that has a site. 14:00 gives a
  // clear sun patch without the low, red light of late afternoon. Not saved.
  on: true,
  day: dayOfYear(now),
  minutes: 840,
  playing: false,
  panel: false,
  editingSite: false,
  draftNorth: null,
  // Turning sunlight on opens the panel, to pick the day and time.
  setOn: (on) => set(on ? { on, panel: true } : { on, panel: false, playing: false, editingSite: false, draftNorth: null }),
  setDay: (day) => set({ day: Math.min(365, Math.max(1, Math.round(day))) }),
  setMinutes: (minutes) => set({ minutes: Math.min(1439, Math.max(0, Math.round(minutes))) }),
  setPlaying: (playing) => set({ playing }),
  setPanel: (panel) => set({ panel }),
  setEditingSite: (editingSite) => set(editingSite ? { editingSite } : { editingSite, draftNorth: null }),
  setDraftNorth: (draftNorth) => set({ draftNorth }),
}));

export const SUN_YEAR = now.getFullYear();
