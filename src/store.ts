import { create } from "zustand";
import type { z } from "zod";
import { followWalls } from "./model/attach";
import { detachTemplate } from "./model/operations";
import { compactPart } from "./model/partOps";
import { newSceneFile, type StarterRoom } from "./model/defaults";
import { formatJson } from "./model/format";
import {
  DEFAULT_SHELL,
  ProjectSchema,
  SceneSchema,
  ShellSchema,
  type Project,
  type ProjectDoc,
  type Scene,
  type SceneDoc,
  type Shell,
  type ShellDoc,
} from "./model/schema";
import type { MissingItem } from "./ui/libraryFiles";
import { platform, type ProjectList, type ProjectSummary, type SceneSummary } from "./platform";

export type ViewMode = "3d" | "plan" | "walk";

// Where you stand and look while walking: plan cm, and yaw in radians
// (0 = looking north, growing counter-clockwise seen from above).
export interface WalkPose {
  x: number;
  y: number;
  yaw: number;
}
// Furnish: move furniture, walls are fixed. Structure: edit walls, doors,
// windows and rooms, furniture is faded and fixed.
export type EditMode = "furnish" | "structure";
export type Tool = "select" | "wall" | "room" | "door" | "window";
// A wall, opening or room; or an enclosed area with no room yet, which can be
// turned into one.
export type StructureSelection =
  | { kind: "wall" | "opening" | "room"; id: string }
  | { kind: "area"; polygon: [number, number][] }
  | null;

// Where the plan camera is looking, so the 2D overlay can line up with it.
export interface PlanView {
  centerX: number; // world metres
  centerZ: number;
  zoom: number; // pixels per metre
  width: number; // viewport pixels
  height: number;
}

export interface FileError {
  path: string;
  message: string;
}

// A dialog over the app: importing model files, or saving an object to the
// library.
export type Dialog =
  | { kind: "import"; files: File[] }
  | { kind: "save"; objectId: string }
  | { kind: "materials"; focus?: string }
  // Saving the home to a .odaja file (asks about chats when it has some).
  | { kind: "save-file"; saveAs?: boolean }
  // Opening a .odaja file over the home in the browser (asks first).
  | { kind: "open-home"; file: File; handle?: FileSystemFileHandle }
  | { kind: "export-image" }
  // After opening a home: its library items you don't have yet.
  | { kind: "add-to-library"; items: MissingItem[] }
  | null;

// One undoable step: the before/after content of every file it touched.
interface FileEdit {
  path: string;
  before: unknown;
  after: unknown;
}
type UndoEntry = FileEdit[];

interface OdajaState {
  // "start" shows the start screen (no project open).
  status: "loading" | "start" | "project";
  projectsRoot: string;
  projects: ProjectSummary[];
  sampleDir: string;
  sampleCopied: boolean;
  // The website's home and the one it replaced (null in dev and the companion).
  homes: ProjectList["homes"] | null;
  // The website: the open home has changes not yet saved to a .odaja file.
  unsavedToFile: boolean;
  projectDir: string | null;
  projectDoc: ProjectDoc | null;
  project: Project | null;
  scenes: SceneSummary[];
  scenePath: string | null;
  // The *Doc fields are files as written (what gets saved back, so files keep
  // only the fields their author wrote); scene and shell are the same data
  // with defaults filled in, used for rendering.
  sceneDoc: SceneDoc | null;
  scene: Scene | null;
  shellPath: string;
  shellDoc: ShellDoc | null;
  shell: Shell | null;
  // shell.json when the open scene uses a different shell, to show what a
  // renovation option changes.
  baseShell: Shell | null;
  errors: FileError[];
  selectedId: string | null;
  structureSelection: StructureSelection;
  mode: EditMode;
  tool: Tool;
  hideFurniture: boolean;
  showChanges: boolean;
  // The issue being looked at (highlighted on the plan).
  focusedIssue: string | null;
  dialog: Dialog;
  // Bumped when the furniture library changes, so lists reload.
  libraryVersion: number;
  // A short message shown briefly at the bottom of the view.
  notice: string | null;
  wallThickness: number;
  wallsCut: boolean;
  viewMode: ViewMode;
  frameRequest: number;
  planView: PlanView | null;
  // Shape editor: the object whose parts are being edited, the selected
  // part indices, and what dragging the handles does.
  editingObjectId: string | null;
  partSelection: number[];
  partTool: "move" | "rotate" | "size";
  // Floor plan background: panel open, and the active tool on the plan.
  underlayPanel: boolean;
  underlayTool: "calibrate" | "move" | null;
  // Camera request to frame something (world metres).
  focus: { center: [number, number, number]; radius: number; at: number } | null;
  // Walking: where to start (picked on the plan), the current pose (for the
  // mini-map), eye height in cm, and whether the next plan click picks a start.
  walkStart: { position: [number, number]; heading: [number, number] } | null;
  walkPose: WalkPose | null;
  eyeHeight: number;
  pickingWalkStart: boolean;
  // Live position of an object while it is being dragged (not saved yet).
  dragPreview: { id: string; position: [number, number] } | null;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  load(): Promise<void>;
  refreshProjects(): Promise<void>;
  openSample(fresh: boolean): Promise<void>;
  // Open a .odaja file (the website replaces its home; the companion adds a folder).
  openHomeFile(data: Uint8Array): Promise<void>;
  setUnsavedToFile(unsaved: boolean): void;
  openProject(dir: string): Promise<void>;
  createProject(name: string, room?: StarterRoom): Promise<void>;
  closeProject(): Promise<void>;
  openScene(path: string): Promise<void>;
  newScene(): Promise<string>;
  duplicateScene(withWalls?: boolean): Promise<string | null>;
  renameScene(path: string, name: string): Promise<void>;
  deleteScene(path: string): Promise<void>;
  select(id: string | null): void;
  selectStructure(selection: StructureSelection): void;
  setMode(mode: EditMode): void;
  setTool(tool: Tool): void;
  setWallThickness(cm: number): void;
  toggleHideFurniture(): void;
  toggleShowChanges(): void;
  focusIssue(key: string | null): void;
  openDialog(dialog: Dialog): void;
  libraryChanged(): void;
  setNotice(message: string | null): void;
  applyProject(change: (doc: ProjectDoc) => ProjectDoc): void;
  toggleWallsCut(): void;
  setViewMode(mode: ViewMode): void;
  setPlanView(view: PlanView): void;
  setDragPreview(preview: OdajaState["dragPreview"]): void;
  startWalk(start: OdajaState["walkStart"]): void;
  setPickingWalkStart(picking: boolean): void;
  setWalkPose(pose: WalkPose | null): void;
  setEyeHeight(cm: number): void;
  editShape(objectId: string): void;
  stopEditingShape(): void;
  selectParts(indices: number[]): void;
  setPartTool(tool: OdajaState["partTool"]): void;
  focusOn(center: [number, number, number], radius: number): void;
  setUnderlayPanel(open: boolean): void;
  setUnderlayTool(tool: OdajaState["underlayTool"]): void;
  apply(change: (doc: SceneDoc) => SceneDoc): void;
  applyShell(change: (doc: ShellDoc) => ShellDoc): Promise<void>;
  undo(): void;
  redo(): void;
}

// Text we last wrote per file, so our own saves don't come back as "external" edits.
const lastWritten = new Map<string, string>();

// The last scene opened in each project, so reopening a project returns to it.
const LAST_SCENE_KEY = "odaja:last-scene";
function rememberScene(dir: string, path: string) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_SCENE_KEY) ?? "{}");
    localStorage.setItem(LAST_SCENE_KEY, JSON.stringify({ ...all, [dir]: path }));
  } catch {
    // Storage unavailable: just don't remember.
  }
}
function lastScene(dir: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(LAST_SCENE_KEY) ?? "{}")[dir];
  } catch {
    return undefined;
  }
}

// Per-project state, cleared when switching projects.
const EMPTY_PROJECT = {
  projectDir: null,
  projectDoc: null,
  project: null,
  scenes: [],
  scenePath: null,
  sceneDoc: null,
  scene: null,
  shellPath: DEFAULT_SHELL,
  shellDoc: null,
  shell: null,
  baseShell: null,
  errors: [],
  selectedId: null,
  structureSelection: null,
  dragPreview: null,
  undoStack: [],
  redoStack: [],
};

async function readJson<S extends z.ZodType>(path: string, schema: S): Promise<{ data: z.infer<S>; raw: z.input<S> }> {
  const text = await platform.readFile(path);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"));
  }
  return { data: result.data, raw: json as z.input<S> };
}

export const useOdaja = create<OdajaState>((set, get) => {
  // Load one file, recording a visible error instead of throwing, so a bad
  // edit by an agent shows up in the app rather than blanking the scene.
  async function loadFile<S extends z.ZodType>(path: string, schema: S) {
    try {
      const loaded = await readJson(path, schema);
      set((s) => ({ errors: s.errors.filter((e) => e.path !== path) }));
      return loaded;
    } catch (err) {
      set((s) => ({ errors: [...s.errors.filter((e) => e.path !== path), { path, message: (err as Error).message }] }));
      return null;
    }
  }

  function write(path: string, doc: unknown) {
    if (platform.kind === "browser" && !get().unsavedToFile) set({ unsavedToFile: true });
    const text = formatJson(doc);
    lastWritten.set(path, text);
    platform.writeFile(path, text).catch((err) => console.error("save failed", path, err));
  }

  // Put a file's content into the store (if it's the open scene or shell)
  // and save it.
  function applyFile(path: string, doc: unknown) {
    const s = get();
    if (path === s.scenePath) set({ sceneDoc: doc as SceneDoc, scene: SceneSchema.parse(doc) });
    if (path === s.shellPath) set({ shellDoc: doc as ShellDoc, shell: ShellSchema.parse(doc) });
    if (path === "project.json") set({ projectDoc: doc as ProjectDoc, project: ProjectSchema.parse(doc) });
    write(path, doc);
  }

  function commit(edits: FileEdit[]) {
    if (edits.length === 0) return;
    for (const e of edits) applyFile(e.path, e.after);
    set((s) => ({ undoStack: [...s.undoStack, edits], redoStack: [] }));
  }

  async function loadShell(path: string) {
    const loaded = await loadFile(path, ShellSchema);
    set({ shellPath: path, shellDoc: loaded?.raw ?? null, shell: loaded?.data ?? null });
    if (path === DEFAULT_SHELL) {
      set({ baseShell: null });
    } else {
      const base = await loadFile(DEFAULT_SHELL, ShellSchema);
      set({ baseShell: base?.data ?? null });
    }
  }

  async function refreshScenes() {
    const { scenes } = await platform.listScenes();
    set({ scenes });
    // The open scene was deleted or renamed outside the app: open another.
    const current = get().scenePath;
    if (current && !scenes.some((sc) => sc.path === current) && scenes.length > 0) {
      await get().openScene(scenes[0].path);
    }
  }

  async function loadProject() {
    const { dir, scenes } = await platform.listScenes();
    set({ ...EMPTY_PROJECT, status: "project", projectDir: dir, scenes, mode: "furnish", tool: "select", viewMode: "3d", frameRequest: get().frameRequest + 1 });
    const project = await loadFile("project.json", ProjectSchema);
    set({ project: project?.data ?? null, projectDoc: project?.raw ?? null });
    const remembered = lastScene(dir);
    const first = scenes.find((sc) => sc.path === remembered) ?? scenes[0];
    if (first) await get().openScene(first.path);
    else await loadShell(DEFAULT_SHELL);
  }

  // An agent created a scene and wants it shown.
  platform.onOpenSceneRequest(async (path) => {
    if (get().status !== "project") return;
    await refreshScenes();
    await get().openScene(path);
  });

  platform.onFileChanged(async (path) => {
    const s = get();
    if (s.status !== "project") return;
    if (path.startsWith("scenes/")) await refreshScenes();
    if (path === "project.json") {
      const text = await platform.readFile(path).catch(() => null);
      if (text === null || text === lastWritten.get(path)) return;
      const loaded = await loadFile(path, ProjectSchema);
      if (loaded) set({ project: loaded.data, projectDoc: loaded.raw });
      return;
    }
    const isScene = path === s.scenePath;
    const isShell = path === s.shellPath;
    if (!isScene && !isShell) {
      if (path === DEFAULT_SHELL && s.baseShell) {
        const base = await loadFile(path, ShellSchema);
        if (base) set({ baseShell: base.data });
      }
      return;
    }
    const text = await platform.readFile(path).catch(() => null);
    if (text === null || text === lastWritten.get(path)) return;
    const loaded = await loadFile(path, isScene ? SceneSchema : ShellSchema);
    if (!loaded) return;
    const before = isScene ? get().sceneDoc : get().shellDoc;
    if (isScene) {
      set({ sceneDoc: loaded.raw as SceneDoc, scene: loaded.data as Scene });
      // A scene can switch to a different shell.
      const shellPath = (loaded.data as Scene).shell ?? DEFAULT_SHELL;
      if (shellPath !== get().shellPath) await loadShell(shellPath);
    } else {
      set({ shellDoc: loaded.raw as ShellDoc, shell: loaded.data as Shell });
    }
    // External edits are undoable too, so you can roll back an agent's change.
    if (before) set((st) => ({ undoStack: [...st.undoStack, [{ path, before, after: loaded.raw }]], redoStack: [] }));
  });

  return {
    ...EMPTY_PROJECT,
    status: "loading",
    projectsRoot: "",
    projects: [],
    sampleDir: "",
    sampleCopied: false,
    homes: null,
    unsavedToFile: false,
    mode: "furnish",
    tool: "select",
    hideFurniture: false,
    showChanges: true,
    focusedIssue: null,
    dialog: null,
    libraryVersion: 0,
    notice: null,
    wallThickness: 12,
    wallsCut: false,
    viewMode: "3d",
    frameRequest: 0,
    planView: null,
    editingObjectId: null,
    partSelection: [],
    partTool: "move",
    underlayPanel: false,
    underlayTool: null,
    focus: null,
    walkStart: null,
    walkPose: null,
    eyeHeight: 160,
    pickingWalkStart: false,

    async load() {
      const { current, homes } = await platform.listProjects();
      set({ unsavedToFile: homes?.unsavedToFile ?? false });
      if (current) await loadProject();
      else await get().refreshProjects();
    },

    async refreshProjects() {
      const { root, projects, sampleDir, sampleCopied, homes } = await platform.listProjects();
      set({ projectsRoot: root, projects, sampleDir, sampleCopied, homes: homes ?? null, ...(get().status === "loading" ? { status: "start" } : {}) });
    },

    async openProject(dir) {
      await platform.openProject(dir);
      const { homes } = await platform.listProjects();
      set({ unsavedToFile: homes?.unsavedToFile ?? false });
      await loadProject();
    },

    async openSample(fresh) {
      await platform.openSample(fresh);
      set({ unsavedToFile: false });
      await loadProject();
    },

    async openHomeFile(data) {
      await platform.importHome(data);
      set({ unsavedToFile: false });
      await loadProject();
    },

    setUnsavedToFile(unsaved) {
      set({ unsavedToFile: unsaved });
    },

    async createProject(name, room) {
      await platform.createProject(name, room);
      set({ unsavedToFile: false });
      await loadProject();
      // A new project starts in the plan view, where its size is visible.
      get().setViewMode("plan");
    },

    async closeProject() {
      await platform.closeProject();
      set({ ...EMPTY_PROJECT, status: "start" });
      await get().refreshProjects();
    },

    async openScene(path) {
      set({ scenePath: path, selectedId: null, structureSelection: null, dragPreview: null, undoStack: [], redoStack: [], editingObjectId: null, partSelection: [] });
      const loaded = await loadFile(path, SceneSchema);
      // Ignore a slow load that finished after the user switched scenes.
      if (get().scenePath !== path) return;
      set({ sceneDoc: loaded?.raw ?? null, scene: loaded?.data ?? null });
      platform.reportUiState({ scenePath: path });
      await loadShell(loaded?.data.shell ?? DEFAULT_SHELL);
      const dir = get().projectDir;
      if (dir) rememberScene(dir, path);
    },

    async newScene() {
      // New scenes use the walls of the scene you're in.
      const shell = get().shellPath;
      const path = await platform.createScene("New scene", {
        ...newSceneFile("New scene"),
        ...(shell !== DEFAULT_SHELL ? { shell } : {}),
      });
      await refreshScenes();
      await get().openScene(path);
      return path;
    },

    async duplicateScene(withWalls = false) {
      const { sceneDoc, scene, shellPath } = get();
      if (!sceneDoc || !scene) return null;
      const name = `${scene.name} (copy)`;
      let content: SceneDoc = sceneDoc;
      if (withWalls) content = { ...sceneDoc, shell: await platform.copyShell(shellPath, name) };
      const path = await platform.createScene(name, content);
      await refreshScenes();
      await get().openScene(path);
      return path;
    },

    async renameScene(path, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const next = await platform.renameScene(path, trimmed);
      if (get().scenePath === path) {
        // Keep the open scene under its new file name. Its undo history points
        // at the old file name, so start a fresh one.
        set((s) => ({
          scenePath: next,
          sceneDoc: s.sceneDoc ? { ...s.sceneDoc, name: trimmed } : null,
          scene: s.scene ? { ...s.scene, name: trimmed } : null,
          undoStack: [],
          redoStack: [],
        }));
        const dir = get().projectDir;
        if (dir) rememberScene(dir, next);
        platform.reportUiState({ scenePath: next });
      }
      await refreshScenes();
    },

    async deleteScene(path) {
      await platform.deleteScene(path);
      await refreshScenes();
      const { scenes, scenePath } = get();
      if (scenePath === path && scenes.length > 0) await get().openScene(scenes[0].path);
    },

    select(id) {
      set({ selectedId: id });
    },

    selectStructure(structureSelection) {
      set({ structureSelection });
    },

    // Structure editing happens on the plan.
    setMode(mode) {
      set({ mode, tool: "select", selectedId: null, structureSelection: null });
      if (mode === "structure" && get().viewMode !== "plan") get().setViewMode("plan");
    },

    setTool(tool) {
      set({ tool, structureSelection: null });
    },

    setWallThickness(wallThickness) {
      set({ wallThickness });
    },

    toggleHideFurniture() {
      set((s) => ({ hideFurniture: !s.hideFurniture }));
    },

    toggleShowChanges() {
      set((s) => ({ showChanges: !s.showChanges }));
    },

    focusIssue(focusedIssue) {
      set({ focusedIssue });
    },

    openDialog(dialog) {
      set({ dialog });
    },

    libraryChanged() {
      set((s) => ({ libraryVersion: s.libraryVersion + 1 }));
    },

    setNotice(notice) {
      set({ notice });
      if (notice) setTimeout(() => get().notice === notice && set({ notice: null }), 5000);
    },

    // Change project.json (materials, name), undoably.
    applyProject(change) {
      const { projectDoc } = get();
      if (!projectDoc) return;
      const next = change(projectDoc);
      if (next !== projectDoc) commit([{ path: "project.json", before: projectDoc, after: next }]);
    },

    toggleWallsCut() {
      set((s) => ({ wallsCut: !s.wallsCut }));
    },

    // Choosing a view again re-frames the camera on the whole flat. Leaving
    // the plan also leaves structure editing.
    setViewMode(viewMode) {
      set((s) => ({
        viewMode,
        frameRequest: s.frameRequest + 1,
        ...(viewMode !== "plan" && s.mode === "structure" ? { mode: "furnish" as const, tool: "select" as const, structureSelection: null } : {}),
        ...(viewMode !== "walk" ? { walkPose: null } : {}),
        ...(viewMode !== "3d" ? { editingObjectId: null, partSelection: [] } : {}),
        ...(viewMode !== "plan" ? { underlayPanel: false, underlayTool: null } : {}),
        pickingWalkStart: false,
      }));
    },

    setPlanView(planView) {
      set({ planView });
    },

    setDragPreview(dragPreview) {
      set({ dragPreview });
    },

    // Walk from a picked spot, or from the default start (null).
    startWalk(walkStart) {
      set({ walkStart, pickingWalkStart: false, selectedId: null });
      get().setViewMode("walk");
    },

    setPickingWalkStart(pickingWalkStart) {
      set({ pickingWalkStart });
    },

    setWalkPose(walkPose) {
      set({ walkPose });
    },

    setEyeHeight(eyeHeight) {
      set({ eyeHeight });
    },

    // Open the shape editor for an object. Template objects are turned into
    // parts first (one undo step); 3D models can't be edited as parts.
    editShape(objectId) {
      const s = get();
      const doc = s.sceneDoc?.objects?.find((o) => o.id === objectId);
      const parsed = s.scene?.objects.find((o) => o.id === objectId);
      if (!doc || !parsed) return;
      if (doc.model) {
        get().setNotice("This is an imported 3D model; its shape can't be edited as parts. Resize it in the inspector.");
        return;
      }
      if (!doc.parts) get().apply(detachTemplate(objectId, parsed.parts.map(compactPart)));
      set({ editingObjectId: objectId, selectedId: objectId, partSelection: [], partTool: "move", mode: "furnish", tool: "select", structureSelection: null });
      platform.reportUiState({ editingObject: objectId });
      if (get().viewMode !== "3d") get().setViewMode("3d");
      // Frame the object.
      const xs = parsed.parts.map((p) => p.at[0]);
      const ys = parsed.parts.map((p) => p.at[1]);
      const top = Math.max(...parsed.parts.map((p) => p.at[2])) + parsed.elevation;
      const [cx, cy] = [parsed.position[0] + (Math.min(...xs) + Math.max(...xs)) / 2, parsed.position[1] + (Math.min(...ys) + Math.max(...ys)) / 2];
      const size = Math.max(60, Math.max(...xs) - Math.min(...xs) + 100, Math.max(...ys) - Math.min(...ys) + 100, top + 60);
      get().focusOn([cx / 100, (parsed.elevation + top / 2) / 100, cy / 100], size / 100);
    },

    stopEditingShape() {
      set({ editingObjectId: null, partSelection: [] });
      platform.reportUiState({ editingObject: null });
    },

    selectParts(partSelection) {
      set({ partSelection });
    },

    setPartTool(partTool) {
      set({ partTool });
    },

    setUnderlayPanel(underlayPanel) {
      set({ underlayPanel, underlayTool: null });
      if (underlayPanel && get().viewMode !== "plan") get().setViewMode("plan");
    },

    setUnderlayTool(underlayTool) {
      set({ underlayTool });
    },

    focusOn(center, radius) {
      set({ focus: { center, radius, at: Date.now() } });
    },

    apply(change) {
      const { sceneDoc, scenePath } = get();
      if (!sceneDoc || !scenePath) return;
      const next = change(sceneDoc);
      if (next !== sceneDoc) commit([{ path: scenePath, before: sceneDoc, after: next }]);
    },

    // Change the walls. Objects attached to walls that moved follow them, in
    // every scene that uses this shell, all in one undo step.
    async applyShell(change) {
      const { shellDoc, shell, shellPath, sceneDoc, scenePath, scenes } = get();
      if (!shellDoc || !shell) return;
      const nextDoc = change(shellDoc);
      if (nextDoc === shellDoc) return;
      const next = ShellSchema.parse(nextDoc);
      const edits: FileEdit[] = [{ path: shellPath, before: shellDoc, after: nextDoc }];
      if (sceneDoc && scenePath) {
        const followed = followWalls(sceneDoc, shell, next);
        if (followed !== sceneDoc) edits.push({ path: scenePath, before: sceneDoc, after: followed });
      }
      const others = scenes.filter((sc) => sc.path !== scenePath && sc.shell === shellPath);
      for (const other of others) {
        try {
          const doc = JSON.parse(await platform.readFile(other.path)) as SceneDoc;
          const followed = followWalls(doc, shell, next);
          if (followed !== doc) edits.push({ path: other.path, before: doc, after: followed });
        } catch {
          // Unreadable scene: leave it alone; it shows its own error when opened.
        }
      }
      commit(edits);
    },

    undo() {
      const entry = get().undoStack.at(-1);
      if (!entry) return;
      for (const e of entry) applyFile(e.path, e.before);
      set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, entry] }));
    },

    redo() {
      const entry = get().redoStack.at(-1);
      if (!entry) return;
      for (const e of entry) applyFile(e.path, e.after);
      set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, entry] }));
    },
  };
});
