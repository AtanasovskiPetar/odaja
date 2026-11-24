// The AI tools' file access for a home in the account (src/agent/files.ts):
// read from the content store, written with the same checks as the app's own
// saves. A file the tools read is written back only if it still has the
// content they read (If-Match); if the user changed it in the app meanwhile,
// the tool fails with a message and the model reads it again. Every write is
// announced to open tabs, which reload it.
import { eq } from "drizzle-orm";
import { checkPath, type AgentFiles, type FileArea, type FileData } from "../../src/agent/files";
import type { CloudDb } from "../db/index";
import { projects, type Manifest } from "../db/schema";
import type { HomeEvents } from "../events";
import type { Homes } from "../homes";
import { getContent } from "../storage/content";
import type { BlobStore } from "../storage/s3";

// More than any design file; images and models the tools write are smaller.
const MAX_FILE = 30 * 1024 * 1024;

export interface HomeFilesDeps {
  db: CloudDb;
  blobs: BlobStore;
  homes: Homes;
  events: HomeEvents;
}

export interface HomeArea extends FileArea {
  // Files this area changed (path → new hash, null when deleted), in order.
  changed: Map<string, string | null>;
}

export function homeArea(deps: HomeFilesDeps, projectId: string, authorId: string): HomeArea {
  const { db, blobs, homes, events } = deps;
  // What the tools saw of each file: its hash, or null if it wasn't there.
  const seen = new Map<string, string | null>();
  const changed = new Map<string, string | null>();
  // Content by its hash: it never changes, so what the tools read or wrote
  // isn't fetched from storage again during the reply.
  const contents = new Map<string, Uint8Array>();

  async function manifest(): Promise<Manifest> {
    const [row] = await db.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, projectId));
    if (!row) throw new Error("This home no longer exists.");
    return row.manifest;
  }

  async function read(rel: string): Promise<Uint8Array | null> {
    const clean = checkPath(rel);
    const entry = (await manifest())[clean];
    seen.set(clean, entry?.hash ?? null);
    if (!entry) return null;
    const known = contents.get(entry.hash);
    if (known) return known;
    const bytes = await getContent(blobs, entry);
    if (bytes) contents.set(entry.hash, bytes);
    return bytes;
  }

  const children = async (dir: string) => {
    const prefix = dir ? `${checkPath(dir)}/` : "";
    return Object.keys(await manifest())
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length));
  };

  return {
    changed,
    read,
    async readText(rel) {
      const bytes = await read(rel);
      return bytes && new TextDecoder().decode(bytes);
    },
    async write(rel, data: FileData) {
      const clean = checkPath(rel);
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      if (bytes.byteLength > MAX_FILE) throw new Error(`${clean} is too big to save (${Math.round(bytes.byteLength / 1e6)} MB)`);
      // Unread files are written as they are (new assets, mostly).
      const expected = seen.has(clean) ? seen.get(clean) : undefined;
      const res = await homes.save(projectId, clean, bytes, expected, authorId);
      if (!res.ok) {
        seen.delete(clean);
        throw new Error(`${clean} was changed in the app while you were working on it. Look at it again (get_overview or read_file) and redo the change.`);
      }
      const hash = res.entry!.hash;
      seen.set(clean, hash);
      contents.set(hash, bytes);
      if (res.changed) {
        changed.set(clean, hash);
        events.publish(projectId, { path: clean, hash });
      }
    },
    listFiles: async (dir) => (await children(dir)).filter((p) => !p.includes("/")),
    listDirs: async (dir) => [...new Set((await children(dir)).filter((p) => p.includes("/")).map((p) => p.slice(0, p.indexOf("/"))))],
    async exists(rel) {
      const clean = checkPath(rel);
      return Object.keys(await manifest()).some((p) => p === clean || p.startsWith(`${clean}/`));
    },
  };
}

// The furniture library is the user's computer's (docs/cloud-platform.md):
// the server can't see it. Reading finds nothing; saving says why.
export const noLibrary: FileArea = {
  read: async () => null,
  readText: async () => null,
  async write() {
    throw new Error("The furniture library is on the user's computer, so it can't be changed from here. The home itself was saved; the user can add the item to their library in the app.");
  },
  listFiles: async () => [],
  listDirs: async () => [],
  exists: async () => false,
};

export const homeFiles = (project: FileArea): AgentFiles => ({ project, library: noLibrary });
