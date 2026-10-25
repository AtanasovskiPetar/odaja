// What the Area, Fence and Roof tools draw next (chosen in the Structure
// toolbar).
import { create } from "zustand";
import type { Area, Fence, Roof } from "../model/schema";

interface DrawTools {
  kind: Area["kind"];
  style: Fence["style"];
  roof: Roof["type"];
  setKind(kind: Area["kind"]): void;
  setStyle(style: Fence["style"]): void;
  setRoof(roof: Roof["type"]): void;
}

export const useDrawTools = create<DrawTools>((set) => ({
  kind: "lawn",
  style: "slats",
  roof: "gable",
  setKind: (kind) => set({ kind }),
  setStyle: (style) => set({ style }),
  setRoof: (roof) => set({ roof }),
}));
