// The Odaja project format. Keep docs/project-format.md in sync with this file:
// that document is what agents read before editing a project.
import { z } from "zod";

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

export const ObjectSchema = z.object({
  id,
  name: z.string(),
  position: point2,
  elevation: z.number().default(0),
  rotation: z.number().default(0),
  room: id.optional(),
  locked: z.boolean().default(false),
  notes: z.string().optional(),
  parts: z.array(PartSchema).min(1),
});

export const SceneSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  objects: z.array(ObjectSchema).default([]),
});

export type Material = z.infer<typeof MaterialSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Shell = z.infer<typeof ShellSchema>;
export type Part = z.infer<typeof PartSchema>;
export type SceneObject = z.infer<typeof ObjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneDoc = z.input<typeof SceneSchema>;
