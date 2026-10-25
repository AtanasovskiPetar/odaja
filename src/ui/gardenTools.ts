// What the Area and Fence tools draw next (chosen in the Structure toolbar).
import { create } from "zustand";
import type { Area, Fence } from "../model/schema";

export const useGardenTools = create<{ kind: Area["kind"]; style: Fence["style"]; setKind(kind: Area["kind"]): void; setStyle(style: Fence["style"]): void }>((set) => ({
  kind: "lawn",
  style: "slats",
  setKind: (kind) => set({ kind }),
  setStyle: (style) => set({ style }),
}));
