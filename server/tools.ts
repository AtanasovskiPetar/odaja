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
import { createHash } from "node:crypto";

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
    shape: z.enum(["box", "cylinder"]),
    size: vec3.optional().describe("box: [width x, depth y, height] cm"),
    radius: z.number().optional().describe("box: corner rounding; cylinder: radius (cm)"),
    height: z.number().optional().describe("cylinder height (cm)"),
    at: vec3.optional().describe("[x, y, z_bottom] relative to the object origin; default [0, 0, 0]"),
    rotation: z.number().optional(),
    material: z.string().optional(),
    color: z.string().optional().describe("#rrggbb"),
    name: z.string().optional(),
  })
  .describe("A box or upright cylinder");
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
        materials: Object.keys(project.materials),
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
    }),
    async run({ scene, wall, type, offset, width, height, sill }, ctx) {
      const before = new Set((await loadScene(ctx, scene)).shell.openings.map((o) => o.id));
      const { shell } = await changeShell(ctx, scene, addOpening(wall, type, offset, { ...(width ? { width } : {}), ...(height ? { height } : {}), ...(sill !== undefined ? { sill } : {}) }));
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
    }),
    async run({ scene, id, ...patch }, ctx) {
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
