// Built-in furniture templates. Each one builds an object's parts from a few
// size parameters, so "a 80 cm base cabinet" is just
// { "template": "base-cabinet", "params": { "width": 80 } } in a scene file.
// Conventions match hand-built objects: origin at the centre of the
// footprint, front facing north (-y), sizes in cm.
//
// Keep docs/project-format.md's template table in sync with this file.
import type { PartInput } from "./schema";

export interface ParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
}

export interface Template {
  id: string;
  name: string;
  category: "Kitchen" | "Living" | "Bedroom" | "Bathroom" | "Garden" | "Basic";
  params: ParamSpec[];
  // Height above the floor when placed (wall cabinets, mirrors…).
  elevation?: number;
  build(p: Record<string, number>): PartInput[];
}

const size = (key: string, label: string, def: number, min = 1, max = 1000): ParamSpec => ({ key, label, default: def, min, max });
const W = (def: number) => size("width", "Width", def);
const BARK = "#6b4f3a";
const LEAVES = "#5d8a3e";
const LEAVES_DARK = "#4a7433";
const NEEDLES = "#3d6638";
const D = (def: number) => size("depth", "Depth", def);
const H = (def: number) => size("height", "Height", def);

// Door fronts across a cabinet face: one door up to 60 cm, then two or more.
function fronts(width: number, depth: number, bottom: number, height: number, material = "white"): PartInput[] {
  const count = Math.max(1, Math.round(width / 50));
  const w = width / count;
  return Array.from({ length: count }, (_, i) => ({
    name: `front-${i + 1}`,
    shape: "box" as const,
    size: [w - 0.4, 2, height] as [number, number, number],
    at: [-width / 2 + w * (i + 0.5), -depth / 2 - 1, bottom] as [number, number, number],
    material,
  }));
}

function legs(width: number, depth: number, height: number, inset: number, radius: number, material: string): PartInput[] {
  const x = width / 2 - inset;
  const y = depth / 2 - inset;
  return [
    [-x, -y],
    [x, -y],
    [-x, y],
    [x, y],
  ].map(([lx, ly]) => ({ shape: "cylinder" as const, radius, height, at: [lx, ly, 0] as [number, number, number], material }));
}

export const TEMPLATES: Template[] = [
  {
    id: "base-cabinet",
    name: "Base cabinet with worktop",
    category: "Kitchen",
    params: [W(60), D(60), H(90)],
    build: ({ width, depth, height }) => [
      { name: "plinth", shape: "box", size: [width, depth - 8, 10], at: [0, 4, 0], material: "black" },
      { name: "carcass", shape: "box", size: [width, depth - 4, height - 14], at: [0, 2, 10], material: "white" },
      ...fronts(width, depth - 4, 11, height - 16),
      { name: "worktop", shape: "box", size: [width, depth + 2, 4], at: [0, -1, height - 4], material: "oak" },
    ],
  },
  {
    id: "wall-cabinet",
    name: "Wall cabinet",
    category: "Kitchen",
    params: [W(60), D(35), H(70)],
    elevation: 145,
    build: ({ width, depth, height }) => [
      { name: "carcass", shape: "box", size: [width, depth - 2, height], at: [0, 1, 0], material: "white" },
      ...fronts(width, depth - 2, 0.5, height - 1),
    ],
  },
  {
    id: "tall-cabinet",
    name: "Tall cabinet",
    category: "Kitchen",
    params: [W(60), D(60), H(220)],
    build: ({ width, depth, height }) => [
      { name: "plinth", shape: "box", size: [width, depth - 8, 10], at: [0, 4, 0], material: "black" },
      { name: "carcass", shape: "box", size: [width, depth - 2, height - 10], at: [0, 1, 10], material: "white" },
      ...fronts(width, depth - 2, 11, height - 12),
    ],
  },
  {
    id: "fridge",
    name: "Fridge",
    category: "Kitchen",
    params: [W(60), D(65), H(200)],
    build: ({ width, depth, height }) => [
      { name: "body", shape: "box", size: [width, depth, height], material: "white", radius: 2 },
      { name: "handle", shape: "box", size: [2, 3, Math.min(60, height / 3)], at: [width / 2 - 6, -depth / 2 - 1.5, height / 2], material: "steel" },
    ],
  },
  {
    id: "table",
    name: "Table",
    category: "Living",
    params: [W(160), D(90), H(75)],
    build: ({ width, depth, height }) => [
      { name: "top", shape: "box", size: [width, depth, 4], at: [0, 0, height - 4], material: "oak", radius: 1 },
      ...legs(width, depth, height - 4, 8, 2.5, "black"),
    ],
  },
  {
    id: "chair",
    name: "Chair",
    category: "Living",
    params: [W(45), D(48), size("seat", "Seat height", 45, 20, 90)],
    build: ({ width, depth, seat }) => [
      { name: "seat", shape: "box", size: [width, depth, 4], at: [0, 0, seat - 2], material: "walnut", radius: 1 },
      { name: "back", shape: "box", size: [width, 3, 40], at: [0, depth / 2 - 1.5, seat + 2], material: "walnut", radius: 1 },
      ...legs(width, depth, seat - 2, 3, 1.5, "black"),
    ],
  },
  {
    id: "sofa",
    name: "Sofa",
    category: "Living",
    params: [W(220), D(95), H(85)],
    build: ({ width, depth, height }) => [
      { name: "base", shape: "box", size: [width, depth, 42], material: "fabric-blue", radius: 4 },
      { name: "back", shape: "box", size: [width, 22, height - 40], at: [0, depth / 2 - 11, 40], material: "fabric-blue", radius: 6 },
      { name: "arm-left", shape: "box", size: [22, depth, 25], at: [-width / 2 + 11, 0, 40], material: "fabric-blue", radius: 6 },
      { name: "arm-right", shape: "box", size: [22, depth, 25], at: [width / 2 - 11, 0, 40], material: "fabric-blue", radius: 6 },
    ],
  },
  {
    id: "coffee-table",
    name: "Coffee table",
    category: "Living",
    params: [W(110), D(60), H(40)],
    build: ({ width, depth, height }) => [
      { name: "top", shape: "box", size: [width, depth, 4], at: [0, 0, height - 4], material: "walnut", radius: 1 },
      { name: "base", shape: "box", size: [width * 0.8, depth * 0.66, height - 4], material: "black" },
    ],
  },
  {
    id: "bookcase",
    name: "Bookcase",
    category: "Living",
    params: [W(80), D(30), H(200), size("shelves", "Shelves", 5, 1, 20)],
    build: ({ width, depth, height, shelves }) => {
      const count = Math.round(shelves);
      const gap = (height - 4) / count;
      return [
        { name: "side-left", shape: "box", size: [2, depth, height], at: [-width / 2 + 1, 0, 0], material: "oak" },
        { name: "side-right", shape: "box", size: [2, depth, height], at: [width / 2 - 1, 0, 0], material: "oak" },
        { name: "back", shape: "box", size: [width - 4, 1, height], at: [0, depth / 2 - 0.5, 0], material: "oak" },
        ...Array.from({ length: count + 1 }, (_, i) => ({
          name: `shelf-${i}`,
          shape: "box" as const,
          size: [width - 4, depth - 1, 2] as [number, number, number],
          at: [0, -0.5, Math.min(i * gap, height - 2)] as [number, number, number],
          material: "oak",
        })),
      ];
    },
  },
  {
    id: "bed",
    name: "Bed",
    category: "Bedroom",
    params: [size("width", "Mattress width", 160), size("length", "Mattress length", 200)],
    build: ({ width, length }) => [
      { name: "frame", shape: "box", size: [width + 6, length + 6, 30], material: "oak", radius: 1 },
      { name: "mattress", shape: "box", size: [width, length, 22], at: [0, -2, 30], material: "white", radius: 5 },
      { name: "headboard", shape: "box", size: [width + 6, 6, 100], at: [0, length / 2, 0], material: "oak", radius: 1 },
      ...(width >= 120
        ? [
            { name: "pillow-left", shape: "box" as const, size: [width / 2 - 20, 35, 12] as [number, number, number], at: [-width / 4, length / 2 - 25, 52] as [number, number, number], material: "fabric-grey", radius: 5 },
            { name: "pillow-right", shape: "box" as const, size: [width / 2 - 20, 35, 12] as [number, number, number], at: [width / 4, length / 2 - 25, 52] as [number, number, number], material: "fabric-grey", radius: 5 },
          ]
        : [{ name: "pillow", shape: "box" as const, size: [width - 30, 35, 12] as [number, number, number], at: [0, length / 2 - 25, 52] as [number, number, number], material: "fabric-grey", radius: 5 }]),
    ],
  },
  {
    id: "nightstand",
    name: "Nightstand",
    category: "Bedroom",
    params: [W(40), D(40), H(50)],
    build: ({ width, depth, height }) => [{ shape: "box", size: [width, depth, height], material: "walnut", radius: 1 }],
  },
  {
    id: "wardrobe",
    name: "Wardrobe",
    category: "Bedroom",
    params: [W(200), D(60), H(220)],
    build: ({ width, depth, height }) => [
      { name: "body", shape: "box", size: [width, depth - 2, height], at: [0, 1, 0], material: "white", radius: 1 },
      ...fronts(width, depth - 2, 1, height - 2),
    ],
  },
  {
    id: "toilet",
    name: "Toilet",
    category: "Bathroom",
    params: [W(38), D(65)],
    build: ({ width, depth }) => [
      { name: "bowl", shape: "box", size: [width - 2, depth - 18, 40], at: [0, -9, 0], material: "porcelain", radius: Math.min(15, width / 2 - 2) },
      { name: "seat", shape: "box", size: [width, depth - 22, 2], at: [0, -11, 40], material: "porcelain", radius: Math.min(15, width / 2 - 1) },
      { name: "tank", shape: "box", size: [width, 18, 40], at: [0, depth / 2 - 9, 40], material: "porcelain", radius: 2 },
    ],
  },
  {
    id: "vanity",
    name: "Vanity with basin",
    category: "Bathroom",
    params: [W(60), D(45)],
    build: ({ width, depth }) => [
      { name: "cabinet", shape: "box", size: [width, depth, 50], at: [0, 0, 35], material: "oak", radius: 1 },
      // Overhangs at the front and sides, flush at the back against the wall.
      { name: "basin", shape: "box", size: [width + 2, depth + 1, 6], at: [0, -0.5, 85], material: "porcelain", radius: 2 },
      { name: "mirror", shape: "box", size: [width, 2, 80], at: [0, depth / 2 - 1, 110], material: "glass" },
    ],
  },
  {
    id: "shower",
    name: "Shower tray with glass",
    category: "Bathroom",
    params: [W(90), D(90)],
    build: ({ width, depth }) => [
      { name: "tray", shape: "box", size: [width, depth, 4], material: "porcelain", radius: 1 },
      { name: "glass-front", shape: "box", size: [width, 1, 196], at: [0, -depth / 2 + 0.5, 4], material: "glass" },
      { name: "glass-side", shape: "box", size: [1, depth, 196], at: [-width / 2 + 0.5, 0, 4], material: "glass" },
    ],
  },
  {
    id: "bathtub",
    name: "Bathtub",
    category: "Bathroom",
    params: [size("width", "Length", 170), size("depth", "Width", 75)],
    build: ({ width, depth }) => [{ shape: "box", size: [width, depth, 55], material: "porcelain", radius: 3 }],
  },
  {
    id: "washing-machine",
    name: "Washing machine",
    category: "Bathroom",
    params: [W(60), D(60), H(85)],
    build: ({ width, depth, height }) => [
      { name: "body", shape: "box", size: [width, depth, height], material: "white", radius: 2 },
      { name: "door", shape: "box", size: [width * 0.6, 2, width * 0.6], at: [0, -depth / 2 - 1, height * 0.2], material: "steel", radius: 0.9 },
    ],
  },
  {
    id: "box",
    name: "Box",
    category: "Basic",
    params: [W(60), D(60), H(60)],
    build: ({ width, depth, height }) => [{ shape: "box", size: [width, depth, height], material: "white" }],
  },
  {
    id: "cylinder",
    name: "Cylinder",
    category: "Basic",
    params: [size("diameter", "Diameter", 50), H(75)],
    build: ({ diameter, height }) => [{ shape: "cylinder", radius: diameter / 2, height, material: "white" }],
  },
  // Plants are drawn in plain colours, so they need no project materials.
  {
    id: "tree",
    name: "Tree",
    category: "Garden",
    params: [H(500), size("spread", "Crown width", 300)],
    build: ({ height, spread }) => {
      const r = Math.min(spread, height) / 2;
      const crown = height - 2 * r;
      return [
        { name: "trunk", shape: "cylinder", radius: Math.max(6, spread / 25), height: crown + r, color: BARK },
        { name: "crown", shape: "sphere", radius: r, at: [0, 0, crown], color: LEAVES },
        { name: "crown-2", shape: "sphere", radius: r * 0.7, at: [r * 0.45, -r * 0.2, crown + r * 0.1], color: LEAVES_DARK },
        { name: "crown-3", shape: "sphere", radius: r * 0.65, at: [-r * 0.4, r * 0.3, crown + r * 0.2], color: LEAVES_DARK },
      ];
    },
  },
  {
    id: "conifer",
    name: "Conifer",
    category: "Garden",
    params: [H(400), size("spread", "Width", 160)],
    build: ({ height, spread }) => {
      const trunk = Math.min(60, height / 5);
      const tier = (height - trunk) / 4;
      return [
        { name: "trunk", shape: "cylinder", radius: Math.max(5, spread / 20), height: trunk + tier, color: BARK },
        ...[1, 0.75, 0.5, 0.25].map((k, i) => ({ name: `tier-${i + 1}`, shape: "cylinder" as const, radius: (spread / 2) * k, height: tier, at: [0, 0, trunk + i * tier] as [number, number, number], color: NEEDLES })),
      ];
    },
  },
  {
    id: "shrub",
    name: "Shrub",
    category: "Garden",
    params: [W(90)],
    build: ({ width }) => [
      { name: "bush", shape: "sphere", radius: width / 2, at: [0, 0, -width * 0.15], color: LEAVES },
      { name: "bush-2", shape: "sphere", radius: width * 0.35, at: [width * 0.2, -width * 0.1, width * 0.25], color: LEAVES_DARK },
    ],
  },
  {
    id: "planter",
    name: "Planter with shrub",
    category: "Garden",
    params: [W(60), D(60), H(60)],
    build: ({ width, depth, height }) => {
      const r = Math.min(width, depth) * 0.42;
      return [
        { name: "pot", shape: "box", size: [width, depth, height], color: "#8f8a84", radius: 2 },
        { name: "soil", shape: "box", size: [width - 6, depth - 6, 1], at: [0, 0, height - 3], color: "#5a4433" },
        { name: "plant", shape: "sphere", radius: r, at: [0, 0, height - r * 0.4], color: LEAVES },
      ];
    },
  },
];

export const TEMPLATES_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateParams(template: Template, given: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(template.params.map((p) => [p.key, Math.min(p.max, Math.max(p.min, given[p.key] ?? p.default))]));
}

export function buildTemplate(id: string, given?: Record<string, number>): PartInput[] | null {
  const template = TEMPLATES_BY_ID.get(id);
  return template ? template.build(templateParams(template, given)) : null;
}
