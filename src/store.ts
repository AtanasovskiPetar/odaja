import { create } from "zustand";
import type { z } from "zod";
import { formatJson } from "./model/format";
import type { StarterRoom } from "./model/defaults";
import { newSceneFile } from "./model/defaults";
import { platform, type ProjectSummary, type SceneSummary } from "./platform";
import { ProjectSchema, SceneSchema, ShellSchema, type Project, type Scene, type SceneDoc, type Shell } from "./model/schema";

export type ViewMode = "3d" | "plan";

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

interface OdajaState {
  // "start" shows the start screen (no project open).
  status: "loading" | "start" | "project";
  projectsRoot: string;
  projects: ProjectSummary[];
  projectDir: string | null;
  project: Project | null;
  shell: Shell | null;
  scenes: SceneSummary[];
  scenePath: string | null;
  // sceneDoc is the file as written (what gets saved back, so files keep only
  // the fields their author wrote); scene is the same data with defaults filled
  // in, used for rendering.
  sceneDoc: SceneDoc | null;
  scene: Scene | null;
  errors: FileError[];
  selectedId: string | null;
  wallsCut: boolean;
  viewMode: ViewMode;
  frameRequest: number;
  planView: PlanView | null;
  // Live position of an object while it is being dragged (not saved yet).
  dragPreview: { id: string; position: [number, number] } | null;
  undoStack: SceneDoc[];
  redoStack: SceneDoc[];

  load(): Promise<void>;
  refreshProjects(): Promise<void>;
  openProject(dir: string): Promise<void>;
  createProject(name: string, room?: StarterRoom): Promise<void>;
  closeProject(): Promise<void>;
  openScene(path: string): Promise<void>;
  newScene(): Promise<string>;
  duplicateScene(): Promise<string | null>;
  renameScene(path: string, name: string): Promise<void>;
  deleteScene(path: string): Promise<void>;
  select(id: string | null): void;
  toggleWallsCut(): void;
  setViewMode(mode: ViewMode): void;
  setPlanView(view: PlanView): void;
  setDragPreview(preview: OdajaState["dragPreview"]): void;
  apply(change: (doc: SceneDoc) => SceneDoc): void;
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
  project: null,
  shell: null,
  scenes: [],
  scenePath: null,
  sceneDoc: null,
  scene: null,
  errors: [],
  selectedId: null,
  dragPreview: null,
  undoStack: [],
  redoStack: [],
};

function serialize(doc: SceneDoc): string {
  return formatJson(doc);
}

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

  function showDoc(doc: SceneDoc) {
    return { sceneDoc: doc, scene: SceneSchema.parse(doc) };
  }

  function save(doc: SceneDoc) {
    const path = get().scenePath;
    if (!path) return;
    const text = serialize(doc);
    lastWritten.set(path, text);
    platform.writeFile(path, text).catch((err) => console.error("save failed", err));
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
    set({ ...EMPTY_PROJECT, status: "project", projectDir: dir, scenes, viewMode: "3d", frameRequest: get().frameRequest + 1 });
    const [project, shell] = await Promise.all([loadFile("project.json", ProjectSchema), loadFile("shell.json", ShellSchema)]);
    set({ project: project?.data ?? null, shell: shell?.data ?? null });
    const remembered = lastScene(dir);
    const first = scenes.find((sc) => sc.path === remembered) ?? scenes[0];
    if (first) await get().openScene(first.path);
  }

  platform.onFileChanged(async (path) => {
    const s = get();
    if (s.status !== "project") return;
    if (path.startsWith("scenes/")) await refreshScenes();
    if (path === "project.json") {
      const loaded = await loadFile(path, ProjectSchema);
      if (loaded) set({ project: loaded.data });
    } else if (path === "shell.json") {
      const loaded = await loadFile(path, ShellSchema);
      if (loaded) set({ shell: loaded.data });
    } else if (path === s.scenePath) {
      const text = await platform.readFile(path).catch(() => null);
      if (text === null || text === lastWritten.get(path)) return;
      const loaded = await loadFile(path, SceneSchema);
      if (!loaded) return;
      // External edits are undoable too, so you can roll back an agent's change.
      const previous = get().sceneDoc;
      set((st) => ({
        sceneDoc: loaded.raw,
        scene: loaded.data,
        undoStack: previous ? [...st.undoStack, previous] : st.undoStack,
        redoStack: [],
      }));
    }
  });

  return {
    ...EMPTY_PROJECT,
    status: "loading",
    projectsRoot: "",
    projects: [],
    wallsCut: false,
    viewMode: "3d",
    frameRequest: 0,
    planView: null,

    async load() {
      const { current } = await platform.listProjects();
      if (current) await loadProject();
      else await get().refreshProjects();
    },

    async refreshProjects() {
      const { root, projects } = await platform.listProjects();
      set({ projectsRoot: root, projects, ...(get().status === "loading" ? { status: "start" } : {}) });
    },

    async openProject(dir) {
      await platform.openProject(dir);
      await loadProject();
    },

    async createProject(name, room) {
      await platform.createProject(name, room);
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
      set({ scenePath: path, selectedId: null, dragPreview: null, undoStack: [], redoStack: [] });
      const loaded = await loadFile(path, SceneSchema);
      // Ignore a slow load that finished after the user switched scenes.
      if (get().scenePath !== path) return;
      set({ sceneDoc: loaded?.raw ?? null, scene: loaded?.data ?? null });
      const dir = get().projectDir;
      if (dir) rememberScene(dir, path);
    },

    async newScene() {
      const path = await platform.createScene("New scene", newSceneFile("New scene"));
      await refreshScenes();
      await get().openScene(path);
      return path;
    },

    async duplicateScene() {
      const { sceneDoc, scene } = get();
      if (!sceneDoc || !scene) return null;
      const path = await platform.createScene(`${scene.name} (copy)`, sceneDoc);
      await refreshScenes();
      await get().openScene(path);
      return path;
    },

    async renameScene(path, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const next = await platform.renameScene(path, trimmed);
      if (get().scenePath === path) {
        // Keep the open scene (and its undo history) under its new file name.
        set((s) => ({
          scenePath: next,
          sceneDoc: s.sceneDoc ? { ...s.sceneDoc, name: trimmed } : null,
          scene: s.scene ? { ...s.scene, name: trimmed } : null,
          undoStack: s.undoStack.map((d) => ({ ...d, name: trimmed })),
          redoStack: s.redoStack.map((d) => ({ ...d, name: trimmed })),
        }));
        const dir = get().projectDir;
        if (dir) rememberScene(dir, next);
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

    toggleWallsCut() {
      set((s) => ({ wallsCut: !s.wallsCut }));
    },

    // Choosing a view again re-frames the camera on the whole flat.
    setViewMode(viewMode) {
      set((s) => ({ viewMode, frameRequest: s.frameRequest + 1 }));
    },

    setPlanView(planView) {
      set({ planView });
    },

    setDragPreview(dragPreview) {
      set({ dragPreview });
    },

    apply(change) {
      const current = get().sceneDoc;
      if (!current) return;
      const next = change(current);
      if (next === current) return;
      set((s) => ({ ...showDoc(next), undoStack: [...s.undoStack, current], redoStack: [] }));
      save(next);
    },

    undo() {
      const { undoStack, sceneDoc } = get();
      const previous = undoStack.at(-1);
      if (!previous || !sceneDoc) return;
      set((s) => ({ ...showDoc(previous), undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, sceneDoc] }));
      save(previous);
    },

    redo() {
      const { redoStack, sceneDoc } = get();
      const next = redoStack.at(-1);
      if (!next || !sceneDoc) return;
      set((s) => ({ ...showDoc(next), redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, sceneDoc] }));
      save(next);
    },
  };
});
