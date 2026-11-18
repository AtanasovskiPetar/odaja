import { create } from "zustand";

export const useLamps = create<{ on: boolean; brightness: number; setOn(on: boolean): void; setBrightness(brightness: number): void }>((set) => ({
  on: false,
  brightness: 1,
  setOn: (on) => set({ on }),
  setBrightness: (brightness) => set({ brightness }),
}));
