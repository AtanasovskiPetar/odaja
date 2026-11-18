// The evening view: lamps light the room. Not saved with the home.
import { create } from "zustand";

export const useLamps = create<{ on: boolean; setOn(on: boolean): void }>((set) => ({
  on: false,
  setOn: (on) => set({ on }),
}));
