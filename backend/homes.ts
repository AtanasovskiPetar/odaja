// A home's files and versions (see "Saving and conflicts" in docs/cloud-plan.md).
// Saving stores the content by hash, then moves the path in the home's manifest
// to it, in one transaction that checks the content it replaces (If-Match).
// Before a save, if the last version is a few minutes old and the home has
// changed since, the current manifest is kept as a version.
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { CloudDb } from "./db/index";
import { projects, versions, type Manifest, type ManifestEntry, type VersionReason, type VersionRow } from "./db/schema";
import { blobKey, FRESH_MS, putContent } from "./storage/content";
import type { BlobStore } from "./storage/s3";

export const AUTOSAVE_EVERY_MS = 5 * 60_000;

// Chats are private and change all the time: they're stored like any file, but
// don't count as a change of the home, and restoring a version leaves them.
const isPrivate = (rel: string) => rel.startsWith(".odaja/");

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

// Whether two manifests hold the same home (ignoring chats).
export function sameHome(a: Manifest, b: Manifest): boolean {
  const keys = (m: Manifest) => Object.keys(m).filter((k) => !isPrivate(k));
  const ka = keys(a);
  return ka.length === keys(b).length && ka.every((k) => b[k]?.hash === a[k]!.hash);
}

type Tx = Parameters<Parameters<CloudDb["transaction"]>[0]>[0];

// `expected`: the hash the save replaces; null = the file must not exist yet;
// "*" = it must exist; undefined = no check.
export type Expected = string | null | "*" | undefined;

export type SaveResult = { ok: true; entry: ManifestEntry | null; changed: boolean } | { ok: false; current: string | null };

function matches(current: ManifestEntry | undefined, expected: Expected): boolean {
  if (expected === undefined) return true;
  if (expected === null) return !current;
  if (expected === "*") return Boolean(current);
  return current?.hash === expected;
}

async function lockManifest(tx: Tx, projectId: string): Promise<Manifest> {
  const [row] = await tx.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, projectId)).for("update");
  if (!row) throw new Error("Project not found");
  return row.manifest;
}

async function autosave(tx: Tx, projectId: string, manifest: Manifest, authorId: string | null) {
  if (Object.keys(manifest).length === 0) return;
  const [last] = await tx
    .select({ createdAt: versions.createdAt, manifest: versions.manifest })
    .from(versions)
    .where(eq(versions.projectId, projectId))
    .orderBy(desc(versions.createdAt))
    .limit(1);
  if (last && (Date.now() - last.createdAt.getTime() < AUTOSAVE_EVERY_MS || sameHome(last.manifest, manifest))) return;
  await tx.insert(versions).values({ id: newId(), projectId, manifest, reason: "autosave", authorId });
}

export function createHomes(db: CloudDb, blobs: BlobStore) {
  // Change one path: new content, or null to delete it.
  async function save(projectId: string, rel: string, bytes: Uint8Array | null, expected: Expected, authorId: string | null, extra?: { name?: string }): Promise<SaveResult> {
    const entry = bytes ? await putContent(blobs, rel, bytes) : null;
    return db.transaction(async (tx) => {
      const manifest = await lockManifest(tx, projectId);
      const current = manifest[rel];
      if (!matches(current, expected)) return { ok: false as const, current: current?.hash ?? null };
      if ((current?.hash ?? null) === (entry?.hash ?? null)) return { ok: true as const, entry, changed: false };
      if (!isPrivate(rel)) await autosave(tx, projectId, manifest, authorId);
      const next = { ...manifest };
      if (entry) next[rel] = entry;
      else delete next[rel];
      await tx.update(projects).set({ manifest: next, updatedAt: new Date(), ...(extra?.name ? { name: extra.name } : {}) }).where(eq(projects.id, projectId));
      return { ok: true as const, entry, changed: true };
    });
  }

  // A manifest for new files (a new or imported home), stored by content.
  async function manifestOf(files: Record<string, Uint8Array | string>): Promise<Manifest> {
    const enc = new TextEncoder();
    const entries = await Promise.all(
      Object.entries(files).map(async ([rel, data]) => [rel, await putContent(blobs, rel, typeof data === "string" ? enc.encode(data) : data)] as const),
    );
    return Object.fromEntries(entries);
  }

  async function listVersions(projectId: string, limit = 200) {
    return db
      .select({ id: versions.id, reason: versions.reason, label: versions.label, createdAt: versions.createdAt, authorId: versions.authorId })
      .from(versions)
      .where(eq(versions.projectId, projectId))
      .orderBy(desc(versions.createdAt))
      .limit(limit);
  }

  async function addVersion(projectId: string, reason: VersionReason, label: string | null, authorId: string | null) {
    const [row] = await db.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, projectId));
    if (!row) throw new Error("Project not found");
    const id = newId();
    const createdAt = new Date();
    await db.insert(versions).values({ id, projectId, manifest: row.manifest, reason, label, authorId, createdAt });
    return { id, reason, label, createdAt };
  }

  // Make a version current again (keeping the current state as a version
  // first). Returns the paths that changed, for open tabs to reload.
  async function restore(projectId: string, versionId: string, authorId: string | null): Promise<string[] | null> {
    return db.transaction(async (tx) => {
      const [version] = await tx.select().from(versions).where(and(eq(versions.id, versionId), eq(versions.projectId, projectId)));
      if (!version) return null;
      const manifest = await lockManifest(tx, projectId);
      const when = version.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
      await tx.insert(versions).values({ id: newId(), projectId, manifest, reason: "before-restore", label: `Before restoring ${version.label ?? when}`, authorId });
      const next: Manifest = Object.fromEntries(Object.entries(version.manifest).filter(([rel]) => !isPrivate(rel)));
      for (const [rel, entry] of Object.entries(manifest)) if (isPrivate(rel)) next[rel] = entry;
      await tx.update(projects).set({ manifest: next, updatedAt: new Date() }).where(eq(projects.id, projectId));
      const paths = new Set([...Object.keys(manifest), ...Object.keys(next)]);
      return [...paths].filter((rel) => manifest[rel]?.hash !== next[rel]?.hash);
    });
  }

  return { save, manifestOf, listVersions, addVersion, restore };
}

export type Homes = ReturnType<typeof createHomes>;

// --- keeping history small ---------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Which versions to drop: all of the last day are kept, then the newest of
// each hour for a week, then the newest of each day (up to `keepDays`, if set).
// Named versions are always kept.
export function versionsToDrop(list: Pick<VersionRow, "id" | "createdAt" | "reason">[], now: number, keepDays?: number): string[] {
  const drop: string[] = [];
  const seen = new Set<string>();
  for (const v of [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const age = now - v.createdAt.getTime();
    if (v.reason === "named") continue;
    if (age < DAY) continue;
    if (keepDays !== undefined && age > keepDays * DAY) {
      drop.push(v.id);
      continue;
    }
    const t = v.createdAt.getTime();
    const bucket = age < 7 * DAY ? `h${Math.floor(t / HOUR)}` : `d${Math.floor(t / DAY)}`;
    if (seen.has(bucket)) drop.push(v.id);
    else seen.add(bucket);
  }
  return drop;
}

export async function thinVersions(db: CloudDb, now = Date.now(), keepDays?: number) {
  const old = await db
    .select({ id: versions.id, projectId: versions.projectId, createdAt: versions.createdAt, reason: versions.reason })
    .from(versions)
    .where(lt(versions.createdAt, new Date(now - DAY)));
  const byProject = new Map<string, typeof old>();
  for (const v of old) byProject.set(v.projectId, [...(byProject.get(v.projectId) ?? []), v]);
  let dropped = 0;
  for (const list of byProject.values()) {
    const ids = versionsToDrop(list, now, keepDays);
    for (let i = 0; i < ids.length; i += 500) await db.delete(versions).where(inArray(versions.id, ids.slice(i, i + 500)));
    dropped += ids.length;
  }
  return dropped;
}

// Delete stored content that no home and no version uses any more. Content
// stored in the last day is left alone: a save may be about to use it (a save
// that reuses older content writes it again first, see putContent).
export async function collectGarbage(db: CloudDb, blobs: BlobStore, now = Date.now()) {
  const used = new Set<string>();
  const add = (m: Manifest) => Object.values(m).forEach((e) => used.add(blobKey(e)));
  for (const row of await db.select({ manifest: projects.manifest }).from(projects)) add(row.manifest);
  for (const row of await db.select({ manifest: versions.manifest }).from(versions)) add(row.manifest);
  let deleted = 0;
  for (const obj of await blobs.listDetailed("blobs/")) {
    if (used.has(obj.key) || now - obj.lastModified < FRESH_MS) continue;
    // Written again since the listing (a save reusing it): keep it.
    const modified = await blobs.modified(obj.key);
    if (modified === null || Date.now() - modified < FRESH_MS) continue;
    await blobs.del(obj.key);
    deleted++;
  }
  return deleted;
}
