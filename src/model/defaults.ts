// Starting content for new projects and scenes.
import type { Material } from "./schema";

type MaterialInput = Partial<Material> & { color: string };

export const DEFAULT_MATERIALS: Record<string, MaterialInput> = {
  wall: { color: "#f1ede6", roughness: 0.95 },
  white: { color: "#f7f7f5", roughness: 0.5 },
  oak: { color: "#c49a6c", roughness: 0.7 },
  walnut: { color: "#6b4a32", roughness: 0.6 },
  black: { color: "#262626", roughness: 0.4 },
  steel: { color: "#b9bcc0", roughness: 0.3, metalness: 0.8 },
  "fabric-grey": { color: "#8d8f93", roughness: 1 },
  "fabric-blue": { color: "#4f6d8f", roughness: 1 },
  porcelain: { color: "#fbfbfb", roughness: 0.15 },
  "tile-white": { color: "#e9ecee", roughness: 0.3 },
  "tile-grey": { color: "#9fa4a8", roughness: 0.5 },
  glass: { color: "#bfe3f2", roughness: 0.05, opacity: 0.35 },
};

export function newProjectFile(name: string) {
  return { version: 1 as const, name, units: "cm" as const, materials: DEFAULT_MATERIALS };
}

export interface StarterRoom {
  width: number; // clear inside width, cm
  depth: number; // clear inside depth, cm
  height?: number;
}

const OUTER_WALL = 25;

// A shell with nothing in it, or one rectangular room whose inside measures
// exactly width × depth. The plan origin is the outer north-west corner's
// wall centreline.
export function newShellFile(room?: StarterRoom) {
  if (!room) return { version: 1, wallHeight: 260, walls: [], openings: [], rooms: [] };
  const x = room.width + OUTER_WALL;
  const y = room.depth + OUTER_WALL;
  return {
    version: 1,
    wallHeight: room.height ?? 260,
    walls: [
      { id: "wall-north", from: [0, 0], to: [x, 0], thickness: OUTER_WALL },
      { id: "wall-east", from: [x, 0], to: [x, y], thickness: OUTER_WALL },
      { id: "wall-south", from: [x, y], to: [0, y], thickness: OUTER_WALL },
      { id: "wall-west", from: [0, y], to: [0, 0], thickness: OUTER_WALL },
    ],
    openings: [],
    rooms: [{ id: "room", name: "Room", polygon: [[0, 0], [x, 0], [x, y], [0, y]], floor: "oak" }],
  };
}

export function newSceneFile(name: string, description?: string) {
  return { version: 1 as const, name, ...(description ? { description } : {}), objects: [] };
}

// File-friendly name: "Option B: island" → "option-b-island". Keeps
// non-Latin letters, so "Кујна" → "кујна".
export function slugify(name: string): string {
  return (
    name
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "scene"
  );
}
