// Levels (storeys). Walls, rooms and objects name their level; without one
// they are on the first level listed, and a shell without `levels` is one
// level, the ground floor. Doors and windows are on their wall's level.
//
// The app and the tools work on one level at a time: a level's view of the
// shell is an ordinary shell with only that level's walls, openings and rooms
// (and its wall height), so snapping, rooms, checks and edits work unchanged.
// An edited view is merged back into the whole shell.
import { slugify } from "./defaults";
import type { Level, LevelDoc, Scene, SceneDoc, Shell, ShellDoc, Stair } from "./schema";

export const GROUND_ID = "ground";
export const GROUND: Level = { id: GROUND_ID, name: "Ground floor", elevation: 0, slab: 20 };

const SLAB = 20;

// The levels, in the order listed (the first one holds everything without a
// `level`).
export function levelsOf(shell: { levels?: Level[] }): Level[] {
  return shell.levels?.length ? shell.levels : [GROUND];
}

// Highest first, the way a building is drawn.
export function levelsTopDown(shell: { levels?: Level[] }): Level[] {
  return [...levelsOf(shell)].sort((a, b) => b.elevation - a.elevation);
}

const firstId = (shell: { levels?: { id: string }[] }) => shell.levels?.[0]?.id ?? GROUND_ID;

// A level by id, falling back to the first level.
export function levelById(shell: { levels?: Level[] }, id: string | null | undefined): Level {
  const levels = levelsOf(shell);
  return levels.find((l) => l.id === id) ?? levels[0];
}

export const hasLevels = (shell: { levels?: unknown[] }) => (shell.levels?.length ?? 0) > 1;

// The level something is on. An unknown level (a typo by hand) counts as the
// first level, so the object still shows up.
export function levelOf(item: { level?: string }, shell: { levels?: { id: string }[] }): string {
  return item.level && shell.levels?.some((l) => l.id === item.level) ? item.level : firstId(shell);
}

// The lowest level has no slab under it.
export function isLowest(shell: { levels?: Level[] }, level: Level): boolean {
  return levelsOf(shell).every((l) => l.elevation >= level.elevation);
}

// The next level up from a level, if any.
export function levelAbove(shell: Shell, levelId: string): Level | undefined {
  const here = levelById(shell, levelId);
  return levelsOf(shell)
    .filter((l) => l.elevation > here.elevation)
    .sort((a, b) => a.elevation - b.elevation)[0];
}

// How high stairs on a level climb: up to the next level's floor, else a
// storey's height.
export function riseFrom(shell: Shell, levelId: string): number {
  const here = levelById(shell, levelId);
  const above = levelAbove(shell, here.id);
  return above ? above.elevation - here.elevation : (here.height ?? shell.wallHeight) + here.slab;
}

// How high a stair climbs: its own rise, else riseFrom its level.
export function stairRise(shell: Shell, stair: Stair): number {
  return stair.rise ?? riseFrom(shell, levelOf(stair, shell));
}

// Stairs from the level below that arrive on a level (they cut openings in
// its floor), with how high they climb. A stair with its own, different rise
// (up to a gallery, say) doesn't arrive.
export function stairsArriving(shell: Shell, levelId: string): { stair: Stair; rise: number; from: Level }[] {
  const here = levelById(shell, levelId);
  return shell.stairs.flatMap((stair) => {
    const from = levelById(shell, levelOf(stair, shell));
    const rise = stairRise(shell, stair);
    const arrives = levelAbove(shell, from.id)?.id === here.id && Math.abs(rise - (here.elevation - from.elevation)) < 5;
    return arrives ? [{ stair: { ...stair, rise }, rise, from }] : [];
  });
}

// The plot, outdoor areas and fences are on the first level (the site is at
// its floor height); other levels' views leave them out.
const NO_SITE = { plot: undefined, areas: [], fences: [] };

// --- views ------------------------------------------------------------------

// A level's view of the shell also knows the stairs coming up through its
// floor (for checks); they aren't part of any file.
export type ShellView = Shell & { arriving?: Stair[] };

// A level's stairs have their rise filled in, since it depends on the level
// above.
export function levelShell(shell: Shell, levelId: string): ShellView {
  const level = levelById(shell, levelId);
  const stairs = shell.stairs.filter((s) => levelOf(s, shell) === level.id).map((s) => (s.rise ? s : { ...s, rise: stairRise(shell, s) }));
  if (!shell.levels.length) return stairs.length ? { ...shell, stairs } : shell;
  const walls = shell.walls.filter((w) => levelOf(w, shell) === level.id);
  const ids = new Set(walls.map((w) => w.id));
  const arriving = stairsArriving(shell, level.id).map((a) => a.stair);
  return {
    ...shell,
    ...(level.id === shell.levels[0].id ? {} : NO_SITE),
    wallHeight: level.height ?? shell.wallHeight,
    walls,
    openings: shell.openings.filter((o) => ids.has(o.wall)),
    rooms: shell.rooms.filter((r) => levelOf(r, shell) === level.id),
    stairs,
    roofs: shell.roofs.filter((r) => levelOf(r, shell) === level.id),
    ...(arriving.length ? { arriving } : {}),
  };
}

export function levelScene(scene: Scene, shell: Shell, levelId: string): Scene {
  if (!shell.levels.length) return scene;
  const id = levelById(shell, levelId).id;
  return { ...scene, objects: scene.objects.filter((o) => levelOf(o, shell) === id) };
}

// The same on the file as written, for editing.
export function levelDoc(doc: ShellDoc, levelId: string): ShellDoc {
  if (!doc.levels?.length) return doc;
  const level = doc.levels.find((l) => l.id === levelId) ?? doc.levels[0];
  const on = (x: { level?: string }) => levelOf(x, doc) === level.id;
  const walls = (doc.walls ?? []).filter(on);
  const ids = new Set(walls.map((w) => w.id));
  return {
    ...doc,
    ...(level.id === doc.levels[0].id ? {} : NO_SITE),
    wallHeight: level.height ?? doc.wallHeight,
    walls,
    openings: (doc.openings ?? []).filter((o) => ids.has(o.wall)),
    rooms: (doc.rooms ?? []).filter(on),
    stairs: (doc.stairs ?? []).filter(on),
    roofs: (doc.roofs ?? []).filter(on),
  };
}

// Replace a level's items in `list` by `next`, where the level's items were
// (so the file changes as little as possible).
function mergeList<T>(list: T[], on: (x: T) => boolean, next: T[]): T[] {
  const at = list.findIndex(on);
  const rest = list.filter((x) => !on(x));
  const index = at < 0 ? rest.length : list.slice(0, at).filter((x) => !on(x)).length;
  return [...rest.slice(0, index), ...next, ...rest.slice(index)];
}

const itemIds = (d: ShellDoc) => [...(d.walls ?? []), ...(d.openings ?? []), ...(d.rooms ?? []), ...(d.stairs ?? []), ...(d.roofs ?? []), ...(d.areas ?? []), ...(d.fences ?? [])].map((x) => x.id);

// Put an edited level view back into the whole shell. New walls and rooms are
// given the level (except on the first level, where they need none); a
// changed wallHeight is the level's height. Edits only see their level, so a
// new item can get an id another level already uses: it's renamed.
export function mergeLevelDoc(doc: ShellDoc, levelId: string, edited: ShellDoc): ShellDoc {
  if (!doc.levels?.length) return edited;
  const level = doc.levels.find((l) => l.id === levelId) ?? doc.levels[0];
  const first = level.id === firstId(doc);
  const on = (x: { level?: string }) => levelOf(x, doc) === level.id;
  const before = levelDoc(doc, level.id);
  const mine = new Set(itemIds(before));
  const taken = new Set([...itemIds(doc).filter((id) => !mine.has(id)), ...itemIds(edited)]);
  const renamed = new Map<string, string>();
  for (const id of itemIds(edited)) {
    if (mine.has(id) || !itemIds(doc).includes(id)) continue;
    let next = `${id}-${level.id}`;
    for (let n = 2; taken.has(next); n++) next = `${id}-${level.id}-${n}`;
    taken.add(next);
    renamed.set(id, next);
  }
  const renamedSite = <T extends { id: string }>(x: T): T => (renamed.has(x.id) ? { ...x, id: renamed.get(x.id)! } : x);
  // The site is edited only through the first level's view.
  const site = first ? { plot: edited.plot, areas: edited.areas?.map(renamedSite), fences: edited.fences?.map(renamedSite) } : {};
  const tag = <T extends { id: string; level?: string }>(x: T): T => {
    const id = renamed.get(x.id) ?? x.id;
    return first || x.level ? (id === x.id ? x : { ...x, id }) : { ...x, id, level: level.id };
  };
  const openings = (edited.openings ?? []).map((o) => (renamed.has(o.id) || renamed.has(o.wall) ? { ...o, id: renamed.get(o.id) ?? o.id, wall: renamed.get(o.wall) ?? o.wall } : o));
  const wallIds = new Set((before.walls ?? []).map((w) => w.id));
  const height = edited.wallHeight !== undefined && edited.wallHeight !== before.wallHeight ? edited.wallHeight : undefined;
  const merged: ShellDoc = {
    ...(height === undefined ? doc : updateLevel(level.id, { height })(doc)),
    ...site,
    walls: mergeList(doc.walls ?? [], on, (edited.walls ?? []).map(tag)),
    openings: mergeList(doc.openings ?? [], (o) => wallIds.has(o.wall), openings),
    rooms: mergeList(doc.rooms ?? [], on, (edited.rooms ?? []).map(tag)),
    ...(doc.stairs || edited.stairs?.length ? { stairs: mergeList(doc.stairs ?? [], on, (edited.stairs ?? []).map(tag)) } : {}),
    ...(doc.roofs || edited.roofs?.length ? { roofs: mergeList(doc.roofs ?? [], on, (edited.roofs ?? []).map(tag)) } : {}),
  };
  // Keep files free of empty site keys they never had.
  for (const key of ["plot", "areas", "fences"] as const) {
    if (merged[key] === undefined || (Array.isArray(merged[key]) && !(merged[key] as unknown[]).length && !doc[key])) delete merged[key];
  }
  return merged;
}

// Objects added by an edit (ids that weren't there) go on the given level.
export function placeNewObjects(before: SceneDoc, after: SceneDoc, shell: Shell, levelId: string): SceneDoc {
  const id = levelById(shell, levelId).id;
  if (!shell.levels.length || id === shell.levels[0].id) return after;
  const old = new Set((before.objects ?? []).map((o) => o.id));
  if (!(after.objects ?? []).some((o) => !old.has(o.id) && !o.level)) return after;
  return { ...after, objects: (after.objects ?? []).map((o) => (!old.has(o.id) && !o.level ? { ...o, level: id } : o)) };
}

// Which level a wall, opening or room is on (null if there's no such item).
export function levelOfItem(doc: ShellDoc, itemId: string): string | null {
  const wall = (doc.walls ?? []).find((w) => w.id === itemId);
  if (wall) return levelOf(wall, doc);
  const opening = (doc.openings ?? []).find((o) => o.id === itemId);
  const host = opening && (doc.walls ?? []).find((w) => w.id === opening.wall);
  if (host) return levelOf(host, doc);
  const room = (doc.rooms ?? []).find((r) => r.id === itemId) ?? (doc.stairs ?? []).find((s) => s.id === itemId) ?? (doc.roofs ?? []).find((r) => r.id === itemId);
  return room ? levelOf(room, doc) : null;
}

// --- editing levels -----------------------------------------------------------

const ORDINALS = ["Ground floor", "First floor", "Second floor", "Third floor", "Fourth floor", "Fifth floor"];

function freeLevelId(doc: ShellDoc, name: string): string {
  const taken = new Set([...(doc.levels ?? []).map((l) => l.id), GROUND_ID]);
  const stem = slugify(name).replace(/[^a-z0-9-]/g, "") || "level";
  let id = stem;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`;
  return id;
}

// Add a level. Without `elevation` it goes on top of the highest one. A shell
// that had no levels first gets its ground floor listed, so what's there
// stays on it. Returns the new doc and the level's id.
export function addLevel(doc: ShellDoc, fields: { name?: string; elevation?: number; height?: number; slab?: number } = {}): { doc: ShellDoc; id: string } {
  const listed: LevelDoc[] = doc.levels?.length ? doc.levels : [{ id: GROUND_ID, name: GROUND.name, elevation: 0 }];
  const wallHeight = doc.wallHeight ?? 260;
  const top = listed.reduce((a, b) => (b.elevation > a.elevation ? b : a));
  const slab = fields.slab ?? SLAB;
  const name = fields.name?.trim() || ORDINALS[listed.filter((l) => l.elevation >= 0).length] || `Floor ${listed.length}`;
  const id = freeLevelId({ ...doc, levels: listed }, name);
  const level: LevelDoc = {
    id,
    name,
    elevation: fields.elevation ?? top.elevation + (top.height ?? wallHeight) + slab,
    ...(fields.height !== undefined && fields.height !== wallHeight ? { height: fields.height } : {}),
    ...(fields.slab !== undefined && fields.slab !== SLAB ? { slab: fields.slab } : {}),
  };
  return { doc: { ...doc, levels: [...listed, level] }, id };
}

export function updateLevel(levelId: string, patch: { name?: string; elevation?: number; height?: number | null; slab?: number }) {
  return (doc: ShellDoc): ShellDoc => {
    // The implicit ground floor is listed once it's changed.
    const listed: LevelDoc[] = doc.levels?.length ? doc.levels : [{ id: GROUND_ID, name: GROUND.name, elevation: 0 }];
    if (!listed.some((l) => l.id === levelId)) return doc;
    const levels = listed.map((l) => {
      if (l.id !== levelId) return l;
      const next: LevelDoc = { ...l };
      if (patch.name?.trim()) next.name = patch.name.trim();
      if (patch.elevation !== undefined) next.elevation = patch.elevation;
      if (patch.height === null || patch.height === doc.wallHeight) delete next.height;
      else if (patch.height !== undefined) next.height = patch.height;
      if (patch.slab !== undefined) {
        if (patch.slab === SLAB) delete next.slab;
        else next.slab = patch.slab;
      }
      return next;
    });
    return { ...doc, levels };
  };
}

// Remove a level with its walls, openings and rooms. The last level can't be
// removed. Objects on it are removed from scenes with removeLevelObjects.
export function deleteLevel(levelId: string) {
  return (doc: ShellDoc): ShellDoc => {
    if ((doc.levels?.length ?? 0) < 2 || !doc.levels!.some((l) => l.id === levelId)) return doc;
    const on = (x: { level?: string }) => levelOf(x, doc) === levelId;
    const walls = (doc.walls ?? []).filter(on);
    const gone = new Set(walls.map((w) => w.id));
    const levels = doc.levels!.filter((l) => l.id !== levelId);
    // Items without `level` were on the first level; if that one goes, the
    // others keep their explicit level, which stays valid.
    return {
      ...doc,
      levels,
      walls: (doc.walls ?? []).filter((w) => !on(w)),
      openings: (doc.openings ?? []).filter((o) => !gone.has(o.wall)),
      rooms: (doc.rooms ?? []).filter((r) => !on(r)),
      ...(doc.stairs ? { stairs: doc.stairs.filter((s) => !on(s)) } : {}),
      ...(doc.roofs ? { roofs: doc.roofs.filter((r) => !on(r)) } : {}),
    };
  };
}

// A scene without a level's objects, and without finishes on its walls and
// rooms. `shellBefore` is the shell that still has the level.
export function removeLevelObjects(scene: SceneDoc, shellBefore: ShellDoc, levelId: string): SceneDoc {
  const on = (x: { level?: string }) => levelOf(x, shellBefore) === levelId;
  const walls = new Set((shellBefore.walls ?? []).filter(on).map((w) => w.id));
  const rooms = new Set((shellBefore.rooms ?? []).filter(on).map((r) => r.id));
  const objects = (scene.objects ?? []).filter((o) => !on(o));
  const finishes = (scene.finishes ?? []).filter((f) => !(f.wall && walls.has(f.wall)) && !(f.room && rooms.has(f.room)));
  if (objects.length === (scene.objects ?? []).length && finishes.length === (scene.finishes ?? []).length) return scene;
  return { ...scene, objects, ...(scene.finishes ? { finishes } : {}) };
}

// Copy one level's walls and rooms onto another (doors and windows stay
// behind), as a start for an upper floor with the same outline.
export function copyLevelWalls(fromId: string, toId: string) {
  return (doc: ShellDoc): ShellDoc => {
    if (!doc.levels?.length || fromId === toId) return doc;
    const source = levelDoc(doc, fromId);
    const taken = new Set([...(doc.walls ?? []), ...(doc.rooms ?? []), ...(doc.openings ?? [])].map((x) => x.id));
    const fresh = (wanted: string) => {
      let id = `${wanted}-${toId}`;
      for (let n = 2; taken.has(id); n++) id = `${wanted}-${toId}-${n}`;
      taken.add(id);
      return id;
    };
    const first = toId === firstId(doc);
    const onTarget = <T extends { id: string; level?: string }>(x: T): T => {
      const { level: _, ...rest } = x;
      return { ...rest, id: fresh(x.id), ...(first ? {} : { level: toId }) } as T;
    };
    return {
      ...doc,
      walls: [...(doc.walls ?? []), ...(source.walls ?? []).map(onTarget)],
      rooms: [...(doc.rooms ?? []), ...(source.rooms ?? []).map(onTarget)],
    };
  };
}
