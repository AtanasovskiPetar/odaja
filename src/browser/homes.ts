// The website keeps one home at a time, like a document in an editor: the one
// you work on, saved as you go; your real copies are .odaja files. The home
// is a folder in the browser's private file system, in the same layout as a
// project folder:
//
//   homes/<id>/project.json, shell.json, shells/, scenes/, assets/
//   state.json   { current, unsavedToFile: { <id>: boolean } }
import * as opfs from "./opfs";

export interface HomeSummary {
  id: string;
  name: string;
  modified: number;
}

interface State {
  current: string | null;
  // Changed since last saved to a file (saving to files comes with .odaja files).
  unsavedToFile: Record<string, boolean>;
}

const STATE = "state.json";

export async function readState(): Promise<State> {
  try {
    const text = await opfs.readText(STATE);
    const s = text ? JSON.parse(text) : {};
    return { current: s.current ?? null, unsavedToFile: s.unsavedToFile ?? {} };
  } catch {
    return { current: null, unsavedToFile: {} };
  }
}

async function writeState(state: State) {
  await opfs.writeFile(STATE, JSON.stringify(state, null, 2));
}

export const homePath = (id: string, rel = "") => `homes/${id}${rel ? `/${rel}` : ""}`;

export async function summary(id: string | null): Promise<HomeSummary | null> {
  if (!id) return null;
  const file = await opfs.readFile(homePath(id, "project.json"));
  if (!file) return null;
  let name = "Untitled home";
  try {
    name = String(JSON.parse(await file.text()).name ?? name);
  } catch {
    // Unreadable project.json: the app shows the error when it opens.
  }
  return { id, name, modified: file.lastModified };
}

// Store a new home and make it current. The one it replaces is deleted (the
// app asks first when it has changes that aren't in a file), and so is any
// home an older version kept as "previous".
export async function addHome(files: Record<string, opfs.Data>): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  for (const [rel, data] of Object.entries(files)) await opfs.writeFile(homePath(id, rel), data);
  await writeState({ current: id, unsavedToFile: { [id]: false } });
  await removeOthers(id);
  return id;
}

// Deletes every home but `keep` (e.g. the previous home older versions kept).
export async function removeOthers(keep: string | null) {
  for (const home of await opfs.list("homes")) if (home.name !== keep) await opfs.remove(homePath(home.name));
}

export async function markSaved(id: string) {
  const state = await readState();
  await writeState({ ...state, unsavedToFile: { ...state.unsavedToFile, [id]: false } });
}

export async function markChanged(id: string) {
  const state = await readState();
  if (state.unsavedToFile[id]) return;
  await writeState({ ...state, unsavedToFile: { ...state.unsavedToFile, [id]: true } });
}
