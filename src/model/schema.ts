// The Odaja project format. Keep docs/project-format.md in sync with this file:
// that document is what agents read before editing a project.
import { z } from "zod";
import { buildTemplate, TEMPLATES_BY_ID } from "./library";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase kebab-case");
const point2 = z.tuple([z.number(), z.number()]);
const point3 = z.tuple([z.number(), z.number(), z.number()]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colors are #rrggbb");

export const TILE_PATTERNS = ["grid", "brick", "third", "vertical", "herringbone", "diagonal"] as const;

// A repeating surface: tiles, planks, panels. Either drawn by Odaja (tile
// colour = the material's color, with grout lines in a pattern) or a photo
// texture (`image`, an image under assets/textures/ showing `size` cm of
// surface, repeated as is).
export const TileSchema = z.object({
  size: point2.describe("one tile [width, height] in cm; for an image, how much surface the image shows"),
  grout: z.number().min(0).max(5).default(0.2).describe("grout joint width, cm"),
  groutColor: color.default("#d9d5cc"),
  pattern: z.enum(TILE_PATTERNS).default("grid"),
  // Slight colour differences between tiles, 0..1 (natural stone, wood).
  variation: z.number().min(0).max(1).default(0),
  image: z.string().regex(/^assets\/textures\/[^/]+\.(jpg|jpeg|png|webp)$/, "image is a file under assets/textures/").optional(),
});

export const MaterialSchema = z.object({
  color,
  roughness: z.number().min(0).max(1).default(0.8),
  metalness: z.number().min(0).max(1).default(0),
  opacity: z.number().min(0).max(1).default(1),
  tile: TileSchema.optional(),
});

// A floor plan image shown under the Plan view, to check and trace walls.
// It never changes the design. `scale` is cm per image pixel; `center` is
// where the image's middle sits on the plan; `rotation` turns it clockwise.
export const UnderlaySchema = z.object({
  image: z.string().regex(/^assets\/plans\/[^/]+\.(png|jpg|jpeg|webp)$/, "image is a file under assets/plans/"),
  width: z.number().positive().describe("image width, px"),
  height: z.number().positive().describe("image height, px"),
  scale: z.number().positive().describe("cm per pixel"),
  center: point2,
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(0.5),
  visible: z.boolean().default(true),
});

export const ProjectSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  units: z.literal("cm"),
  materials: z.record(z.string(), MaterialSchema).default({}),
  underlay: UnderlaySchema.optional(),
});

export const WallSchema = z.object({
  id,
  from: point2,
  to: point2,
  thickness: z.number().positive().default(12),
  height: z.number().positive().optional(),
  material: z.string().optional(),
});

export const OpeningSchema = z.object({
  id,
  wall: id,
  type: z.enum(["door", "window", "opening"]),
  offset: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  sill: z.number().min(0).default(0),
  // Doors: which end of the opening the hinge is at (seen along the wall from
  // its `from` point), and which side of the wall the door swings into.
  hinge: z.enum(["start", "end"]).default("start"),
  swing: z.enum(["left", "right"]).default("left"),
  // Joinery. Doors: single, double, sliding (on the wall face), pocket (slides
  // into the wall), folding, glass. Windows: fixed, casement, double-casement,
  // tilt-turn, sliding. Default: single door / casement window.
  style: z.enum(["single", "double", "sliding", "pocket", "folding", "glass", "fixed", "casement", "double-casement", "tilt-turn"]).optional(),
  frame: z.number().min(0).max(30).optional().describe("frame width, cm"),
  frameMaterial: z.string().optional().describe("material name or #rrggbb; default white"),
  panes: z.tuple([z.number().int().min(1).max(8), z.number().int().min(1).max(8)]).optional().describe("glazing bars: [columns, rows]"),
  // How far a hinged door leaf is drawn open in 3D, degrees (default 20).
  open: z.number().min(0).max(110).optional(),
});

export const RoomSchema = z.object({
  id,
  name: z.string(),
  polygon: z.array(point2).min(3),
  floor: z.string().optional(),
});

export const ShellSchema = z.object({
  version: z.literal(1),
  wallHeight: z.number().positive().default(260),
  walls: z.array(WallSchema).default([]),
  openings: z.array(OpeningSchema).default([]),
  rooms: z.array(RoomSchema).default([]),
});

// Cut-outs through a box or an extrusion, in its profile plane relative to
// the part's centre (for a box or vertical extrusion: plan x, y). A rectangle
// [width, depth] or a circle (radius). They go all the way through, e.g. a
// sink or hob cut-out in a worktop.
export const HoleSchema = z.union([
  z.object({ at: point2, size: point2 }),
  z.object({ at: point2, radius: z.number().positive() }),
]);

const partBase = {
  name: z.string().optional(),
  at: point3.default([0, 0, 0]),
  rotation: z.number().default(0),
  material: z.string().optional(),
  color: color.optional(),
  // Copies of the part: `count` in total, each moved by `step` [x, y, z] cm
  // from the previous one (e.g. five shelves 40 cm apart).
  repeat: z.object({ count: z.number().int().min(1).max(50), step: point3 }).optional(),
};

const axis = z.enum(["z", "x", "y"]);

export const PartSchema = z.discriminatedUnion("shape", [
  z.object({ ...partBase, shape: z.literal("box"), size: point3, radius: z.number().min(0).default(0), holes: z.array(HoleSchema).optional() }),
  // Upright by default (axis z). Lying along x or y: `height` is its length,
  // centred on `at`, resting on `at`'s z.
  z.object({ ...partBase, shape: z.literal("cylinder"), radius: z.number().positive(), height: z.number().positive(), axis: axis.default("z") }),
  z.object({ ...partBase, shape: z.literal("sphere"), radius: z.number().positive() }),
  // A ramp: full height at the back (+y), zero at the front (-y).
  z.object({ ...partBase, shape: z.literal("wedge"), size: point3 }),
  // A 2D outline (cm, relative to `at`) pushed out by `depth`. Axis z: an
  // outline on the plan (x, y) raised by `depth` (L-shaped worktops, round
  // tables). Axis y: a front view outline (x, up) `depth` deep (curved
  // headboards, arches). Axis x: a side view outline (y, up) `depth` wide.
  z.object({
    ...partBase,
    shape: z.literal("extrusion"),
    profile: z.array(point2).min(3),
    depth: z.number().positive(),
    axis: axis.default("z"),
    holes: z.array(HoleSchema).optional(),
  }),
]);

// A 3D model file in the project (always GLB; imports are converted). It is
// stretched to exactly `size` (cm: width x, depth y, height), sitting on the
// object's origin with its footprint centred there and its front facing -y.
export const ModelSchema = z.object({
  src: z.string().regex(/^assets\/[^]+\.glb$/, "model src is a .glb file under assets/"),
  size: point3,
});

// An object is built by hand from `parts`, from a built-in `template` (see
// library.ts) whose `params` set its sizes, or from a 3D `model`. Parsing fills
// in `parts` for template and model objects (a model gets one box the size of
// its bounds), so measuring and checks only ever deal with parts.
export const ObjectSchema = z
  .object({
    id,
    name: z.string(),
    position: point2,
    elevation: z.number().default(0),
    rotation: z.number().default(0),
    room: id.optional(),
    // The wall this object stands against; it moves when that wall moves.
    attachedTo: id.optional(),
    locked: z.boolean().default(false),
    notes: z.string().optional(),
    template: z.string().optional(),
    params: z.record(z.string(), z.number()).optional(),
    parts: z.array(PartSchema).min(1).optional(),
    model: ModelSchema.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.template !== undefined && !TEMPLATES_BY_ID.has(o.template)) {
      ctx.addIssue({ code: "custom", path: ["template"], message: `unknown template "${o.template}"` });
    }
    const kinds = [o.template, o.parts, o.model].filter((k) => k !== undefined).length;
    if (kinds > 1) ctx.addIssue({ code: "custom", path: ["parts"], message: "use only one of template, parts or model" });
    if (kinds === 0) ctx.addIssue({ code: "custom", path: ["parts"], message: "an object needs parts, a template or a model" });
  })
  .transform((o) => ({
    ...o,
    // Repeated parts are expanded into copies, so drawing, measuring and
    // checks see every shelf and leg.
    parts: expandRepeats(
      o.parts ??
        (o.model
          ? [PartSchema.parse({ name: "model-bounds", shape: "box", size: o.model.size })]
          : z.array(PartSchema).parse(buildTemplate(o.template!, o.params) ?? [])),
    ),
  }));

export function expandRepeats(parts: Part[]): Part[] {
  return parts.flatMap((p) => {
    if (!p.repeat || p.repeat.count <= 1) return [p];
    const { count, step } = p.repeat;
    return Array.from({ length: count }, (_, i) => ({
      ...p,
      repeat: undefined,
      at: [p.at[0] + step[0] * i, p.at[1] + step[1] * i, p.at[2] + step[2] * i] as [number, number, number],
    }));
  });
}

export const DEFAULT_SHELL = "shell.json";

// A surface finish (tiles, paint, panelling) on one side of a wall, or on a
// room's floor. Wall sides are "left"/"right" as seen walking along the wall
// from its `from` to its `to` point on the plan (north up). A finish can cover
// part of the wall: `from`/`to` along it (cm from its `from` point) and
// `bottom`/`top` heights; openings are cut out automatically.
export const FinishSchema = z.object({
  id,
  wall: id.optional(),
  side: z.enum(["left", "right"]).optional(),
  room: id.optional().describe("room id, for a floor finish"),
  surface: z.enum(["wall", "floor"]).default("wall"),
  material: z.string(),
  from: z.number().optional(),
  to: z.number().optional(),
  bottom: z.number().min(0).optional(),
  top: z.number().min(0).optional(),
}).superRefine((f, ctx) => {
  if (f.surface === "wall" && (!f.wall || !f.side)) ctx.addIssue({ code: "custom", message: "a wall finish needs wall and side" });
  if (f.surface === "floor" && !f.room) ctx.addIssue({ code: "custom", message: "a floor finish needs room" });
});

export const SceneSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  // Which walls this scene uses. Defaults to the shared shell.json; a scene
  // that changes walls (a renovation option) points at its own shells/*.json.
  shell: z
    .string()
    .regex(/^(shell\.json|shells\/[^/]+\.json)$/, 'shell is "shell.json" or "shells/<name>.json"')
    .optional(),
  objects: z.array(ObjectSchema).default([]),
  // Tiles, paint and floors chosen for this scene (an option can differ).
  finishes: z.array(FinishSchema).default([]),
});

export type Material = z.infer<typeof MaterialSchema>;
export type Tile = z.infer<typeof TileSchema>;
export type Underlay = z.infer<typeof UnderlaySchema>;
export type UnderlayDoc = z.input<typeof UnderlaySchema>;
export type Finish = z.infer<typeof FinishSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectDoc = z.input<typeof ProjectSchema>;
export type MaterialDoc = z.input<typeof MaterialSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Shell = z.infer<typeof ShellSchema>;
export type Part = z.infer<typeof PartSchema>;
export type PartInput = z.input<typeof PartSchema>;
export type Hole = z.infer<typeof HoleSchema>;
export type SceneObject = z.infer<typeof ObjectSchema>;
export type ObjectInput = z.input<typeof ObjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneDoc = z.input<typeof SceneSchema>;
export type ShellDoc = z.input<typeof ShellSchema>;

// A furniture library item (Library/<id>/item.json): an object without a
// place, to drop into any scene. Model items keep their GLB next to item.json
// as model.glb; `model.src` is then "model.glb".
// Library items are furniture (`object`) or materials such as a tile
// (`material`; a photo texture is stored next to item.json as texture.<ext>
// and referenced as "texture.<ext>").
export const LibraryItemSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  category: z.string().default("Other"),
  notes: z.string().optional(),
  material: MaterialSchema.extend({ tile: TileSchema.extend({ image: z.string().regex(/^texture\.(jpg|jpeg|png|webp)$/).optional() }).optional() }).optional(),
  object: z.object({
    elevation: z.number().optional(),
    template: z.string().optional(),
    params: z.record(z.string(), z.number()).optional(),
    parts: z.array(PartSchema).min(1).optional(),
    model: z.object({ src: z.literal("model.glb"), size: point3 }).optional(),
  }).optional(),
}).refine((i) => !!i.object !== !!i.material, "a library item has either object or material");

export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type LibraryItemDoc = z.input<typeof LibraryItemSchema>;
