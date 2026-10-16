// The Odaja project format. Keep docs/project-format.md in sync with this file:
// that document is what agents read before editing a project.
import { z } from "zod";
import { buildTemplate, TEMPLATES_BY_ID } from "./library";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase kebab-case");
const point2 = z.tuple([z.number(), z.number()]);
const point3 = z.tuple([z.number(), z.number(), z.number()]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colors are #rrggbb");

export const MaterialSchema = z.object({
  color,
  roughness: z.number().min(0).max(1).default(0.8),
  metalness: z.number().min(0).max(1).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

export const ProjectSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  units: z.literal("cm"),
  materials: z.record(z.string(), MaterialSchema).default({}),
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

const partBase = {
  name: z.string().optional(),
  at: point3.default([0, 0, 0]),
  rotation: z.number().default(0),
  material: z.string().optional(),
  color: color.optional(),
};

export const PartSchema = z.discriminatedUnion("shape", [
  z.object({ ...partBase, shape: z.literal("box"), size: point3, radius: z.number().min(0).default(0) }),
  z.object({ ...partBase, shape: z.literal("cylinder"), radius: z.number().positive(), height: z.number().positive() }),
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
    parts:
      o.parts ??
      (o.model
        ? [PartSchema.parse({ name: "model-bounds", shape: "box", size: o.model.size })]
        : z.array(PartSchema).parse(buildTemplate(o.template!, o.params) ?? [])),
  }));

export const DEFAULT_SHELL = "shell.json";

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
});

export type Material = z.infer<typeof MaterialSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Shell = z.infer<typeof ShellSchema>;
export type Part = z.infer<typeof PartSchema>;
export type PartInput = z.input<typeof PartSchema>;
export type SceneObject = z.infer<typeof ObjectSchema>;
export type ObjectInput = z.input<typeof ObjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneDoc = z.input<typeof SceneSchema>;
export type ShellDoc = z.input<typeof ShellSchema>;

// A furniture library item (Library/<id>/item.json): an object without a
// place, to drop into any scene. Model items keep their GLB next to item.json
// as model.glb; `model.src` is then "model.glb".
export const LibraryItemSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  category: z.string().default("Other"),
  notes: z.string().optional(),
  object: z.object({
    elevation: z.number().optional(),
    template: z.string().optional(),
    params: z.record(z.string(), z.number()).optional(),
    parts: z.array(PartSchema).min(1).optional(),
    model: z.object({ src: z.literal("model.glb"), size: point3 }).optional(),
  }),
});

export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type LibraryItemDoc = z.input<typeof LibraryItemSchema>;
