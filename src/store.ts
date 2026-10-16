import { create } from "zustand";
import type { z } from "zod";
import { formatJson } from "./model/format";
import { platform } from "./platform";
import { ProjectSchema, SceneSchema, ShellSchema, type Project, type Scene, type SceneDoc, type Shell } from "./model/schema";

export interface FileError {
  path: string;
  message: string;
}

interface OdajaState {
  projectDir: string;
  project: Project | null;
  shell: Shell | null;
  scenePaths: string[];
  scenePath: string | null;
  // sceneDoc is the file as written (what gets saved back, so files keep only
  // the fields their author wrote); scene is the same data with defaults filled
  // in, used for rendering.
  sceneDoc: SceneDoc | null;
  scene: Scene | null;
  errors: FileError[];
  selectedId: string | null;
  wallsCut: boolean;
  viewRequest: { kind: "top" | "perspective"; at: number } | null;
  undoStack: SceneDoc[];
  redoStack: SceneDoc[];

  load(): Promise<void>;
  openScene(path: string): Promise<void>;
  select(id: string | null): void;
  toggleWallsCut(): void;
  requestView(kind: "top" | "perspective"): void;
  apply(change: (doc: SceneDoc) => SceneDoc): void;
  undo(): void;
  redo(): void;
}

// Text we last wrote per file, so our own saves don't come back as "external" edits.
const lastWritten = new Map<string, string>();

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

  platform.onFileChanged(async (path) => {
    const s = get();
    if (path.startsWith("scenes/")) {
      const { scenes } = await platform.listScenes();
      set({ scenePaths: scenes });
    }
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
    projectDir: "",
    project: null,
    shell: null,
    scenePaths: [],
    scenePath: null,
    sceneDoc: null,
    scene: null,
    errors: [],
    selectedId: null,
    wallsCut: false,
    viewRequest: null,
    undoStack: [],
    redoStack: [],

    async load() {
      const { dir, scenes } = await platform.listScenes();
      const [project, shell] = await Promise.all([
        loadFile("project.json", ProjectSchema),
        loadFile("shell.json", ShellSchema),
      ]);
      set({ projectDir: dir, project: project?.data ?? null, shell: shell?.data ?? null, scenePaths: scenes });
      if (scenes.length > 0) await get().openScene(scenes[0]);
    },

    async openScene(path) {
      set({ scenePath: path, selectedId: null, undoStack: [], redoStack: [] });
      const loaded = await loadFile(path, SceneSchema);
      set({ sceneDoc: loaded?.raw ?? null, scene: loaded?.data ?? null });
    },

    select(id) {
      set({ selectedId: id });
    },

    toggleWallsCut() {
      set((s) => ({ wallsCut: !s.wallsCut }));
    },

    requestView(kind) {
      set({ viewRequest: { kind, at: Date.now() } });
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
