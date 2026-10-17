// Odaja's tools for AI models: read the design, change it, measure it, check
// it, look at it. One implementation serves every connection: the in-app
// chat (any provider), Claude Code through the MCP server, and anything else
// that speaks MCP. Tools edit the project files; the open app picks the
// changes up live (and can undo them).
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { followWalls } from "../src/model/attach";
import { formatJson } from "../src/model/format";
import { clearances, objectFootprint, polygonArea, rectEdges, roomAt, roomClearSize, shellBounds, wallEdges, type Vec } from "../src/model/geometry";
import { issuesFor } from "../src/model/issues";
import { TEMPLATES, TEMPLATES_BY_ID, templateParams } from "../src/model/library";
import { addObject, deleteObject, setObjectProps, setTemplateParams, uniqueId, type ObjectDoc } from "../src/model/operations";
import { enclosedArea } from "../src/model/rooms";
import {
  DEFAULT_SHELL,
  LibraryItemSchema,
  MaterialSchema,
  TILE_PATTERNS,
  ObjectSchema,
  PartSchema,
  ProjectSchema,
  SceneSchema,
  ShellSchema,
  type SceneDoc,
  type ShellDoc,
} from "../src/model/schema";
import {
  addOpening,
  addRoom,
  addWalls,
  deleteOpening,
  deleteRoom,
  deleteWall,
  moveWall,
  setWallLength,
  updateOpening,
  updateRoom,
  updateWall,
} from "../src/model/shellOps";
import { slugify } from "../src/model/defaults";
import { quantities } from "../src/model/finishes";
import { addFinish, clearRoomWalls, finishRoomWalls, removeFinishes, setRoomFloor } from "../src/model/finishOps";
import { compactPart } from "../src/model/partOps";
import { createHash } from "node:crypto";
import { adjust, autoColor, crop, decode, encodeJpeg, fit, getEdit, rectify, rotate, seamless, storeEdit, type Raster } from "./photos";

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolContext {
  projectDir(): string | null;
  scenePath(): string | null; // the scene open in the app
  libraryRoot: string;
  screenshot(view: "plan" | "3d"): Promise<{ data: string; mimeType: string }>;
  openScene(path: string): void;
  // Photos shared in the chat this tool call comes from (photo-1, photo-2, …),
  // if it comes from an Odaja chat.
  photos?(): Promise<{ mimeType: string; data: string }[]>;
  // The object whose shape the user is editing in the app, if any.
  editingObject?(): string | null;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult | string | object>;
}

const tool = <S extends z.ZodType>(def: ToolDef<S>) => def as unknown as ToolDef;

// Plain arrays rather than tuples in tool schemas: some providers (e.g.
// Gemini) don't accept tuple JSON Schema.
const vec2 = z.array(z.number()).length(2).describe("[x, y] in cm on the plan (x east, y south)");
const vec3 = z.array(z.number()).length(3);
const toolPart = z
  .object({
    shape: z.enum(["box", "cylinder", "sphere", "wedge", "extrusion"]),
    size: vec3.optional().describe("box, wedge: [width x, depth y, height] cm (a wedge is full height at the back +y, zero at the front)"),
    radius: z.number().optional().describe("box: corner rounding; cylinder, sphere: radius (cm)"),
    height: z.number().optional().describe("cylinder height, or length when lying (cm)"),
    axis: z.enum(["z", "x", "y"]).optional().describe("cylinder: z upright (default), x/y lying. extrusion: z = outline on the plan (x, y) raised by depth; y = front outline (x, up) pushed back by depth; x = side outline (y, up) pushed across by depth"),
    profile: z.array(z.array(z.number()).length(2)).optional().describe("extrusion outline points, cm, relative to `at`"),
    depth: z.number().optional().describe("extrusion thickness, cm"),
    holes: z
      .array(z.object({ at: vec2.describe("centre, in the outline's plane"), size: vec2.optional().describe("rectangle [w, d]"), radius: z.number().optional().describe("circle") }))
      .optional()
      .describe("box or extrusion: cut-outs all the way through (sinks, hobs, cable holes)"),
    repeat: z.object({ count: z.number().int().min(1).max(50), step: vec3 }).optional().describe("copies in total and the step [x, y, z] cm between them"),
    at: vec3.optional().describe("[x, y, z_bottom] relative to the object origin; default [0, 0, 0]"),
    rotation: z.number().optional(),
    material: z.string().optional(),
    color: z.string().optional().describe("#rrggbb"),
    name: z.string().optional(),
  })
  .describe("A part: box, cylinder, sphere, wedge or extrusion (custom outline)");
const toParts = (parts: z.infer<typeof toolPart>[]) =>
  parts.map((p, i) => {
    const r = PartSchema.safeParse(p);
    if (!r.success) throw new ToolError(`part ${i}: ${r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
    return p as z.input<typeof PartSchema>;
  });
const sceneArg = z.string().optional().describe('Scene file, e.g. "scenes/current.json". Default: the scene open in the app.');

class ToolError extends Error {}

// --- file helpers ---------------------------------------------------------

function projectPath(ctx: ToolContext, rel: string) {
  const dir = ctx.projectDir();
  if (!dir) throw new ToolError("No project is open in Odaja. Ask the user to open one.");
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(dir + path.sep)) throw new ToolError(`path escapes the project: ${rel}`);
  return abs;
}

async function readJson(ctx: ToolContext, rel: string): Promise<unknown> {
  const text = await fs.readFile(projectPath(ctx, rel), "utf8").catch(() => {
    throw new ToolError(`file not found: ${rel}`);
  });
  return JSON.parse(text);
}

async function writeJson(ctx: ToolContext, rel: string, doc: unknown) {
  const abs = projectPath(ctx, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, formatJson(doc));
}

async function listScenes(ctx: ToolContext): Promise<string[]> {
  const files = await fs.readdir(projectPath(ctx, "scenes")).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json")).map((f) => `scenes/${f}`).sort();
}

async function resolveScene(ctx: ToolContext, scene?: string): Promise<string> {
  if (scene) {
    const rel = scene.startsWith("scenes/") ? scene : `scenes/${scene.replace(/\.json$/, "")}.json`;
    if (!(await listScenes(ctx)).includes(rel)) throw new ToolError(`no such scene: ${scene}`);
    return rel;
  }
  const open = ctx.scenePath();
  if (open) return open;
  const first = (await listScenes(ctx))[0];
  if (!first) throw new ToolError("the project has no scenes");
  return first;
}

async function loadScene(ctx: ToolContext, scene?: string) {
  const rel = await resolveScene(ctx, scene);
  const doc = (await readJson(ctx, rel)) as SceneDoc;
  const parsed = SceneSchema.safeParse(doc);
  if (!parsed.success) throw new ToolError(`${rel} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const shellRel = parsed.data.shell ?? DEFAULT_SHELL;
  const shellDoc = (await readJson(ctx, shellRel)) as ShellDoc;
  const shell = ShellSchema.parse(shellDoc);
  return { rel, doc, scene: parsed.data, shellRel, shellDoc, shell };
}

async function changeScene(ctx: ToolContext, scene: string | undefined, change: (doc: SceneDoc) => SceneDoc) {
  const loaded = await loadScene(ctx, scene);
  const next = change(loaded.doc);
  const check = SceneSchema.safeParse(next);
  if (!check.success) throw new ToolError(`that change would make the scene invalid: ${check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (next !== loaded.doc) await writeJson(ctx, loaded.rel, next);
  return { ...loaded, doc: next, scene: check.data };
}

// Change the walls of a scene's shell; attached furniture follows in every
// scene that uses the same shell (like editing walls in the app).
async function changeShell(ctx: ToolContext, scene: string | undefined, change: (doc: ShellDoc) => ShellDoc) {
  const loaded = await loadScene(ctx, scene);
  const next = change(loaded.shellDoc);
  if (next === loaded.shellDoc) throw new ToolError("nothing changed (the edit was not possible, e.g. an opening that doesn't fit or a wall that would be too short)");
  const shell = ShellSchema.parse(next);
  await writeJson(ctx, loaded.shellRel, next);
  for (const rel of await listScenes(ctx)) {
    try {
      const doc = (await readJson(ctx, rel)) as SceneDoc;
      if ((doc.shell ?? DEFAULT_SHELL) !== loaded.shellRel) continue;
      const followed = followWalls(doc, loaded.shell, shell);
      if (followed !== doc) await writeJson(ctx, rel, followed);
    } catch {
      // Unreadable scene: leave it.
    }
  }
  return { ...loaded, shellDoc: next, shell };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function describeObject(o: ReturnType<typeof SceneSchema.parse>["objects"][number]) {
  const f = objectFootprint(o);
  return {
    id: o.id,
    name: o.name,
    position: o.position,
    rotation: o.rotation,
    elevation: o.elevation || undefined,
    footprint: { width: r1(f.maxX - f.minX), depth: r1(f.maxY - f.minY), minX: r1(f.minX), minY: r1(f.minY), maxX: r1(f.maxX), maxY: r1(f.maxY) },
    kind: o.model ? "model" : o.template ? `template:${o.template}` : "parts",
    params: o.params,
    room: o.room,
    attachedTo: o.attachedTo,
    locked: o.locked || undefined,
    notes: o.notes,
  };
}

// Joinery settings shared by add_opening and update_opening.
const joineryArgs = {
  style: z
    .enum(["single", "double", "sliding", "pocket", "folding", "glass", "fixed", "casement", "double-casement", "tilt-turn"])
    .optional()
    .describe("doors: single, double, sliding, pocket, folding, glass; windows: casement, double-casement, tilt-turn, sliding, fixed"),
  frame: z.number().min(0).max(30).optional().describe("frame width, cm"),
  frame_material: z.string().optional().describe("material name or #rrggbb"),
  panes: z.array(z.number().int().min(1).max(8)).length(2).optional().describe("glazing bars [columns, rows]"),
  open: z.number().min(0).max(110).optional().describe("how far a hinged door is drawn open, degrees"),
};

const tileArgs = z.object({
  size: vec2.describe("[width, height] of one tile, cm; for a photo texture, how much surface the image shows"),
  grout: z.number().min(0).max(5).optional().describe("joint width, cm (default 0.2)"),
  grout_color: z.string().optional().describe("#rrggbb"),
  pattern: z.enum(TILE_PATTERNS).optional().describe("grid, brick (½ offset), third (⅓ offset), vertical, herringbone (planks), diagonal (square tiles)"),
  variation: z.number().min(0).max(1).optional().describe("colour variation between tiles, 0..1"),
});

// A photo from the chat ("photo-2") or an earlier edit ("edit-1").
async function loadPicture(ctx: ToolContext, ref: string): Promise<Raster> {
  const edit = getEdit(ref);
  if (edit) return edit;
  const m = /^photo-(\d+)$/.exec(ref);
  if (!m) throw new ToolError(`"${ref}" isn't a photo (photo-1, photo-2, …) or an edit (edit-1, …)`);
  const photos = ctx.photos ? await ctx.photos() : [];
  const photo = photos[Number(m[1]) - 1];
  if (!photo) throw new ToolError(photos.length ? `there's no ${ref}; this chat has ${photos.length} photo(s)` : "no photos are available here; photos must be shared in Odaja's chat");
  return decode(photo.data);
}

const fraction = z.array(z.number().min(0).max(1)).length(2);

async function readProject(ctx: ToolContext) {
  return (await readJson(ctx, "project.json")) as { materials?: Record<string, unknown> } & Record<string, unknown>;
}

// --- tools ----------------------------------------------------------------

export const TOOLS: ToolDef[] = [
  tool({
    name: "get_overview",
    description:
      "Start here. Summary of the open project and scene: rooms with clear sizes and areas, walls, doors and windows, every object with its footprint, and current issues. Units are cm on a top-down plan: x east, y south; rotation in degrees clockwise from above, 0 = object's front faces north.",
    input: z.object({ scene: sceneArg }),
    async run({ scene }, ctx) {
      const { rel, scene: s, shell, shellRel } = await loadScene(ctx, scene);
      const project = ProjectSchema.parse(await readJson(ctx, "project.json"));
      const edges = wallEdges(shell);
      const b = shellBounds(shell);
      return {
        project: project.name,
        scene: { file: rel, name: s.name, description: s.description, shell: shellRel },
        scenes: await listScenes(ctx),
        flatOutline: b && { minX: r1(b.minX), minY: r1(b.minY), maxX: r1(b.maxX), maxY: r1(b.maxY) },
        rooms: shell.rooms.map((r) => {
          const size = roomClearSize(r, edges);
          return { id: r.id, name: r.name, polygon: r.polygon, clearWidth: size && r1(size.width), clearDepth: size && r1(size.depth), areaM2: r1(polygonArea(r.polygon) / 10000) };
        }),
        walls: shell.walls.map((w) => ({ id: w.id, from: w.from, to: w.to, thickness: w.thickness })),
        openings: shell.openings.map((o) => ({ id: o.id, wall: o.wall, type: o.type, offset: o.offset, width: o.width, height: o.height, sill: o.sill || undefined, hinge: o.type === "door" ? o.hinge : undefined, swing: o.type === "door" ? o.swing : undefined })),
        objects: s.objects.map(describeObject),
        editingShape: ctx.editingObject?.() ?? undefined,
        finishes: s.finishes,
        materials: Object.fromEntries(
          Object.entries(project.materials).map(([k, m]) => [k, m.tile ? `${m.color} tiles ${m.tile.size[0]}×${m.tile.size[1]} ${m.tile.pattern}${m.tile.image ? " (photo)" : ""}` : m.color]),
        ),
        issues: issuesFor(s, shell).map((i) => `${i.severity}: ${i.message}`),
      };
    },
  }),

  tool({
    name: "read_file",
    description: "Read a project file as JSON: project.json, shell.json, shells/<name>.json or scenes/<name>.json. Use when you need exact parts or the full format.",
    input: z.object({ file: z.string().describe('e.g. "shell.json" or "scenes/current.json"') }),
    async run({ file }, ctx) {
      if (!/^(project\.json|shell\.json|shells\/[^/]+\.json|scenes\/[^/]+\.json)$/.test(file)) throw new ToolError("only project.json, shell.json, shells/*.json and scenes/*.json can be read");
      return formatJson(await readJson(ctx, file));
    },
  }),

  tool({
    name: "list_templates",
    description: "Built-in furniture templates (kitchen units, tables, beds, toilets…) with their size parameters and defaults. Prefer these over hand-built parts when one fits.",
    input: z.object({}),
    async run() {
      return TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, params: Object.fromEntries(t.params.map((p) => [p.key, p.default])), elevation: t.elevation }));
    },
  }),

  tool({
    name: "list_library",
    description: "The user's own furniture library (shared by all projects): items they saved or imported. Place one with add_object's library_item.",
    input: z.object({}),
    async run(_input, ctx) {
      const entries = await fs.readdir(ctx.libraryRoot, { withFileTypes: true }).catch(() => []);
      const items = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        try {
          const item = LibraryItemSchema.parse(JSON.parse(await fs.readFile(path.join(ctx.libraryRoot, e.name, "item.json"), "utf8")));
          const o = item.object;
          if (!o) {
            items.push({ id: e.name, name: item.name, category: item.category, notes: item.notes, kind: "material", tile: item.material?.tile });
            continue;
          }
          items.push({ id: e.name, name: item.name, category: item.category, notes: item.notes, kind: o.model ? "model" : o.template ? `template:${o.template}` : "parts", size: o.model?.size, params: o.params });
        } catch {
          // Skip broken items.
        }
      }
      return items;
    },
  }),

  tool({
    name: "add_object",
    description:
      "Add furniture to a scene. Give exactly one of: template (+ params), library_item, or parts. Parts are boxes/cylinders relative to the object's origin (centre of footprint); front faces -y (north) at rotation 0, back +y. Box part: { shape: 'box', size: [w, d, h], at: [x, y, z_bottom], material?, color?, radius? }. Cylinder: { shape: 'cylinder', radius, height, at }. Set attached_to to a wall id for things standing against a wall (back touching the wall face) so they move with it.",
    input: z.object({
      scene: sceneArg,
      name: z.string(),
      position: vec2,
      rotation: z.number().optional().describe("degrees clockwise from above; 0 = front faces north"),
      elevation: z.number().optional().describe("cm above the floor, e.g. wall cabinets"),
      template: z.string().optional(),
      params: z.record(z.string(), z.number()).optional(),
      library_item: z.string().optional().describe("id from list_library"),
      parts: z.array(toolPart).optional(),
      attached_to: z.string().optional(),
      notes: z.string().optional(),
    }),
    async run(input, ctx) {
      const kinds = [input.template, input.library_item, input.parts].filter((k) => k !== undefined).length;
      if (kinds !== 1) throw new ToolError("give exactly one of template, library_item or parts");
      let fields: Partial<ObjectDoc> = {};
      if (input.template) {
        const t = TEMPLATES_BY_ID.get(input.template);
        if (!t) throw new ToolError(`unknown template "${input.template}"; see list_templates`);
        fields = { template: t.id, params: templateParams(t, input.params), elevation: input.elevation ?? t.elevation };
      } else if (input.library_item) {
        const dir = path.join(ctx.libraryRoot, input.library_item);
        const item = LibraryItemSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8").catch(() => {
          throw new ToolError(`no library item "${input.library_item}"`);
        })));
        const o = item.object;
        if (!o) throw new ToolError(`"${input.library_item}" is a material, not furniture; use add_material_from_library`);
        let model;
        if (o.model) {
          const data = await fs.readFile(path.join(dir, "model.glb"));
          const src = `assets/models/${input.library_item}-${createHash("sha256").update(data).digest("hex").slice(0, 8)}.glb`;
          const abs = projectPath(ctx, src);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          if (!(await fs.stat(abs).catch(() => null))) await fs.writeFile(abs, data);
          model = { src, size: o.model.size };
        }
        fields = { template: o.template, params: o.params, parts: o.parts, model, elevation: input.elevation ?? o.elevation, notes: input.notes ?? item.notes };
      } else {
        fields = { parts: toParts(input.parts!), elevation: input.elevation };
      }
      const result = await changeScene(ctx, input.scene, (doc) => {
        const id = uniqueId(doc, slugify(input.name).replace(/[^a-z0-9-]/g, "") || "object");
        return addObject({
          id,
          name: input.name,
          ...fields,
          position: input.position as [number, number],
          rotation: input.rotation || undefined,
          attachedTo: input.attached_to,
          notes: fields.notes ?? input.notes,
        } as ObjectDoc)(doc);
      });
      const added = result.scene.objects.at(-1)!;
      // Record the room it landed in.
      const room = roomAt(result.shell, added.position);
      if (room) await changeScene(ctx, input.scene, setObjectProps(added.id, { room }));
      return { added: describeObject({ ...added, room }), issues: issuesFor(result.scene, result.shell).filter((i) => i.targets.some((t) => t.id === added.id)).map((i) => i.message) };
    },
  }),

  tool({
    name: "update_object",
    description: "Change an object: move (position), turn (rotation), raise (elevation), rename, resize a template object (params), replace its parts, attach to / detach from a wall (attached_to: wall id or null), notes, locked.",
    input: z.object({
      scene: sceneArg,
      id: z.string(),
      name: z.string().optional(),
      position: vec2.optional(),
      rotation: z.number().optional(),
      elevation: z.number().optional(),
      params: z.record(z.string(), z.number()).optional(),
      parts: z.array(toolPart).optional(),
      attached_to: z.string().nullable().optional(),
      notes: z.string().optional(),
      locked: z.boolean().optional(),
    }),
    async run(input, ctx) {
      const result = await changeScene(ctx, input.scene, (doc) => {
        const current = doc.objects?.find((o) => o.id === input.id);
        if (!current) throw new ToolError(`no object "${input.id}"`);
        let next = setObjectProps(input.id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.position ? { position: [r1(input.position[0]), r1(input.position[1])] as [number, number] } : {}),
          ...(input.rotation !== undefined ? { rotation: ((input.rotation % 360) + 360) % 360 || undefined } : {}),
          ...(input.elevation !== undefined ? { elevation: input.elevation || undefined } : {}),
          ...(input.parts ? { parts: toParts(input.parts), template: undefined, params: undefined } : {}),
          ...(input.attached_to !== undefined ? { attachedTo: input.attached_to ?? undefined } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || undefined } : {}),
          ...(input.locked !== undefined ? { locked: input.locked || undefined } : {}),
        })(doc);
        if (input.params) {
          if (!current.template) throw new ToolError("params only apply to template objects");
          next = setTemplateParams(input.id, input.params)(next);
        }
        return next;
      });
      const o = result.scene.objects.find((x) => x.id === input.id)!;
      return { updated: describeObject(o), issues: issuesFor(result.scene, result.shell).filter((i) => i.targets.some((t) => t.id === o.id)).map((i) => i.message) };
    },
  }),

  tool({
    name: "edit_parts",
    description:
      "Change an object's parts one at a time (useful while the user is editing its shape; get_overview's editingShape names that object, read_file shows its parts with their indexes). Actions: add (part), update (index + part fields to change), remove (index). Template objects are turned into parts first.",
    input: z.object({
      scene: sceneArg,
      id: z.string(),
      action: z.enum(["add", "update", "remove"]),
      index: z.number().int().min(0).optional(),
      part: toolPart.partial().optional(),
    }),
    async run({ scene, id, action, index, part }, ctx) {
      const result = await changeScene(ctx, scene, (doc) => {
        const o = doc.objects?.find((x) => x.id === id);
        if (!o) throw new ToolError(`no object "${id}"`);
        if (o.model) throw new ToolError("imported 3D models have no parts to edit");
        let parts = o.parts;
        if (!parts) {
          // Template object: switch it to its parts.
          const parsed = SceneSchema.parse(doc).objects.find((x) => x.id === id)!;
          parts = parsed.parts.map(compactPart);
        }
        if (action === "add") {
          if (!part?.shape) throw new ToolError("give part with a shape");
          parts = [...parts, toParts([part as z.infer<typeof toolPart>])[0]];
        } else {
          if (index === undefined || !parts[index]) throw new ToolError(`no part ${index}; the object has ${parts.length}`);
          if (action === "remove") {
            if (parts.length === 1) throw new ToolError("an object needs at least one part");
            parts = parts.filter((_, i) => i !== index);
          } else {
            const merged = Object.fromEntries(Object.entries({ ...parts[index], ...part }).filter(([, v]) => v !== undefined));
            parts = parts.map((p, i) => (i === index ? toParts([merged as z.infer<typeof toolPart>])[0] : p));
          }
        }
        return { ...doc, objects: (doc.objects ?? []).map((x) => (x.id === id ? Object.fromEntries(Object.entries({ ...x, template: undefined, params: undefined, parts }).filter(([, v]) => v !== undefined)) as unknown as typeof x : x)) };
      });
      const o = result.doc.objects?.find((x) => x.id === id);
      return { parts: o?.parts?.map((p, i) => ({ index: i, ...p })) };
    },
  }),

  tool({
    name: "delete_object",
    description: "Remove an object from a scene.",
    input: z.object({ scene: sceneArg, id: z.string() }),
    async run({ scene, id }, ctx) {
      await changeScene(ctx, scene, (doc) => {
        if (!doc.objects?.some((o) => o.id === id)) throw new ToolError(`no object "${id}"`);
        return deleteObject(id)(doc);
      });
      return `deleted ${id}`;
    },
  }),

  tool({
    name: "measure_object",
    description: "Exact footprint of an object and the free distance from each side (west/east/north/south) to the nearest wall face or other object.",
    input: z.object({ scene: sceneArg, id: z.string() }),
    async run({ scene, id }, ctx) {
      const { scene: s, shell } = await loadScene(ctx, scene);
      const o = s.objects.find((x) => x.id === id);
      if (!o) throw new ToolError(`no object "${id}"`);
      const r = objectFootprint(o);
      const edges = [...wallEdges(shell), ...s.objects.filter((x) => x.id !== id).flatMap((x) => rectEdges(objectFootprint(x)))];
      const c = clearances(r, edges);
      const v = (n: number | null) => (n === null ? null : r1(n));
      return { ...describeObject(o), freeSpace: { west: v(c.left), east: v(c.right), north: v(c.up), south: v(c.down) } };
    },
  }),

  tool({
    name: "check_issues",
    description: "Design checks for a scene: furniture in walls, overlaps, blocked doors, too little space in front of fixtures, misplaced openings.",
    input: z.object({ scene: sceneArg }),
    async run({ scene }, ctx) {
      const { scene: s, shell } = await loadScene(ctx, scene);
      const issues = issuesFor(s, shell);
      return issues.length ? issues.map((i) => ({ severity: i.severity, message: i.message, targets: i.targets, quickFix: i.fix?.label })) : "No issues.";
    },
  }),

  tool({
    name: "screenshot",
    description: "See the scene as the user does: 'plan' is a to-scale top view, '3d' a perspective view. Use it to check your work visually.",
    input: z.object({ view: z.enum(["plan", "3d"]).default("plan") }),
    async run({ view }, ctx) {
      const shot = await ctx.screenshot(view);
      return { content: [{ type: "image", data: shot.data, mimeType: shot.mimeType }, { type: "text", text: `Screenshot of the ${view} view.` }] };
    },
  }),

  tool({
    name: "add_wall",
    description: "Add a straight wall between two plan points (wall centreline). Typical thickness: 25 outer, 12 inner. Walls apply to every scene sharing this scene's shell.",
    input: z.object({ scene: sceneArg, from: vec2, to: vec2, thickness: z.number().positive().default(12) }),
    async run({ scene, from, to, thickness }, ctx) {
      const before = new Set((await loadScene(ctx, scene)).shell.walls.map((w) => w.id));
      const { shell } = await changeShell(ctx, scene, addWalls([from as Vec, to as Vec], thickness));
      return { added: shell.walls.filter((w) => !before.has(w.id)) };
    },
  }),

  tool({
    name: "update_wall",
    description: "Change a wall: slide it sideways (move: [dx, dy] cm; walls joined to it stretch along), set its length (moves its 'to' end), thickness or height.",
    input: z.object({
      scene: sceneArg,
      id: z.string(),
      move: vec2.optional(),
      length: z.number().positive().optional(),
      thickness: z.number().positive().optional(),
      height: z.number().positive().optional(),
    }),
    async run({ scene, id, move, length, thickness, height }, ctx) {
      const { shell } = await changeShell(ctx, scene, (doc) => {
        if (!doc.walls?.some((w) => w.id === id)) throw new ToolError(`no wall "${id}"`);
        let next = doc;
        if (move) next = moveWall(id, move as Vec)(next);
        if (length) next = setWallLength(id, length)(next);
        if (thickness || height) next = updateWall(id, { ...(thickness ? { thickness } : {}), ...(height ? { height } : {}) })(next);
        return next;
      });
      return { wall: shell.walls.find((w) => w.id === id) };
    },
  }),

  tool({
    name: "delete_wall",
    description: "Remove a wall (and its doors/windows).",
    input: z.object({ scene: sceneArg, id: z.string() }),
    async run({ scene, id }, ctx) {
      await changeShell(ctx, scene, deleteWall(id));
      return `deleted ${id}`;
    },
  }),

  tool({
    name: "add_opening",
    description: "Add a door, window or plain opening to a wall. offset = cm along the wall from its 'from' point to the opening's near edge. It is kept clear of corners and other openings (moved to the nearest place that fits).",
    input: z.object({
      scene: sceneArg,
      wall: z.string(),
      type: z.enum(["door", "window", "opening"]),
      offset: z.number().min(0),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      sill: z.number().min(0).optional(),
      ...joineryArgs,
    }),
    async run({ scene, wall, type, offset, width, height, sill, style, frame, frame_material, panes, open }, ctx) {
      const before = new Set((await loadScene(ctx, scene)).shell.openings.map((o) => o.id));
      const { shell } = await changeShell(ctx, scene, (doc) => {
        const next = addOpening(wall, type, offset, { ...(width ? { width } : {}), ...(height ? { height } : {}), ...(sill !== undefined ? { sill } : {}) })(doc);
        const added = (next.openings ?? []).find((o) => !before.has(o.id));
        if (!added) return next;
        const extra = Object.fromEntries(Object.entries({ style, frame, frameMaterial: frame_material, panes, open }).filter(([, v]) => v !== undefined));
        return Object.keys(extra).length ? updateOpening(added.id, extra)(next) : next;
      });
      return { added: shell.openings.filter((o) => !before.has(o.id)) };
    },
  }),

  tool({
    name: "update_opening",
    description: "Change a door/window: offset, width, height, sill, type, hinge ('start'|'end') or swing ('left'|'right').",
    input: z.object({
      scene: sceneArg,
      id: z.string(),
      offset: z.number().min(0).optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      sill: z.number().min(0).optional(),
      type: z.enum(["door", "window", "opening"]).optional(),
      hinge: z.enum(["start", "end"]).optional(),
      swing: z.enum(["left", "right"]).optional(),
      ...joineryArgs,
    }),
    async run({ scene, id, frame_material, ...patch }, ctx) {
      if (frame_material !== undefined) Object.assign(patch, { frameMaterial: frame_material });
      const { shell } = await changeShell(ctx, scene, updateOpening(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))));
      return { opening: shell.openings.find((o) => o.id === id) };
    },
  }),

  tool({
    name: "delete_opening",
    description: "Remove a door, window or opening.",
    input: z.object({ scene: sceneArg, id: z.string() }),
    async run({ scene, id }, ctx) {
      await changeShell(ctx, scene, deleteOpening(id));
      return `deleted ${id}`;
    },
  }),

  tool({
    name: "set_room",
    description: "Create, rename, refloor or delete a room. To create, give a point inside an area enclosed by walls (inside_point) or an explicit polygon.",
    input: z.object({
      scene: sceneArg,
      id: z.string().optional().describe("existing room to change; omit to create"),
      name: z.string().optional(),
      floor: z.string().optional().describe("material name"),
      inside_point: vec2.optional(),
      polygon: z.array(vec2).optional(),
      delete: z.boolean().optional(),
    }),
    async run(input, ctx) {
      if (input.id) {
        const id = input.id;
        await changeShell(ctx, input.scene, input.delete ? deleteRoom(id) : updateRoom(id, { ...(input.name ? { name: input.name } : {}), ...(input.floor ? { floor: input.floor } : {}) }));
        return input.delete ? `deleted ${id}` : `updated ${id}`;
      }
      let polygon = input.polygon as Vec[] | undefined;
      if (!polygon && input.inside_point) {
        polygon = enclosedArea((await loadScene(ctx, input.scene)).shell, input.inside_point as Vec) ?? undefined;
        if (!polygon) throw new ToolError("that point is not inside an area enclosed by walls");
      }
      if (!polygon) throw new ToolError("give inside_point or polygon");
      const { shell } = await changeShell(ctx, input.scene, addRoom(polygon, input.name, input.floor));
      return { added: shell.rooms.at(-1) };
    },
  }),

  tool({
    name: "set_material",
    description:
      "Create or change a project material (by name): paint colour, roughness (0 glossy … 1 matt), or tiles/planks drawn by Odaja (size, grout, pattern, colour variation). Tiles use `color` as the tile colour. Pass tile: null to make it plain again. Photo textures are made with save_texture.",
    input: z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase-kebab name"),
      color: z.string().optional().describe("#rrggbb"),
      roughness: z.number().min(0).max(1).optional(),
      tile: tileArgs.nullable().optional(),
    }),
    async run({ name, color, roughness, tile }, ctx) {
      const project = await readProject(ctx);
      const current = (project.materials?.[name] ?? { color: "#e9e6e1" }) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...current };
      if (color) next.color = color;
      if (roughness !== undefined) next.roughness = roughness;
      if (tile === null) delete next.tile;
      else if (tile) {
        const prev = (current.tile ?? {}) as Record<string, unknown>;
        next.tile = Object.fromEntries(
          Object.entries({ ...prev, size: tile.size, grout: tile.grout ?? prev.grout, groutColor: tile.grout_color ?? prev.groutColor, pattern: tile.pattern ?? prev.pattern, variation: tile.variation ?? prev.variation }).filter(([, v]) => v !== undefined),
        );
      }
      const check = MaterialSchema.safeParse(next);
      if (!check.success) throw new ToolError(check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      await writeJson(ctx, "project.json", { ...project, materials: { ...(project.materials ?? {}), [name]: next } });
      return { material: name, ...next };
    },
  }),

  tool({
    name: "set_finish",
    description:
      "Put a finish (tiles, paint, panelling: a material name) on surfaces of the scene. surface 'room_walls' covers every wall side facing a room (e.g. bathroom tiles up to top=200), 'floor' sets a room's floor, 'wall' one side of one wall ('left'/'right' as seen walking from the wall's from to its to point; get_overview shows rooms and walls). Heights are cm from the floor; from/to are cm along the wall. Doors and windows are cut out. Replaces earlier finishes on the same surfaces.",
    input: z.object({
      scene: sceneArg,
      surface: z.enum(["room_walls", "floor", "wall"]),
      material: z.string(),
      room: z.string().optional().describe("for room_walls and floor"),
      wall: z.string().optional(),
      side: z.enum(["left", "right"]).optional(),
      bottom: z.number().min(0).optional(),
      top: z.number().min(0).optional(),
      from: z.number().optional(),
      to: z.number().optional(),
    }),
    async run(input, ctx) {
      const project = await readProject(ctx);
      if (!project.materials?.[input.material]) throw new ToolError(`no material "${input.material}"; create it with set_material first`);
      const loaded = await loadScene(ctx, input.scene);
      const result = await changeScene(ctx, input.scene, (doc) => {
        if (input.surface === "floor") {
          if (!input.room) throw new ToolError("give room");
          return setRoomFloor(input.room, input.material)(doc);
        }
        if (input.surface === "room_walls") {
          if (!loaded.shell.rooms.some((r) => r.id === input.room)) throw new ToolError(`no room "${input.room}"`);
          return finishRoomWalls(loaded.shell, input.room!, input.material, input.bottom ?? 0, input.top)(doc);
        }
        if (!input.wall || !input.side) throw new ToolError("give wall and side");
        const sameSide = (doc.finishes ?? []).filter((f) => f.wall === input.wall && f.side === input.side && (f.from ?? -Infinity) < (input.to ?? Infinity) && (f.to ?? Infinity) > (input.from ?? -Infinity)).map((f) => f.id);
        return addFinish({ surface: "wall", wall: input.wall, side: input.side, material: input.material, bottom: input.bottom, top: input.top, from: input.from, to: input.to })(removeFinishes(sameSide)(doc));
      });
      return { finishes: result.scene.finishes };
    },
  }),

  tool({
    name: "remove_finish",
    description: "Remove finishes: one by id, all wall finishes of a room (room), or a room's floor finish (room + floor: true).",
    input: z.object({ scene: sceneArg, id: z.string().optional(), room: z.string().optional(), floor: z.boolean().optional() }),
    async run({ scene, id, room, floor }, ctx) {
      const loaded = await loadScene(ctx, scene);
      await changeScene(ctx, scene, (doc) => {
        if (id) return removeFinishes([id])(doc);
        if (room && floor) return setRoomFloor(room, null)(doc);
        if (room) return clearRoomWalls(loaded.shell, room)(doc);
        throw new ToolError("give id or room");
      });
      return "removed";
    },
  }),

  tool({
    name: "get_quantities",
    description: "What to buy for the scene's finishes: area per surface and material, and tile counts including 10% for cuts.",
    input: z.object({ scene: sceneArg }),
    async run({ scene }, ctx) {
      const { scene: s, shell } = await loadScene(ctx, scene);
      const project = ProjectSchema.parse(await readJson(ctx, "project.json"));
      const lines = quantities(s, shell, project.materials);
      return lines.length ? lines : "This scene has no finishes yet.";
    },
  }),

  tool({
    name: "add_material_from_library",
    description: "Copy a material (e.g. a tile the user saved) from the user's library into this project, so finishes can use it. Returns the material's name in the project.",
    input: z.object({ item: z.string().describe("library item id from list_library (kind: material)") }),
    async run({ item }, ctx) {
      const dir = path.join(ctx.libraryRoot, item);
      const parsed = LibraryItemSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8").catch(() => {
        throw new ToolError(`no library item "${item}"`);
      })));
      if (!parsed.material) throw new ToolError(`"${item}" is furniture, not a material`);
      const material = structuredClone(parsed.material) as Record<string, unknown> & { tile?: { image?: string } };
      if (material.tile?.image) {
        const rel = `assets/textures/${item}${path.extname(material.tile.image)}`;
        await fs.mkdir(path.dirname(projectPath(ctx, rel)), { recursive: true });
        await fs.copyFile(path.join(dir, material.tile.image), projectPath(ctx, rel));
        material.tile.image = rel;
      }
      const project = await readProject(ctx);
      let name = item;
      for (let n = 2; project.materials?.[name]; n++) name = `${item}-${n}`;
      await writeJson(ctx, "project.json", { ...project, materials: { ...(project.materials ?? {}), [name]: material } });
      return { material: name };
    },
  }),

  tool({
    name: "edit_photo",
    description:
      "Prepare part of a photo from the chat as a texture (e.g. a tile) before keeping it. Positions are fractions of the image (0..1, x right, y down). Steps run in this order: rotate, then corners (straighten a surface photographed at an angle: its four corners clockwise from top-left) or crop [x, y, width, height], then auto_color (remove colour casts, even out levels), brightness/contrast (-1..1), seamless (blend edges so it repeats). Returns a preview and an edit id; check the preview, adjust if needed, then save_texture. Nothing is saved by this tool.",
    input: z.object({
      photo: z.string().describe('"photo-2" or an earlier "edit-1"'),
      rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
      corners: z.array(fraction).length(4).optional(),
      crop: z.array(z.number().min(0).max(1)).length(4).optional(),
      auto_color: z.boolean().optional(),
      brightness: z.number().min(-1).max(1).optional(),
      contrast: z.number().min(-1).max(1).optional(),
      seamless: z.boolean().optional(),
    }),
    async run(input, ctx) {
      let r = await loadPicture(ctx, input.photo);
      if (input.rotate) r = rotate(r, input.rotate);
      if (input.corners) r = rectify(r, input.corners.map(([x, y]) => [x * r.width, y * r.height] as [number, number]));
      else if (input.crop) r = crop(r, input.crop[0] * r.width, input.crop[1] * r.height, input.crop[2] * r.width, input.crop[3] * r.height);
      if (input.auto_color) r = autoColor(r);
      r = adjust(r, input.brightness ?? 0, input.contrast ?? 0);
      r = await fit(r, 1600);
      if (input.seamless) r = seamless(r);
      const id = storeEdit(r);
      const preview = await encodeJpeg(await fit(r, 768), 85);
      return {
        content: [
          { type: "image", data: preview.toString("base64"), mimeType: "image/jpeg" },
          { type: "text", text: `${id}: ${r.width}×${r.height} px. Not saved yet; use save_texture with source "${id}" when it looks right.` },
        ],
      };
    },
  }),

  tool({
    name: "save_texture",
    description:
      "Keep a photo or edit as a texture material in the project (and optionally in the user's library for other projects). size is how much real surface the image shows in cm: for one tile with its grout, the tile size (e.g. [30, 60]); for a patch of floor, that patch. Then use the material with set_finish.",
    input: z.object({
      source: z.string().describe('"edit-1" (preferred) or "photo-2"'),
      material: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase-kebab name"),
      size: vec2,
      roughness: z.number().min(0).max(1).optional(),
      library: z.object({ name: z.string(), category: z.string().optional() }).optional().describe("also save to the user's library under this name"),
    }),
    async run({ source, material, size, roughness, library }, ctx) {
      const r = await fit(await loadPicture(ctx, source), 1600);
      const jpeg = await encodeJpeg(r, 90);
      const rel = `assets/textures/${material}-${createHash("sha256").update(jpeg).digest("hex").slice(0, 8)}.jpg`;
      await fs.mkdir(path.dirname(projectPath(ctx, rel)), { recursive: true });
      await fs.writeFile(projectPath(ctx, rel), jpeg);
      const tile = { size: size as [number, number], image: rel };
      const mat = { color: "#ffffff", roughness: roughness ?? 0.5, tile };
      const project = await readProject(ctx);
      await writeJson(ctx, "project.json", { ...project, materials: { ...(project.materials ?? {}), [material]: mat } });
      let libraryId: string | undefined;
      if (library) {
        const stem = slugify(library.name);
        await fs.mkdir(ctx.libraryRoot, { recursive: true });
        libraryId = stem;
        for (let n = 2; await fs.stat(path.join(ctx.libraryRoot, libraryId)).catch(() => null); n++) libraryId = `${stem}-${n}`;
        const dir = path.join(ctx.libraryRoot, libraryId);
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, "texture.jpg"), jpeg);
        const item = { version: 1, name: library.name, category: library.category ?? "Materials", material: { ...mat, tile: { size, image: "texture.jpg" } } };
        await fs.writeFile(path.join(dir, "item.json"), JSON.stringify(item, null, 2) + "\n");
      }
      return { material, texture: rel, size, library: libraryId };
    },
  }),

  tool({
    name: "create_scene",
    description: "Create a new scene (a layout variant) and open it in the app. copy_current copies the open scene's furniture; own_walls gives it its own copy of the walls, for renovation options that change walls.",
    input: z.object({ name: z.string(), copy_current: z.boolean().default(true), own_walls: z.boolean().default(false) }),
    async run({ name, copy_current, own_walls }, ctx) {
      const current = await loadScene(ctx);
      const stem = slugify(name);
      const free = async (dir: string) => {
        for (let n = 1; ; n++) {
          const rel = `${dir}/${stem}${n === 1 ? "" : `-${n}`}.json`;
          if (!(await fs.stat(projectPath(ctx, rel)).catch(() => null))) return rel;
        }
      };
      let shell = current.shellRel;
      if (own_walls) {
        shell = await free("shells");
        await writeJson(ctx, shell, current.shellDoc);
      }
      const rel = await free("scenes");
      const doc: SceneDoc = { version: 1, name, ...(shell !== DEFAULT_SHELL ? { shell } : {}), objects: copy_current ? current.doc.objects ?? [] : [] };
      await writeJson(ctx, rel, doc);
      ctx.openScene(rel);
      return { created: rel, shell };
    },
  }),

  tool({
    name: "save_to_library",
    description: "Save an object from a scene to the user's furniture library (shared by all projects), e.g. a piece you built from a photo that the user wants to keep.",
    input: z.object({ scene: sceneArg, object_id: z.string(), name: z.string(), category: z.enum(["Kitchen", "Living", "Bedroom", "Bathroom", "Lighting", "Decor", "Other"]), notes: z.string().optional() }),
    async run({ scene, object_id, name, category, notes }, ctx) {
      const { doc } = await loadScene(ctx, scene);
      const o = doc.objects?.find((x) => x.id === object_id);
      if (!o) throw new ToolError(`no object "${object_id}"`);
      const stem = slugify(name);
      await fs.mkdir(ctx.libraryRoot, { recursive: true });
      let id = stem;
      for (let n = 2; await fs.stat(path.join(ctx.libraryRoot, id)).catch(() => null); n++) id = `${stem}-${n}`;
      const dir = path.join(ctx.libraryRoot, id);
      await fs.mkdir(dir);
      if (o.model) await fs.copyFile(projectPath(ctx, o.model.src), path.join(dir, "model.glb"));
      const item = {
        version: 1,
        name,
        category,
        ...(notes ? { notes } : {}),
        object: {
          ...(o.elevation ? { elevation: o.elevation } : {}),
          ...(o.template ? { template: o.template, params: o.params } : {}),
          ...(o.parts ? { parts: o.parts } : {}),
          ...(o.model ? { model: { src: "model.glb", size: o.model.size } } : {}),
        },
      };
      await fs.writeFile(path.join(dir, "item.json"), JSON.stringify(item, null, 2) + "\n");
      return `saved as library item "${id}" (no preview image; the user can re-save from the app for one)`;
    },
  }),
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// JSON Schema for a tool's input, for MCP and model APIs.
export function inputJsonSchema(def: ToolDef): Record<string, unknown> {
  const schema = z.toJSONSchema(def.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export async function callTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const def = TOOLS_BY_NAME.get(name);
  if (!def) return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: [{ type: "text", text: `invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")}` }], isError: true };
  }
  try {
    const out = await def.run(parsed.data, ctx);
    if (typeof out === "string") return { content: [{ type: "text", text: out }] };
    if (out && typeof out === "object" && "content" in out && Array.isArray((out as ToolResult).content)) return out as ToolResult;
    return { content: [{ type: "text", text: formatJson(out) }] };
  } catch (err) {
    const message = err instanceof ToolError || err instanceof z.ZodError ? err.message : `error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

// Validate that object docs produced by tools are well-formed (used in tests).
export const _objectSchema = ObjectSchema;
