// Odaja's tools for AI models: read the design, change it, measure it, check
// it, look at it. One implementation serves every connection: the in-app
// chat (any provider), Claude Code through the MCP server, and anything else
// that speaks MCP. Tools edit the project files; the open app picks the
// changes up live (and can undo them).
import { z } from "zod";
import { followWalls } from "../model/attach";
import { formatJson } from "../model/format";
import { clearances, objectFootprint, polygonArea, rectEdges, roomAt, roomClearSize, shellBounds, wallEdges, wallOutline, type Vec } from "../model/geometry";
import { issuesFor } from "../model/issues";
import { TEMPLATES, TEMPLATES_BY_ID, templateParams } from "../model/library";
import { addObject, deleteObject, setObjectProps, setTemplateParams, uniqueId, type ObjectDoc } from "../model/operations";
import { enclosedArea } from "../model/rooms";
import { calibrate, defaultUnderlay, pixelToPlan } from "../model/underlay";
import { fitOpening as fitOpeningIn, projectOnWall } from "../model/geometry";
import {
  DEFAULT_SHELL,
  LibraryItemSchema,
  UnderlaySchema,
  MaterialSchema,
  TILE_PATTERNS,
  ObjectSchema,
  PartSchema,
  ProjectSchema,
  SceneSchema,
  ShellSchema,
  type Scene,
  type SceneDoc,
  type Shell,
  type ShellDoc,
} from "../model/schema";
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
} from "../model/shellOps";
import { slugify } from "../model/defaults";
import { addStair, defaultStairSize, deleteStair, stairOutline, stepSizes, updateStair } from "../model/stairs";
import { AREA_KINDS, FENCE_STYLES, ROOF_TYPES, STAIR_TYPES, type Roof, type Stair } from "../model/schema";
import { addRoof, deleteRoof, hullOf, ROOF_LOOK, roofOutline, roofOverhang, roofPitch, roofRidge, roofRise, updateRoof } from "../model/roofs";
import { addArea, addFences, AREA_LOOK, deleteArea, deleteFence, FENCE_LOOK, fenceHeight, fenceLength, setPlot, updateArea, updateFence, updatePlot } from "../model/site";
import { quantities } from "../model/finishes";
import { addFinish, clearRoomWalls, finishRoomWalls, removeFinishes, setRoomFloor } from "../model/finishOps";
import { compactPart } from "../model/partOps";
import {
  addLevel,
  copyLevelWalls,
  deleteLevel,
  levelById,
  levelDoc,
  levelOf,
  levelOfItem,
  levelScene,
  levelShell,
  levelsOf,
  levelsTopDown,
  levelAbove,
  mergeLevelDoc,
  riseFrom,
  stairRise,
  stairsArriving,
  removeLevelObjects,
  updateLevel,
} from "../model/levels";
import { checkPath, extension, fromBase64, sha256Hex, toBase64, type AgentFiles, type FileArea } from "./files";
import { adjust, autoColor, crop, decode, encodeJpeg, fit, getEdit, rectify, rotate, seamless, storeEdit, type Raster } from "./photos";

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolContext {
  // The open home's files and the library; null when no home is open.
  files(): AgentFiles | null;
  scenePath(): string | null; // the scene open in the app
  // `level`: show that level first (the app goes back to its own after).
  screenshot(view: "plan" | "3d", level?: string): Promise<{ data: string; mimeType: string }>;
  openScene(path: string): void;
  // Photos shared in the chat this tool call comes from (photo-1, photo-2, …),
  // if it comes from an Odaja chat.
  photos?(): Promise<{ mimeType: string; data: string }[]>;
  // The object whose shape the user is editing in the app, if any.
  editingObject?(): string | null;
  // The level shown in the app, if known.
  level?(): string | null;
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
const levelArg = z.string().optional().describe("Level (storey) id, in homes with several levels (get_overview lists them). Default: the level open in the app.");

class ToolError extends Error {}

// --- file helpers ---------------------------------------------------------

function files(ctx: ToolContext): AgentFiles {
  const f = ctx.files();
  if (!f) throw new ToolError("No project is open in Odaja. Ask the user to open one.");
  return f;
}
const projectFiles = (ctx: ToolContext): FileArea => files(ctx).project;
const libraryFiles = (ctx: ToolContext): FileArea => files(ctx).library;

// A path from a model, checked to stay inside its area.
function safe(rel: string): string {
  try {
    return checkPath(rel);
  } catch {
    throw new ToolError(`path escapes the project: ${rel}`);
  }
}

async function readJson(ctx: ToolContext, rel: string): Promise<unknown> {
  const text = await projectFiles(ctx).readText(safe(rel));
  if (text === null) throw new ToolError(`file not found: ${rel}`);
  return JSON.parse(text);
}

async function writeJson(ctx: ToolContext, rel: string, doc: unknown) {
  await projectFiles(ctx).write(safe(rel), formatJson(doc));
}

async function listScenes(ctx: ToolContext): Promise<string[]> {
  const names = await projectFiles(ctx).listFiles("scenes");
  return names.filter((f) => f.endsWith(".json")).map((f) => `scenes/${f}`).sort();
}

// A free folder name in the library: stem, stem-2, …
async function freeLibraryId(ctx: ToolContext, stem: string) {
  let id = stem;
  for (let n = 2; await libraryFiles(ctx).exists(id); n++) id = `${stem}-${n}`;
  return id;
}

async function readLibraryItem(ctx: ToolContext, id: string) {
  const text = await libraryFiles(ctx).readText(`${safe(id)}/item.json`);
  if (text === null) throw new ToolError(`no library item "${id}"`);
  return LibraryItemSchema.parse(JSON.parse(text));
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

type Loaded = Awaited<ReturnType<typeof loadScene>>;

// The level to work on: the one asked for, else the one open in the app,
// else the first.
function pickLevel(ctx: ToolContext, shell: Shell, wanted?: string): string {
  const levels = levelsOf(shell);
  if (wanted !== undefined) {
    if (!levels.some((l) => l.id === wanted)) throw new ToolError(`no level "${wanted}"; the levels are ${levels.map((l) => l.id).join(", ")}`);
    return wanted;
  }
  const open = ctx.level?.();
  return levels.find((l) => l.id === open)?.id ?? levels[0].id;
}

// A scene and its walls as seen on one level.
function onLevel(shell: Shell, scene: Scene, levelId: string) {
  return { level: levelById(shell, levelId), shell: levelShell(shell, levelId), scene: levelScene(scene, shell, levelId) };
}

// A stair as the tools describe it (the level view has its rise filled in).
function describeStair(stair: Stair, whole: Shell) {
  const rise = stair.rise ?? 280;
  const { count, riser, going } = stepSizes(stair, rise);
  const to = levelAbove(whole, levelOf(stair, whole));
  return {
    id: stair.id,
    type: stair.type,
    position: stair.position,
    rotation: stair.rotation,
    size: stair.size,
    turn: stair.type === "straight" ? undefined : stair.turn,
    open: stair.type !== "spiral" && stair.open ? true : undefined,
    rise,
    upTo: to?.id,
    steps: `${count} × ${r1(riser)} cm risers, ${Math.round(going)} cm treads`,
    footprint: stairOutline(stair).map(([x, y]) => [r1(x), r1(y)]),
  };
}

const describeRoof = (r: Roof) => ({
  id: r.id,
  type: r.type,
  polygon: r.polygon,
  pitch: r.type === "flat" ? undefined : roofPitch(r),
  overhang: roofOverhang(r),
  ridge: r.type === "gable" ? roofRidge(r) : undefined,
  downTo: r.type === "shed" ? (r.downTo ?? "south") : undefined,
  ridgeAboveWalls: Math.round(roofRise(r)),
  ceiling: r.ceiling,
  eaves: roofOutline(r).map(([x, y]) => [r1(x), r1(y)]),
});

// The garden is on the first level.
const siteLevel = (shell: Shell) => levelsOf(shell)[0].id;

const describeLevels = (shell: Shell) =>
  levelsTopDown(shell).map((l) => ({ id: l.id, name: l.name, elevation: l.elevation, wallHeight: l.height ?? shell.wallHeight, slab: l.slab }));

// Write a changed shell file; attached furniture follows in every scene that
// uses the same shell (like editing walls in the app), and `alsoScenes` can
// change those scenes further.
async function writeShell(ctx: ToolContext, loaded: Loaded, next: ShellDoc, alsoScenes?: (doc: SceneDoc) => SceneDoc): Promise<Shell> {
  const shell = ShellSchema.parse(next);
  await writeJson(ctx, loaded.shellRel, next);
  for (const rel of await listScenes(ctx)) {
    try {
      const doc = (await readJson(ctx, rel)) as SceneDoc;
      if ((doc.shell ?? DEFAULT_SHELL) !== loaded.shellRel) continue;
      let followed = followWalls(doc, loaded.shell, shell);
      if (alsoScenes) followed = alsoScenes(followed);
      if (followed !== doc) await writeJson(ctx, rel, followed);
    } catch {
      // Unreadable scene: leave it.
    }
  }
  return shell;
}

// Change the walls of one level of a scene's shell: the change gets that
// level's view (its walls, openings and rooms). The level is the one the
// wall, opening or room `item` is on, else `level` (see pickLevel).
async function changeShell(ctx: ToolContext, scene: string | undefined, change: (doc: ShellDoc) => ShellDoc, where: { level?: string; item?: string } = {}) {
  const loaded = await loadScene(ctx, scene);
  const level = (where.item && levelOfItem(loaded.shellDoc, where.item)) || pickLevel(ctx, loaded.shell, where.level);
  const view = levelDoc(loaded.shellDoc, level);
  const edited = change(view);
  if (edited === view) throw new ToolError("nothing changed (the edit was not possible, e.g. an opening that doesn't fit or a wall that would be too short)");
  const next = mergeLevelDoc(loaded.shellDoc, level, edited);
  const shell = await writeShell(ctx, loaded, next);
  return { ...loaded, shellDoc: next, shell, level, levelShell: levelShell(shell, level) };
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

function describeUnderlay(u: z.infer<typeof UnderlaySchema>) {
  const w = r1(u.width * u.scale);
  const h = r1(u.height * u.scale);
  return {
    image: u.image,
    pixels: [u.width, u.height],
    cmPerPixel: Number(u.scale.toFixed(4)),
    sizeOnPlan: [w, h],
    center: u.center,
    rotation: u.rotation,
    note: "Image point (fx, fy) in 0..1 maps to the plan with image_to_plan. If the scale is a guess, set it with scale_from using a dimension printed on the plan, or ask the user for one real measurement.",
  };
}

async function readProject(ctx: ToolContext) {
  return (await readJson(ctx, "project.json")) as { materials?: Record<string, unknown> } & Record<string, unknown>;
}

// --- tools ----------------------------------------------------------------

export const TOOLS: ToolDef[] = [
  tool({
    name: "get_overview",
    description:
      "Start here. Summary of the open project and scene: rooms with clear sizes and areas, walls, doors and windows, every object with its footprint, and current issues. Units are cm on a top-down plan: x east, y south; rotation in degrees clockwise from above, 0 = object's front faces north. A home with several levels (storeys) lists them in `levels`; the rooms, walls, openings, objects and issues are those of one level (`level`: the one asked for, else the one open in the app). Heights are always from that level's floor.",
    input: z.object({ scene: sceneArg, level: levelArg }),
    async run({ scene, level }, ctx) {
      const loaded = await loadScene(ctx, scene);
      const { rel, shellRel } = loaded;
      const levelId = pickLevel(ctx, loaded.shell, level);
      const { shell, scene: s } = onLevel(loaded.shell, loaded.scene, levelId);
      const multi = loaded.shell.levels.length > 0;
      const project = ProjectSchema.parse(await readJson(ctx, "project.json"));
      const edges = wallEdges(shell);
      const b = shellBounds(shell);
      return {
        project: project.name,
        scene: { file: rel, name: s.name, description: s.description, shell: shellRel },
        scenes: await listScenes(ctx),
        levels: multi ? describeLevels(loaded.shell) : undefined,
        level: multi ? levelId : undefined,
        flatOutline: b && { minX: r1(b.minX), minY: r1(b.minY), maxX: r1(b.maxX), maxY: r1(b.maxY) },
        rooms: shell.rooms.map((r) => {
          const size = roomClearSize(r, edges);
          return { id: r.id, name: r.name, polygon: r.polygon, clearWidth: size && r1(size.width), clearDepth: size && r1(size.depth), areaM2: r1(polygonArea(r.polygon) / 10000) };
        }),
        walls: shell.walls.map((w) => ({ id: w.id, from: w.from, to: w.to, thickness: w.thickness })),
        stairs: shell.stairs.length ? shell.stairs.map((st) => describeStair(st, loaded.shell)) : undefined,
        roofs: shell.roofs.length ? shell.roofs.map(describeRoof) : undefined,
        garden:
          shell.plot || shell.areas.length || shell.fences.length
            ? {
                plot: shell.plot && { polygon: shell.plot.polygon, areaM2: r1(polygonArea(shell.plot.polygon) / 10000), ground: shell.plot.material },
                areas: shell.areas.map((a) => ({ id: a.id, name: a.name, kind: a.kind, polygon: a.polygon, areaM2: r1(polygonArea(a.polygon) / 10000), height: a.height, material: a.material })),
                fences: shell.fences.map((f) => ({ id: f.id, from: f.from, to: f.to, style: f.style, height: fenceHeight(f), length: r1(fenceLength(f)), gates: f.gates.length ? f.gates : undefined })),
              }
            : undefined,
        stairsFromBelow: multi
          ? stairsArriving(loaded.shell, levelId).map((a) => ({ id: a.stair.id, from: a.from.id, openingInFloor: stairOutline(a.stair).map(([x, y]) => [r1(x), r1(y)]) }))
          : undefined,
        openings: shell.openings.map((o) => ({ id: o.id, wall: o.wall, type: o.type, offset: o.offset, width: o.width, height: o.height, sill: o.sill || undefined, hinge: o.type === "door" ? o.hinge : undefined, swing: o.type === "door" ? o.swing : undefined })),
        objects: s.objects.map(describeObject),
        editingShape: ctx.editingObject?.() ?? undefined,
        finishes: s.finishes.filter((f) => (f.wall ? shell.walls.some((w) => w.id === f.wall) : shell.rooms.some((r) => r.id === f.room))),
        materials: Object.fromEntries(
          Object.entries(project.materials).map(([k, m]) => [k, m.tile ? `${m.color} tiles ${m.tile.size[0]}×${m.tile.size[1]} ${m.tile.pattern}${m.tile.image ? " (photo)" : ""}` : m.color]),
        ),
        background: project.underlay ? describeUnderlay(project.underlay) : null,
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
      const items = [];
      for (const name of await libraryFiles(ctx).listDirs("")) {
        try {
          const item = await readLibraryItem(ctx, name);
          const o = item.object;
          if (!o) {
            items.push({ id: name, name: item.name, category: item.category, notes: item.notes, kind: "material", tile: item.material?.tile });
            continue;
          }
          items.push({ id: name, name: item.name, category: item.category, notes: item.notes, kind: o.model ? "model" : o.template ? `template:${o.template}` : "parts", size: o.model?.size, params: o.params });
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
      level: levelArg,
    }),
    async run(input, ctx) {
      const loaded = await loadScene(ctx, input.scene);
      const levelId = pickLevel(ctx, loaded.shell, input.level);
      const kinds = [input.template, input.library_item, input.parts].filter((k) => k !== undefined).length;
      if (kinds !== 1) throw new ToolError("give exactly one of template, library_item or parts");
      let fields: Partial<ObjectDoc> = {};
      if (input.template) {
        const t = TEMPLATES_BY_ID.get(input.template);
        if (!t) throw new ToolError(`unknown template "${input.template}"; see list_templates`);
        fields = { template: t.id, params: templateParams(t, input.params), elevation: input.elevation ?? t.elevation };
      } else if (input.library_item) {
        const id = safe(input.library_item);
        const item = await readLibraryItem(ctx, id);
        const o = item.object;
        if (!o) throw new ToolError(`"${input.library_item}" is a material, not furniture; use add_material_from_library`);
        let model;
        if (o.model) {
          const data = await libraryFiles(ctx).read(`${id}/model.glb`);
          if (!data) throw new ToolError(`library item "${id}" is missing its model`);
          const src = `assets/models/${id}-${(await sha256Hex(data)).slice(0, 8)}.glb`;
          if (!(await projectFiles(ctx).exists(src))) await projectFiles(ctx).write(src, data);
          model = { src, size: o.model.size };
        }
        fields = {
          template: o.template,
          params: o.params,
          parts: o.parts,
          model,
          elevation: input.elevation ?? o.elevation,
          notes: input.notes ?? item.notes,
          libraryItem: { id, category: item.category },
        };
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
          level: levelId === levelsOf(loaded.shell)[0].id ? undefined : levelId,
          attachedTo: input.attached_to,
          notes: fields.notes ?? input.notes,
        } as ObjectDoc)(doc);
      });
      const added = result.scene.objects.at(-1)!;
      const view = onLevel(result.shell, result.scene, levelId);
      // Record the room it landed in.
      const room = roomAt(view.shell, added.position);
      if (room) await changeScene(ctx, input.scene, setObjectProps(added.id, { room }));
      return { added: describeObject({ ...added, room }), issues: issuesFor(view.scene, view.shell).filter((i) => i.targets.some((t) => t.id === added.id)).map((i) => i.message) };
    },
  }),

  tool({
    name: "update_object",
    description: "Change an object: move (position), turn (rotation), raise (elevation), rename, resize a template object (params), replace its parts, attach to / detach from a wall (attached_to: wall id or null), notes, locked, or move it to another level (level; it keeps its plan position).",
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
      level: z.string().optional().describe("move the object to this level"),
    }),
    async run(input, ctx) {
      const loaded = await loadScene(ctx, input.scene);
      const toLevel = input.level === undefined ? undefined : pickLevel(ctx, loaded.shell, input.level);
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
        if (toLevel !== undefined && toLevel !== levelOf(current, loaded.shell)) {
          // On another level: the room and the wall it stood against were on the old one.
          const moved = next.objects!.find((o) => o.id === input.id)!;
          const room = roomAt(levelShell(loaded.shell, toLevel), moved.position);
          next = setObjectProps(input.id, { level: toLevel === levelsOf(loaded.shell)[0].id ? undefined : toLevel, room, attachedTo: undefined })(next);
        }
        if (input.params) {
          if (!current.template) throw new ToolError("params only apply to template objects");
          next = setTemplateParams(input.id, input.params)(next);
        }
        return next;
      });
      const o = result.scene.objects.find((x) => x.id === input.id)!;
      const view = onLevel(result.shell, result.scene, levelOf(o, result.shell));
      return { updated: { ...describeObject(o), level: result.shell.levels.length ? view.level.id : undefined }, issues: issuesFor(view.scene, view.shell).filter((i) => i.targets.some((t) => t.id === o.id)).map((i) => i.message) };
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
      const loaded = await loadScene(ctx, scene);
      const found = loaded.scene.objects.find((x) => x.id === id);
      if (!found) throw new ToolError(`no object "${id}"`);
      // Walls and furniture on the object's own level.
      const { scene: s, shell } = onLevel(loaded.shell, loaded.scene, levelOf(found, loaded.shell));
      const o = found;
      const r = objectFootprint(o);
      const edges = [...wallEdges(shell), ...s.objects.filter((x) => x.id !== id).flatMap((x) => rectEdges(objectFootprint(x)))];
      const c = clearances(r, edges);
      const v = (n: number | null) => (n === null ? null : r1(n));
      return { ...describeObject(o), freeSpace: { west: v(c.left), east: v(c.right), north: v(c.up), south: v(c.down) } };
    },
  }),

  tool({
    name: "check_issues",
    description: "Design checks for a scene: furniture in walls, overlaps, blocked doors, too little space in front of fixtures, misplaced openings. Every level, unless level is given.",
    input: z.object({ scene: sceneArg, level: z.string().optional().describe("only this level") }),
    async run({ scene, level }, ctx) {
      const loaded = await loadScene(ctx, scene);
      const ids = level !== undefined ? [pickLevel(ctx, loaded.shell, level)] : levelsOf(loaded.shell).map((l) => l.id);
      const multi = loaded.shell.levels.length > 0;
      const issues = ids.flatMap((id) => {
        const { scene: s, shell } = onLevel(loaded.shell, loaded.scene, id);
        return issuesFor(s, shell).map((i) => ({ level: multi ? id : undefined, severity: i.severity, message: i.message, targets: i.targets, quickFix: i.fix?.label }));
      });
      return issues.length ? issues : "No issues.";
    },
  }),

  tool({
    name: "screenshot",
    description: "See the scene as the user does: 'plan' is a to-scale top view, '3d' a perspective view. Use it to check your work visually. It shows one level (the one open in the app, or `level`): the plan only that level, the 3D view that level with the ones below.",
    input: z.object({ view: z.enum(["plan", "3d"]).default("plan"), level: levelArg }),
    async run({ view, level }, ctx) {
      const shot = await ctx.screenshot(view, level);
      return { content: [{ type: "image", data: shot.data, mimeType: shot.mimeType }, { type: "text", text: `Screenshot of the ${view} view${level ? ` of level ${level}` : ""}.` }] };
    },
  }),

  tool({
    name: "add_wall",
    description: "Add a straight wall between two plan points (wall centreline), on one level. Typical thickness: 25 outer, 12 inner. Walls apply to every scene sharing this scene's shell.",
    input: z.object({ scene: sceneArg, from: vec2, to: vec2, thickness: z.number().positive().default(12), level: levelArg }),
    async run({ scene, from, to, thickness, level }, ctx) {
      const before = new Set((await loadScene(ctx, scene)).shell.walls.map((w) => w.id));
      const { shell } = await changeShell(ctx, scene, addWalls([from as Vec, to as Vec], thickness), { level });
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
      }, { item: id });
      return { wall: shell.walls.find((w) => w.id === id) };
    },
  }),

  tool({
    name: "delete_wall",
    description: "Remove a wall (and its doors/windows).",
    input: z.object({ scene: sceneArg, id: z.string() }),
    async run({ scene, id }, ctx) {
      await changeShell(ctx, scene, deleteWall(id), { item: id });
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
      }, { item: wall });
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
      const { shell } = await changeShell(ctx, scene, updateOpening(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))), { item: id });
      return { opening: shell.openings.find((o) => o.id === id) };
    },
  }),

  tool({
    name: "delete_opening",
    description: "Remove a door, window or opening.",
    input: z.object({ scene: sceneArg, id: z.string() }),
    async run({ scene, id }, ctx) {
      await changeShell(ctx, scene, deleteOpening(id), { item: id });
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
      level: z.string().optional().describe("level for a new room (default: the one open in the app)"),
    }),
    async run(input, ctx) {
      if (input.id) {
        const id = input.id;
        await changeShell(ctx, input.scene, input.delete ? deleteRoom(id) : updateRoom(id, { ...(input.name ? { name: input.name } : {}), ...(input.floor ? { floor: input.floor } : {}) }), { item: id });
        return input.delete ? `deleted ${id}` : `updated ${id}`;
      }
      const loaded = await loadScene(ctx, input.scene);
      const level = pickLevel(ctx, loaded.shell, input.level);
      let polygon = input.polygon as Vec[] | undefined;
      if (!polygon && input.inside_point) {
        polygon = enclosedArea(levelShell(loaded.shell, level), input.inside_point as Vec) ?? undefined;
        if (!polygon) throw new ToolError("that point is not inside an area enclosed by walls");
      }
      if (!polygon) throw new ToolError("give inside_point or polygon");
      const before = new Set(loaded.shell.rooms.map((r) => r.id));
      const { shell } = await changeShell(ctx, input.scene, addRoom(polygon, input.name, input.floor), { level });
      return { added: shell.rooms.find((r) => !before.has(r.id)) };
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
          const room = loaded.shell.rooms.find((r) => r.id === input.room);
          if (!room) throw new ToolError(`no room "${input.room}"`);
          return finishRoomWalls(levelShell(loaded.shell, levelOf(room, loaded.shell)), room.id, input.material, input.bottom ?? 0, input.top)(doc);
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
        const found = room && loaded.shell.rooms.find((r) => r.id === room);
        if (found) return clearRoomWalls(levelShell(loaded.shell, levelOf(found, loaded.shell)), found.id)(doc);
        if (room) throw new ToolError(`no room "${room}"`);
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
      const loaded = await loadScene(ctx, scene);
      const project = ProjectSchema.parse(await readJson(ctx, "project.json"));
      // Each finish measured on its own level (finishes elsewhere measure 0).
      const multi = loaded.shell.levels.length > 0;
      const lines = levelsOf(loaded.shell).flatMap((l) => {
        const { scene: s, shell } = onLevel(loaded.shell, loaded.scene, l.id);
        const on = s.finishes.filter((f) => (f.wall ? shell.walls.some((w) => w.id === f.wall) : shell.rooms.some((r) => r.id === f.room)));
        return quantities({ ...s, finishes: on }, shell, project.materials).map((q) => (multi ? { ...q, label: `${l.name}: ${q.label}` } : q));
      });
      return lines.length ? lines : "This scene has no finishes yet.";
    },
  }),

  tool({
    name: "add_material_from_library",
    description: "Copy a material (e.g. a tile the user saved) from the user's library into this project, so finishes can use it. Returns the material's name in the project.",
    input: z.object({ item: z.string().describe("library item id from list_library (kind: material)") }),
    async run({ item }, ctx) {
      const parsed = await readLibraryItem(ctx, item);
      if (!parsed.material) throw new ToolError(`"${item}" is furniture, not a material`);
      const material = { ...structuredClone(parsed.material), libraryItem: { id: item, category: parsed.category } } as Record<string, unknown> & { tile?: { image?: string } };
      if (material.tile?.image) {
        const data = await libraryFiles(ctx).read(`${safe(item)}/${material.tile.image}`);
        if (!data) throw new ToolError(`library item "${item}" is missing its texture`);
        const rel = `assets/textures/${item}${extension(material.tile.image)}`;
        await projectFiles(ctx).write(rel, data);
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
          { type: "image", data: toBase64(preview), mimeType: "image/jpeg" },
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
      const rel = `assets/textures/${material}-${(await sha256Hex(jpeg)).slice(0, 8)}.jpg`;
      await projectFiles(ctx).write(rel, jpeg);
      const tile = { size: size as [number, number], image: rel };
      const mat = { color: "#ffffff", roughness: roughness ?? 0.5, tile };
      const project = await readProject(ctx);
      await writeJson(ctx, "project.json", { ...project, materials: { ...(project.materials ?? {}), [material]: mat } });
      let libraryId: string | undefined;
      if (library) {
        libraryId = await freeLibraryId(ctx, slugify(library.name));
        await libraryFiles(ctx).write(`${libraryId}/texture.jpg`, jpeg);
        const item = { version: 1, name: library.name, category: library.category ?? "Materials", material: { ...mat, tile: { size, image: "texture.jpg" } } };
        // item.json last: an item only shows up once it's complete.
        await libraryFiles(ctx).write(`${libraryId}/item.json`, JSON.stringify(item, null, 2) + "\n");
      }
      return { material, texture: rel, size, library: libraryId };
    },
  }),

  tool({
    name: "build_shell",
    description:
      "Build the flat's walls, doors, windows and rooms in one go (e.g. from a floor plan), replacing the current walls unless replace is false. In a home with several levels it builds one level (level; wall_height is then that level's). Walls are centrelines [x, y] cm (x east, y south); outer walls ~25 thick, inner ~12. Wall ends within 3 cm are joined, and ends touching another wall snap onto it. Openings name their wall by id (or \"#n\" for the n-th wall in this call, from 0), with offset = cm from the wall's from point to the opening's near edge. Rooms take a polygon or a point inside walls that enclose them. Returns what was built and anything to fix (loose wall ends, openings that had to move, rooms that aren't enclosed).",
    input: z.object({
      scene: sceneArg,
      replace: z.boolean().default(true),
      wall_height: z.number().positive().optional(),
      walls: z.array(z.object({ id: z.string().optional(), from: vec2, to: vec2, thickness: z.number().positive().optional() })),
      openings: z
        .array(
          z.object({
            wall: z.string(),
            type: z.enum(["door", "window", "opening"]),
            offset: z.number(),
            width: z.number().positive(),
            height: z.number().positive().optional(),
            sill: z.number().min(0).optional(),
            hinge: z.enum(["start", "end"]).optional(),
            swing: z.enum(["left", "right"]).optional(),
            style: joineryArgs.style,
          }),
        )
        .optional(),
      rooms: z.array(z.object({ name: z.string(), polygon: z.array(vec2).optional(), inside_point: vec2.optional(), floor: z.string().optional() })).optional(),
      level: levelArg,
    }),
    async run(input, ctx) {
      const notes: string[] = [];
      const loaded = await loadScene(ctx, input.scene);
      const levelId = pickLevel(ctx, loaded.shell, input.level);
      const view = levelDoc(loaded.shellDoc, levelId);
      const base = input.replace ? { ...view, walls: [], openings: [], rooms: [] } : view;
      const items = (d: ShellDoc) => [...(d.walls ?? []), ...(d.openings ?? []), ...(d.rooms ?? [])].map((x) => x.id);
      // Ids in use: the other levels' and what stays on this one.
      const onView = new Set(items(view));
      const taken = new Set([...items(loaded.shellDoc).filter((id) => !onView.has(id)), ...items(base)]);
      const freeId = (prefix: string, wanted?: string) => {
        let id = wanted && /^[a-z0-9][a-z0-9-]*$/.test(wanted) && !taken.has(wanted) ? wanted : "";
        for (let n = 1; !id; n++) if (!taken.has(`${prefix}-${n}`)) id = `${prefix}-${n}`;
        taken.add(id);
        return id;
      };
      // Walls, with nearby ends joined.
      const walls = input.walls.map((w) => ({ id: freeId("wall", w.id), from: [...w.from] as Vec, to: [...w.to] as Vec, thickness: w.thickness ?? 12 }));
      const ends = walls.flatMap((w) => [w.from, w.to]);
      let joined = 0;
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const d = Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]);
          if (d > 0 && d <= 3) {
            ends[j][0] = ends[i][0];
            ends[j][1] = ends[i][1];
            joined++;
          }
        }
      }
      // Ends close to another wall's line snap onto it (T-junctions).
      for (const w of walls) {
        for (const end of [w.from, w.to]) {
          for (const other of walls) {
            if (other === w) continue;
            const p = projectOnWall({ ...other, id: other.id }, end);
            if (p.across > 0.05 && p.across <= 3) {
              end[0] = r1(p.point[0]);
              end[1] = r1(p.point[1]);
              joined++;
            }
          }
        }
      }
      if (joined) notes.push(`Joined ${joined} wall end(s) that were within 3 cm.`);
      const kept = walls.filter((w) => {
        const ok = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]) >= 10;
        if (!ok) notes.push(`Skipped ${w.id}: shorter than 10 cm.`);
        return ok;
      });
      let doc: ShellDoc = { ...base, wallHeight: input.wall_height ?? base.wallHeight, walls: [...(base.walls ?? []), ...kept.map((w) => ({ id: w.id, from: [r1(w.from[0]), r1(w.from[1])] as [number, number], to: [r1(w.to[0]), r1(w.to[1])] as [number, number], thickness: w.thickness }))] };
      // Loose ends: not on another wall's line.
      const shellNow = ShellSchema.parse(doc);
      for (const w of shellNow.walls) {
        for (const end of [w.from, w.to]) {
          const connected = shellNow.walls.some((o) => o !== w && projectOnWall(o, end).across < 0.5);
          if (!connected) notes.push(`${w.id} has a loose end at [${end[0]}, ${end[1]}]: it doesn't meet another wall.`);
        }
      }
      // Openings, fitted onto their walls.
      for (const o of input.openings ?? []) {
        const idx = /^#(\d+)$/.exec(o.wall);
        const wallId = idx ? kept[Number(idx[1])]?.id : o.wall;
        const shell = ShellSchema.parse(doc);
        const wall = shell.walls.find((w) => w.id === wallId);
        if (!wall) {
          notes.push(`Skipped a ${o.type}: no wall "${o.wall}".`);
          continue;
        }
        const fit = fitOpeningIn(wall, shell, o.offset, o.width);
        if (fit === null) {
          notes.push(`Skipped a ${o.width} cm ${o.type} on ${wall.id}: it doesn't fit there.`);
          continue;
        }
        if (Math.abs(fit - o.offset) > 1) notes.push(`Moved a ${o.type} on ${wall.id} from offset ${o.offset} to ${r1(fit)} so it fits.`);
        const defaults = o.type === "window" ? { height: 140, sill: 90 } : { height: 210, sill: 0 };
        const opening = Object.fromEntries(
          Object.entries({ id: freeId(o.type), wall: wall.id, type: o.type, offset: r1(fit), width: o.width, height: o.height ?? defaults.height, sill: (o.sill ?? defaults.sill) || undefined, hinge: o.hinge, swing: o.swing, style: o.style }).filter(([, v]) => v !== undefined),
        );
        doc = { ...doc, openings: [...(doc.openings ?? []), opening as unknown as NonNullable<ShellDoc["openings"]>[number]] };
      }
      // Rooms.
      for (const r of input.rooms ?? []) {
        let polygon = r.polygon as Vec[] | undefined;
        if (!polygon && r.inside_point) {
          polygon = enclosedArea(ShellSchema.parse(doc), r.inside_point as Vec) ?? undefined;
          if (!polygon) {
            notes.push(`Room "${r.name}": the walls around [${r.inside_point.join(", ")}] don't enclose an area; check for gaps.`);
            continue;
          }
        }
        if (!polygon) {
          notes.push(`Room "${r.name}": give polygon or inside_point.`);
          continue;
        }
        doc = { ...doc, rooms: [...(doc.rooms ?? []), { id: freeId(slugify(r.name).replace(/[^a-z0-9-]/g, "") || "room"), name: r.name, polygon: polygon.map((p) => [r1(p[0]), r1(p[1])] as [number, number]), floor: r.floor ?? "oak" }] };
      }
      const { levelShell: shell } = await changeShell(ctx, input.scene, () => doc, { level: levelId });
      const b = shellBounds(shell);
      return {
        built: { walls: shell.walls.length, openings: shell.openings.length, rooms: shell.rooms.length },
        outline: b && { width: r1(b.maxX - b.minX), depth: r1(b.maxY - b.minY) },
        toFix: notes.length ? notes : "Nothing; all walls connect. Take a plan screenshot to compare with the floor plan.",
      };
    },
  }),

  tool({
    name: "set_level",
    description:
      "Add, change or delete a level (storey) of the home. A new level goes on top of the highest one unless elevation is given (cm: its floor above the ground floor's; negative for a basement). height is its wall height, slab the floor thickness under it (default 20). copy_walls_from copies another level's walls and rooms onto it (not doors or windows), a start for an upper floor with the same outline. delete removes the level with its walls, rooms, furniture and finishes in every scene sharing these walls. Then pass level to the other tools to work on it.",
    input: z.object({
      scene: sceneArg,
      id: z.string().optional().describe("existing level to change or delete; omit to add one"),
      name: z.string().optional(),
      elevation: z.number().optional(),
      height: z.number().positive().optional(),
      slab: z.number().min(0).max(100).optional(),
      copy_walls_from: z.string().optional().describe("level id"),
      delete: z.boolean().optional(),
    }),
    async run(input, ctx) {
      const loaded = await loadScene(ctx, input.scene);
      const listed = (loaded.shellDoc.levels ?? []).map((l) => l.id);
      const known = levelsOf(loaded.shell).map((l) => l.id);
      const check = (id: string) => {
        if (!known.includes(id)) throw new ToolError(`no level "${id}"; the levels are ${known.join(", ")}`);
        return id;
      };
      if (input.delete) {
        if (!input.id) throw new ToolError("give the id of the level to delete");
        check(input.id);
        if (listed.length < 2) throw new ToolError("a home keeps at least one level");
        const shell = await writeShell(ctx, loaded, deleteLevel(input.id)(loaded.shellDoc), (doc) => removeLevelObjects(doc, loaded.shellDoc, input.id!));
        return { deleted: input.id, levels: describeLevels(shell) };
      }
      const fields = { name: input.name, elevation: input.elevation, height: input.height, slab: input.slab };
      let next: ShellDoc;
      let id: string;
      if (input.id) {
        id = check(input.id);
        next = updateLevel(id, fields)(loaded.shellDoc);
      } else {
        ({ doc: next, id } = addLevel(loaded.shellDoc, fields));
      }
      if (input.copy_walls_from) next = copyLevelWalls(check(input.copy_walls_from), id)(next);
      if (next === loaded.shellDoc) throw new ToolError("nothing changed");
      const shell = await writeShell(ctx, loaded, next);
      const view = levelShell(shell, id);
      return { level: id, levels: describeLevels(shell), onLevel: { walls: view.walls.length, rooms: view.rooms.length } };
    },
  }),

  tool({
    name: "set_stairs",
    description:
      "Add, change or delete a staircase. Stairs stand on a level and climb to the next level up, which gets an opening in its floor over them (with a balustrade); walking in the app follows them. Sides not against a wall get handrails. open: true makes them tread plates on stringers with nothing underneath (room for storage or a desk under the high end) instead of solid steps; spiral stairs are always open. position is the centre of the footprint; at rotation 0 you walk up towards north (-y), starting at the south end; rotation turns it clockwise. type: straight (size [width, length]), l (quarter turn with a landing in the far corner: up one side, then across the far end), u (half turn: up one side, across a landing, back down the other side; size [total width, length]) or spiral (size[0] = diameter). turn: which way l, u and spiral stairs turn going up (left = up the right-hand side, then across to the left). Without size it gets a comfortable one for the height (≈18 cm risers, 26 cm treads). Check get_overview's stairs (steps, footprint) and check_issues (steep stairs, furniture in the way or over the opening).",
    input: z.object({
      scene: sceneArg,
      id: z.string().optional().describe("existing stairs to change or delete; omit to add"),
      level: z.string().optional().describe("level for new stairs (default: the one open in the app)"),
      type: z.enum(STAIR_TYPES).optional(),
      position: vec2.optional(),
      rotation: z.number().optional(),
      size: vec2.optional().describe("footprint [width, length] cm"),
      width: z.number().positive().optional().describe("flight width of l and u stairs"),
      turn: z.enum(["left", "right"]).optional(),
      steps: z.number().int().min(2).max(40).optional().describe("number of risers (default: about 18 cm each)"),
      open: z.boolean().optional().describe("open underneath: treads on stringers instead of solid steps"),
      material: z.string().optional(),
      delete: z.boolean().optional(),
    }),
    async run(input, ctx) {
      if (input.id) {
        const id = input.id;
        if (input.delete) {
          await changeShell(ctx, input.scene, deleteStair(id), { item: id });
          return `deleted ${id}`;
        }
        const patch = Object.fromEntries(
          Object.entries({ type: input.type, position: input.position, rotation: input.rotation, size: input.size, width: input.width, turn: input.turn, steps: input.steps, open: input.open === undefined ? undefined : input.open || undefined, material: input.material }).filter(([k, v]) => v !== undefined || (k === "open" && input.open === false)),
        );
        const loaded = await loadScene(ctx, input.scene);
        const found = loaded.shell.stairs.find((s) => s.id === id);
        if (!found) throw new ToolError(`no stairs "${id}"`);
        const rise = stairRise(loaded.shell, found);
        const { levelShell: shell, shell: whole } = await changeShell(
          ctx,
          input.scene,
          (doc) => {
            // A new type without a size gets a size that suits it.
            const resize = input.type && !input.size && input.type !== found.type;
            return updateStair(id, { ...patch, ...(resize ? { size: defaultStairSize(input.type!, rise), width: undefined } : {}) })(doc);
          },
          { item: id },
        );
        return { stairs: describeStair(shell.stairs.find((s) => s.id === id)!, whole) };
      }
      if (!input.position) throw new ToolError("give position for new stairs");
      const loaded = await loadScene(ctx, input.scene);
      const level = pickLevel(ctx, loaded.shell, input.level);
      const type = input.type ?? "straight";
      const before = new Set(loaded.shell.stairs.map((s) => s.id));
      const { levelShell: shell, shell: whole } = await changeShell(
        ctx,
        input.scene,
        addStair({
          type: input.type,
          position: input.position as [number, number],
          rotation: input.rotation || undefined,
          size: (input.size as [number, number] | undefined) ?? defaultStairSize(type, riseFrom(loaded.shell, level)),
          width: input.width,
          turn: input.turn,
          steps: input.steps,
          open: input.open || undefined,
          material: input.material,
        }),
        { level },
      );
      const added = shell.stairs.find((s) => !before.has(s.id))!;
      const view = onLevel(whole, loaded.scene, level);
      return { added: describeStair(added, whole), issues: issuesFor(view.scene, view.shell).filter((i) => i.targets.some((t) => t.id === added.id)).map((i) => i.message) };
    },
  }),

  tool({
    name: "set_roof",
    description:
      "Add, change or delete a roof. A roof stands on a level's walls (the top level, usually: pass level) and covers an outline: polygon, or by default the outer faces of that level's walls. It covers the outline's convex hull, so an L-shaped house takes two roofs (one per wing). type: gable (ridge along x or y, default along the longer side; the ends are gable walls), hip (slopes on every side), shed (one slope down to down_to: north, east, south or west), flat. pitch in degrees (gable 35, hip 30, shed 15), overhang in cm past the outline (40; flat 10), thickness (20), material (a name or #rrggbb). The roof hides the rooms under it in the 3D view, so screenshots of the inside need the level below or the plan.",
    input: z.object({
      scene: sceneArg,
      id: z.string().optional().describe("existing roof to change or delete; omit to add"),
      level: z.string().optional().describe("level for a new roof (default: the one open in the app)"),
      type: z.enum(ROOF_TYPES).optional(),
      polygon: z.array(vec2).min(3).optional(),
      pitch: z.number().min(0).max(75).optional(),
      overhang: z.number().min(0).max(200).optional(),
      ridge: z.enum(["x", "y"]).optional(),
      down_to: z.enum(["north", "east", "south", "west"]).optional(),
      thickness: z.number().min(1).max(100).optional(),
      sloped_ceiling: z.boolean().optional().describe("the roof's underside is the ceiling of the rooms under it (a loft: knee walls, rooms open to the roof); inside walls rise to meet it"),
      material: z.string().optional(),
      delete: z.boolean().optional(),
    }),
    async run(input, ctx) {
      const ceiling = input.sloped_ceiling === undefined ? undefined : input.sloped_ceiling ? "sloped" : "flat";
      const fields = Object.fromEntries(
        Object.entries({ type: input.type, polygon: input.polygon, pitch: input.pitch, overhang: input.overhang, ridge: input.ridge, downTo: input.down_to, thickness: input.thickness, ceiling, material: input.material }).filter(([, v]) => v !== undefined),
      );
      if (input.id) {
        const id = input.id;
        if (input.delete) {
          await changeShell(ctx, input.scene, deleteRoof(id), { item: id });
          return `deleted ${id}`;
        }
        const { levelShell: shell } = await changeShell(
          ctx,
          input.scene,
          (doc) => {
            if (!doc.roofs?.some((r) => r.id === id)) throw new ToolError(`no roof "${id}"`);
            // A new type without its own pitch and overhang takes that type's.
            const retype = input.type ? { pitch: input.pitch, overhang: input.overhang } : {};
            return updateRoof(id, { ...retype, ...fields })(doc);
          },
          { item: id },
        );
        return { roof: describeRoof(shell.roofs.find((r) => r.id === id)!) };
      }
      const loaded = await loadScene(ctx, input.scene);
      const level = pickLevel(ctx, loaded.shell, input.level);
      const walls = levelShell(loaded.shell, level).walls;
      const polygon = (input.polygon as Vec[] | undefined) ?? (walls.length ? hullOf(walls.flatMap(wallOutline)) : undefined);
      if (!polygon) throw new ToolError("that level has no walls; give polygon");
      const before = new Set(loaded.shell.roofs.map((r) => r.id));
      const { levelShell: shell } = await changeShell(ctx, input.scene, addRoof({ type: input.type ?? "gable", ...fields, polygon }), { level });
      const added = shell.roofs.find((r) => !before.has(r.id))!;
      return { added: describeRoof(added), label: ROOF_LOOK[added.type].label };
    },
  }),

  tool({
    name: "set_plot",
    description:
      "Set the plot: the boundary of the land around the house (a polygon, plan cm), drawn as ground at the ground floor's level; or delete it. ground: a material name or #rrggbb for the ground outside areas (default grass green). The house should stand inside it.",
    input: z.object({ scene: sceneArg, polygon: z.array(vec2).min(3).optional(), ground: z.string().optional(), delete: z.boolean().optional() }),
    async run({ scene, polygon, ground, delete: remove }, ctx) {
      const loaded = await loadScene(ctx, scene);
      const level = siteLevel(loaded.shell);
      if (remove) {
        await changeShell(ctx, scene, setPlot(null), { level });
        return "deleted the plot";
      }
      if (!polygon && !loaded.shell.plot) throw new ToolError("give the plot's polygon");
      const change = polygon ? setPlot(polygon as Vec[], ground) : updatePlot({ material: ground });
      const { levelShell: shell } = await changeShell(ctx, scene, change, { level });
      return { plot: shell.plot, areaM2: r1(polygonArea(shell.plot!.polygon) / 10000) };
    },
  }),

  tool({
    name: "set_area",
    description:
      "Add, change or delete an outdoor area of the garden: lawn, paving (terrace, path, driveway), gravel, deck, bed (planting bed) or water (pool, pond). polygon in plan cm. height raises it (a deck or terrace, cm above the ground). material: a material name or #rrggbb (default: a colour for the kind). Areas listed later lie on top of earlier ones, so a path can cross a lawn. Keep areas out of the house's rooms. Plants are objects: add_object with template tree, conifer, shrub or planter.",
    input: z.object({
      scene: sceneArg,
      id: z.string().optional().describe("existing area to change or delete; omit to add"),
      name: z.string().optional(),
      kind: z.enum(AREA_KINDS).optional(),
      polygon: z.array(vec2).min(3).optional(),
      height: z.number().min(0).max(300).optional(),
      material: z.string().optional(),
      delete: z.boolean().optional(),
    }),
    async run(input, ctx) {
      const loaded = await loadScene(ctx, input.scene);
      const level = siteLevel(loaded.shell);
      if (input.id) {
        const id = input.id;
        if (!loaded.shell.areas.some((a) => a.id === id)) throw new ToolError(`no area "${id}"`);
        if (input.delete) {
          await changeShell(ctx, input.scene, deleteArea(id), { level });
          return `deleted ${id}`;
        }
        const patch = Object.fromEntries(Object.entries({ name: input.name, kind: input.kind, polygon: input.polygon, height: input.height === 0 ? undefined : input.height, material: input.material }).filter(([k, v]) => v !== undefined || (k === "height" && input.height === 0)));
        const { levelShell: shell } = await changeShell(ctx, input.scene, updateArea(id, patch), { level });
        return { area: shell.areas.find((a) => a.id === id) };
      }
      if (!input.polygon) throw new ToolError("give polygon for a new area");
      const kind = input.kind ?? "lawn";
      const before = new Set(loaded.shell.areas.map((a) => a.id));
      const { levelShell: shell, shell: whole } = await changeShell(
        ctx,
        input.scene,
        addArea({ name: input.name ?? AREA_LOOK[kind].label, kind, polygon: input.polygon as Vec[], height: input.height || undefined, material: input.material }),
        { level },
      );
      const added = shell.areas.find((a) => !before.has(a.id))!;
      const view = onLevel(whole, loaded.scene, level);
      return { added: { ...added, areaM2: r1(polygonArea(added.polygon) / 10000) }, issues: issuesFor(view.scene, view.shell).filter((i) => i.targets.some((t) => t.id === added.id)).map((i) => i.message) };
    },
  }),

  tool({
    name: "set_fence",
    description:
      "Add, change or delete garden fences. To add, give points: a fence runs along them, one straight fence per stretch (close a loop by repeating the first point). style: slats (default, 180 high), panel (boards), rail (post and rail, 110), hedge (150 high, 60 thick) or wall (garden wall). gates: openings, offset cm from the fence's from point and width. Fences block walking except at gates.",
    input: z.object({
      scene: sceneArg,
      id: z.string().optional().describe("existing fence to change or delete; omit to add"),
      points: z.array(vec2).min(2).optional(),
      style: z.enum(FENCE_STYLES).optional(),
      height: z.number().positive().optional(),
      thickness: z.number().positive().optional(),
      material: z.string().optional(),
      gates: z.array(z.object({ offset: z.number().min(0), width: z.number().positive() })).optional(),
      delete: z.boolean().optional(),
    }),
    async run(input, ctx) {
      const loaded = await loadScene(ctx, input.scene);
      const level = siteLevel(loaded.shell);
      const fields = Object.fromEntries(Object.entries({ style: input.style, height: input.height, thickness: input.thickness, material: input.material, gates: input.gates }).filter(([, v]) => v !== undefined));
      if (input.id) {
        const id = input.id;
        if (!loaded.shell.fences.some((f) => f.id === id)) throw new ToolError(`no fence "${id}"`);
        if (input.delete) {
          await changeShell(ctx, input.scene, deleteFence(id), { level });
          return `deleted ${id}`;
        }
        // A new style without sizes takes that style's sizes.
        const restyle = input.style && input.height === undefined && input.thickness === undefined ? { height: undefined, thickness: undefined } : {};
        const { levelShell: shell } = await changeShell(ctx, input.scene, updateFence(id, { ...restyle, ...fields }), { level });
        return { fence: shell.fences.find((f) => f.id === id) };
      }
      if (!input.points) throw new ToolError("give points for new fences");
      const before = new Set(loaded.shell.fences.map((f) => f.id));
      const { levelShell: shell } = await changeShell(ctx, input.scene, addFences(input.points as Vec[], fields), { level });
      const added = shell.fences.filter((f) => !before.has(f.id));
      return { added: added.map((f) => ({ id: f.id, from: f.from, to: f.to, style: FENCE_LOOK[f.style].label, length: r1(fenceLength(f)) })) };
    },
  }),

  tool({
    name: "set_background",
    description:
      "Show a floor plan image under the Plan view (it never changes the design) and/or set its scale and position. photo: a chat photo to use (\"photo-1\"). scale_from: two points on the image as fractions (0..1, x right, y down) and their real distance in cm, e.g. the ends of a dimension line. center: plan cm where the image's middle goes; rotation degrees clockwise. If the project already has a background (get_overview shows it) leave out photo; a photo of the same plan keeps the existing image unless replace is true. Returns how image points map to the plan.",
    input: z.object({
      photo: z.string().optional(),
      replace: z.boolean().optional(),
      scale_from: z.object({ a: fraction, b: fraction, length_cm: z.number().positive() }).optional(),
      center: vec2.optional(),
      rotation: z.number().optional(),
      opacity: z.number().min(0.1).max(1).optional(),
      visible: z.boolean().optional(),
    }),
    async run(input, ctx) {
      const project = await readProject(ctx);
      let underlay = project.underlay as z.input<typeof UnderlaySchema> | undefined;
      let kept = false;
      if (input.photo) {
        const m = /^photo-(\d+)$/.exec(input.photo);
        const photos = ctx.photos ? await ctx.photos() : [];
        const photo = m ? photos[Number(m[1]) - 1] : undefined;
        if (!photo) throw new ToolError(`no ${input.photo} in this chat`);
        const bytes = fromBase64(photo.data);
        const raster = await decode(bytes);
        // The chat's copy of a plan that is already the background (e.g. from
        // the new-home form) is a smaller version of the same image: keep the
        // sharper original. Image fractions mean the same on both.
        kept = Boolean(underlay && !input.replace && Math.abs(raster.width / raster.height - underlay.width / underlay.height) < 0.01);
        if (!kept) {
          const ext = photo.mimeType === "image/png" ? "png" : "jpg";
          const rel = `assets/plans/plan-${(await sha256Hex(bytes)).slice(0, 8)}.${ext}`;
          await projectFiles(ctx).write(rel, bytes);
          underlay = defaultUnderlay(rel, raster.width, raster.height);
        }
      }
      if (!underlay) throw new ToolError("there's no background yet; pass photo");
      if (input.scale_from) {
        const { a, b, length_cm } = input.scale_from;
        const u = UnderlaySchema.parse(underlay);
        const pa = pixelToPlan(u, [a[0] * u.width, a[1] * u.height]);
        const pb = pixelToPlan(u, [b[0] * u.width, b[1] * u.height]);
        underlay = calibrate(underlay, pa, pb, length_cm);
      }
      underlay = Object.fromEntries(
        Object.entries({ ...underlay, center: input.center ?? underlay.center, rotation: input.rotation ?? underlay.rotation, opacity: input.opacity ?? underlay.opacity, visible: input.visible ?? underlay.visible }).filter(([, v]) => v !== undefined),
      ) as typeof underlay;
      await writeJson(ctx, "project.json", { ...project, underlay });
      const result = describeUnderlay(UnderlaySchema.parse(underlay));
      return kept ? { ...result, kept: "This plan was already the background (same proportions), so its sharper original was kept. Pass replace: true to use the photo instead." } : result;
    },
  }),

  tool({
    name: "image_to_plan",
    description: "Convert points on the floor plan background image (fractions 0..1, x right, y down) to plan coordinates in cm, using its current scale and position. Use it to place walls exactly where the plan shows them.",
    input: z.object({ points: z.array(fraction).min(1).max(200) }),
    async run({ points }, ctx) {
      const project = await readProject(ctx);
      if (!project.underlay) throw new ToolError("there's no floor plan background; use set_background first");
      const u = UnderlaySchema.parse(project.underlay);
      return points.map(([fx, fy]) => pixelToPlan(u, [fx * u.width, fy * u.height]).map(r1));
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
          if (!(await projectFiles(ctx).exists(rel))) return rel;
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
    input: z.object({ scene: sceneArg, object_id: z.string(), name: z.string(), category: z.enum(["Kitchen", "Living", "Bedroom", "Bathroom", "Garden", "Lighting", "Decor", "Other"]), notes: z.string().optional() }),
    async run({ scene, object_id, name, category, notes }, ctx) {
      const { doc } = await loadScene(ctx, scene);
      const o = doc.objects?.find((x) => x.id === object_id);
      if (!o) throw new ToolError(`no object "${object_id}"`);
      const id = await freeLibraryId(ctx, slugify(name));
      if (o.model) {
        const data = await projectFiles(ctx).read(safe(o.model.src));
        if (!data) throw new ToolError(`the model file ${o.model.src} is missing`);
        await libraryFiles(ctx).write(`${id}/model.glb`, data);
      }
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
      await libraryFiles(ctx).write(`${id}/item.json`, JSON.stringify(item, null, 2) + "\n");
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
