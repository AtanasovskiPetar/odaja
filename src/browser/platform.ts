// The website's host: the open home and the furniture library live in the
// browser's private file system (see homes.ts), and nothing needs a server.
// Same interface as the server-backed platform (src/platform.ts).
import { newProjectFile, newSceneFile, newShellFile, slugify } from "../model/defaults";
import { formatJson } from "../model/format";
import { belongsInFile, packHome, unpackHome } from "../model/homeFile";
import type { LibraryEntry, Platform, SceneSummary } from "../platform";
import * as homes from "./homes";
import * as opfs from "./opfs";
import { sampleFiles } from "./sample";

const LIBRARY = "library";

// Files are shown through blob: URLs, made when a home or the library is
// opened and refreshed whenever a file is written, so fileUrl() can answer at once.
class UrlTable {
  private urls = new Map<string, string>();
  get(path: string) {
    return this.urls.get(path) ?? "";
  }
  set(path: string, blob: Blob) {
    const old = this.urls.get(path);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(path, URL.createObjectURL(blob));
  }
  clear() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

// Data files are read as text; everything else (models, images) gets a URL.
const isData = (path: string) => /\.(json|md)$/i.test(path);

async function sha256(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createBrowserPlatform(): Platform {
  // The home shown in the app. Going back to the start screen closes it for
  // this visit; coming back to the site opens it straight away.
  let open: string | null = null;
  let closedThisVisit = false;
  let changed = false;
  const files = new UrlTable();
  const libraryFiles = new UrlTable();
  // Changes the platform makes itself (adding a library material) are
  // announced like the server's file watcher does, so the app reloads them.
  const changeListeners: ((path: string) => void)[] = [];
  const announce = (rel: string) => changeListeners.forEach((cb) => cb(rel));

  function current(): string {
    if (!open) throw new Error("no home is open");
    return open;
  }
  const inHome = (rel: string) => homes.homePath(current(), rel);

  async function openHome(id: string) {
    files.clear();
    open = id;
    changed = (await homes.readState()).unsavedToFile[id] ?? false;
    closedThisVisit = false;
    for (const rel of await opfs.walk(homes.homePath(id))) {
      if (isData(rel)) continue;
      const file = await opfs.readFile(homes.homePath(id, rel));
      if (file) files.set(rel, file);
    }
  }

  async function write(rel: string, data: opfs.Data) {
    const id = current();
    await opfs.writeFile(homes.homePath(id, rel), data);
    if (!isData(rel)) {
      const file = await opfs.readFile(homes.homePath(id, rel));
      if (file) files.set(rel, file);
    }
    if (!changed) {
      changed = true;
      await homes.markChanged(id);
    }
  }

  async function readJsonIn(rel: string) {
    const text = await opfs.readText(inHome(rel));
    if (text === null) throw new Error(`not found: ${rel}`);
    return JSON.parse(text);
  }

  async function freeScenePath(name: string, except?: string) {
    const stem = slugify(name);
    for (let n = 1; ; n++) {
      const rel = `scenes/${stem}${n === 1 ? "" : `-${n}`}.json`;
      if (rel === except || !(await opfs.exists(inHome(rel)))) return rel;
    }
  }

  async function listScenes(): Promise<{ dir: string; scenes: SceneSummary[] }> {
    const id = current();
    const names = (await opfs.list(homes.homePath(id, "scenes"))).filter((e) => e.kind === "file" && e.name.endsWith(".json"));
    const scenes = await Promise.all(
      names.map(async ({ name: file }) => {
        const rel = `scenes/${file}`;
        let name = file.replace(/\.json$/, "");
        let shell = "shell.json";
        try {
          const scene = await readJsonIn(rel);
          name = String(scene.name ?? name);
          if (typeof scene.shell === "string") shell = scene.shell;
        } catch {
          // Invalid file: show its file name; the app reports the error when opened.
        }
        return { path: rel, name, shell };
      }),
    );
    return { dir: `browser:${id}`, scenes };
  }

  async function replaceHome(content: Record<string, opfs.Data>) {
    await openHome(await homes.addHome(content));
  }

  // The open home, or (on the start screen) the one kept in the browser.
  async function homeForSaving(): Promise<string> {
    const id = open ?? (await homes.readState()).current;
    if (!id) throw new Error("there's no home to save");
    return id;
  }

  // Every file of the home that belongs in a saved file.
  async function homeFiles(id: string, includeChats: boolean): Promise<Record<string, Uint8Array>> {
    const out: Record<string, Uint8Array> = {};
    for (const rel of await opfs.walk(homes.homePath(id))) {
      if (!belongsInFile(rel, includeChats)) continue;
      const file = await opfs.readFile(homes.homePath(id, rel));
      if (file) out[rel] = new Uint8Array(await file.arrayBuffer());
    }
    return out;
  }

  async function refreshLibraryUrls(id: string) {
    for (const rel of await opfs.walk(`${LIBRARY}/${id}`)) {
      if (isData(rel)) continue;
      const file = await opfs.readFile(`${LIBRARY}/${id}/${rel}`);
      if (file) libraryFiles.set(`${id}/${rel}`, file);
    }
  }

  return {
    kind: "browser",

    async listProjects() {
      const state = await homes.readState();
      const [currentHome, previousHome] = await Promise.all([homes.summary(state.current), homes.summary(state.previous)]);
      // Coming back to the site goes straight into the home.
      if (currentHome && !open && !closedThisVisit) await openHome(currentHome.id);
      return {
        root: "this browser",
        current: open ? `browser:${open}` : null,
        projects: [],
        sampleDir: "",
        sampleCopied: false,
        homes: { current: currentHome, previous: previousHome, unsavedToFile: currentHome ? (state.unsavedToFile[currentHome.id] ?? false) : false },
      };
    },

    async openProject(dir) {
      const state = await homes.readState();
      if (dir === "previous") await openHome(await homes.swapWithPrevious());
      else if (state.current && (dir === "current" || dir === `browser:${state.current}`)) await openHome(state.current);
      else throw new Error("that home isn't in this browser");
    },

    async openSample() {
      await replaceHome(await sampleFiles());
    },

    async createProject(name, room) {
      const clean = name.trim();
      if (!clean) throw new Error("give the home a name");
      if (room && !(room.width > 0 && room.depth > 0 && (room.height ?? 1) > 0)) throw new Error("room sizes must be positive");
      await replaceHome({
        "project.json": formatJson(newProjectFile(clean)),
        "shell.json": formatJson(newShellFile(room)),
        "scenes/main.json": formatJson(newSceneFile("Main")),
      });
    },

    async closeProject() {
      open = null;
      closedThisVisit = true;
      files.clear();
    },

    listScenes,

    async createScene(name, content) {
      const rel = await freeScenePath(name);
      await write(rel, formatJson({ ...content, name }));
      return rel;
    },

    async renameScene(from, name) {
      const scene = await readJsonIn(from);
      scene.name = name;
      const to = await freeScenePath(name, from);
      await write(to, formatJson(scene));
      if (to !== from) await opfs.remove(inHome(from));
      return to;
    },

    async deleteScene(rel) {
      if (!/^scenes\/[^/]+\.json$/.test(rel)) throw new Error("not a scene file");
      if ((await listScenes()).scenes.length <= 1) throw new Error("can't delete the only scene");
      await opfs.remove(inHome(rel));
    },

    async copyShell(from, name) {
      const text = await opfs.readText(inHome(from));
      if (text === null) throw new Error(`not found: ${from}`);
      const stem = slugify(name);
      for (let n = 1; ; n++) {
        const rel = `shells/${stem}${n === 1 ? "" : `-${n}`}.json`;
        if (!(await opfs.exists(inHome(rel)))) {
          await write(rel, text);
          return rel;
        }
      }
    },

    async readFile(rel) {
      const text = await opfs.readText(inHome(rel));
      if (text === null) throw new Error(`not found: ${rel}`);
      return text;
    },

    writeFile: write,

    fileUrl: (rel) => files.get(rel),

    // --- library ---------------------------------------------------------

    async listLibrary() {
      libraryFiles.clear();
      const dirs = (await opfs.list(LIBRARY)).filter((e) => e.kind === "directory");
      const items = await Promise.all(
        dirs.map(async ({ name: id }): Promise<LibraryEntry | null> => {
          const file = await opfs.readFile(`${LIBRARY}/${id}/item.json`);
          if (!file) return null; // Not an item (yet).
          try {
            const item = JSON.parse(await file.text());
            await refreshLibraryUrls(id);
            const preview = await opfs.exists(`${LIBRARY}/${id}/preview.png`);
            return { id, item, preview, modified: file.lastModified };
          } catch {
            return null; // A broken item.
          }
        }),
      );
      return { root: "this browser", items: items.filter((i) => i !== null).sort((a, b) => b.modified - a.modified) };
    },

    async newLibraryItem(name) {
      const stem = slugify(name);
      for (let n = 1; ; n++) {
        const id = `${stem}${n === 1 ? "" : `-${n}`}`;
        if (!(await opfs.exists(`${LIBRARY}/${id}`))) {
          await opfs.writeFile(`${LIBRARY}/${id}/.keep`, "");
          return id;
        }
      }
    },

    async writeLibraryFile(rel, data) {
      await opfs.writeFile(`${LIBRARY}/${rel}`, data);
      if (!isData(rel)) {
        const file = await opfs.readFile(`${LIBRARY}/${rel}`);
        if (file) libraryFiles.set(rel, file);
      }
    },

    libraryFileUrl: (rel) => libraryFiles.get(rel),

    async deleteLibraryItem(id) {
      await opfs.remove(`${LIBRARY}/${id}`);
    },

    // Copy a library model into the home, named by content so placing the
    // same item twice reuses the file and edited items don't clash.
    async placeLibraryModel(id) {
      const file = await opfs.readFile(`${LIBRARY}/${id}/model.glb`);
      if (!file) throw new Error(`"${id}" has no model`);
      const data = await file.arrayBuffer();
      const rel = `assets/models/${id}-${(await sha256(data)).slice(0, 8)}.glb`;
      if (!(await opfs.exists(inHome(rel)))) await write(rel, data);
      return rel;
    },

    // Copy a library material into the home: its texture into
    // assets/textures/ and the material into project.json under a free name.
    async addLibraryMaterial(id) {
      const text = await opfs.readText(`${LIBRARY}/${id}/item.json`);
      if (text === null) throw new Error(`"${id}" isn't in the library`);
      const item = JSON.parse(text);
      if (!item.material) throw new Error(`"${id}" is not a material`);
      const material = { ...structuredClone(item.material), libraryItem: { id, category: item.category } };
      if (material.tile?.image) {
        const image = await opfs.readFile(`${LIBRARY}/${id}/${material.tile.image}`);
        if (image) {
          const rel = `assets/textures/${id}${material.tile.image.slice(material.tile.image.lastIndexOf("."))}`;
          await write(rel, image);
          material.tile.image = rel;
        }
      }
      const project = await readJsonIn("project.json");
      project.materials ??= {};
      let name = id;
      for (let n = 2; project.materials[name] && JSON.stringify(project.materials[name]) !== JSON.stringify(material); n++) name = `${id}-${n}`;
      project.materials[name] = material;
      await write("project.json", formatJson(project));
      announce("project.json");
      return name;
    },

    async exportHome(includeChats) {
      const zip = packHome(await homeFiles(await homeForSaving(), includeChats));
      return new Blob([zip as BlobPart], { type: "application/octet-stream" });
    },

    async homeHasChats() {
      return (await opfs.walk(homes.homePath(await homeForSaving(), ".odaja/chats"))).some((p) => p.endsWith(".json"));
    },

    async importHome(data) {
      const files = unpackHome(data);
      await replaceHome(Object.fromEntries(Object.entries(files).map(([rel, bytes]) => [rel, new Blob([bytes as BlobPart])])));
    },

    async markSavedToFile() {
      const id = await homeForSaving();
      if (id === open) changed = false;
      await homes.markSaved(id);
    },

    onFileChanged(callback) {
      changeListeners.push(callback);
    },
    // Agents connect through the companion, so there are no requests from
    // them here (yet).
    reportUiState() {},
    onOpenSceneRequest() {},
    onScreenshotRequest() {},
  };
}
