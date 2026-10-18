// The AI tools' file access on disk (development and the companion): the
// open project folder and the furniture library folder.
import fs from "node:fs/promises";
import path from "node:path";
import { checkPath, type AgentFiles, type FileArea } from "../src/agent/files";

function folderArea(root: string): FileArea {
  // "" is the folder itself; anything else must stay inside it.
  const abs = (rel: string) => {
    if (!rel) return root;
    const full = path.resolve(root, ...checkPath(rel).split("/"));
    if (!full.startsWith(root + path.sep)) throw new Error(`path escapes ${root}: ${rel}`);
    return full;
  };
  const entries = (dir: string) => fs.readdir(abs(dir), { withFileTypes: true }).catch(() => []);
  return {
    read: (rel) => fs.readFile(abs(rel)).then((b) => new Uint8Array(b), () => null),
    readText: (rel) => fs.readFile(abs(rel), "utf8").catch(() => null),
    async write(rel, data) {
      const file = abs(rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    },
    listFiles: async (dir) => (await entries(dir)).filter((e) => e.isFile()).map((e) => e.name),
    listDirs: async (dir) => (await entries(dir)).filter((e) => e.isDirectory()).map((e) => e.name),
    exists: (rel) => fs.stat(abs(rel)).then(() => true, () => false),
  };
}

export const folderFiles = (projectDir: string, libraryRoot: string): AgentFiles => ({
  project: folderArea(projectDir),
  library: folderArea(libraryRoot),
});
