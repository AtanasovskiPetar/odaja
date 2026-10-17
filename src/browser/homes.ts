// The website keeps one home at a time, plus the one it replaced (so an
// accidental replace can be undone once). Each home is a folder in the
// browser's private file system, in the same layout as a project folder:
//
//   homes/<id>/project.json, shell.json, shells/, scenes/, assets/
//   state.json   { current, previous, homes: { <id>: { unsavedToFile } } }
import * as opfs from "./opfs";

export interface HomeSummary {
  id: string;
  name: string;
  modified: number;
}

interface State {
  current: string | null;
  previous: string | null;
  // Changed since last saved to a file (saving to files comes with .odaja files).
  unsavedToFile: Record<string, boolean>;
}

const STATE = "state.json";

export async function readState(): Promise<State> {
  try {
    const text = await opfs.readText(STATE);
    const s = text ? JSON.parse(text) : {};
    return { current: s.current ?? null, previous: s.previous ?? null, unsavedToFile: s.unsavedToFile ?? {} };
  } catch {
    return { current: null, previous: null, unsavedToFile: {} };
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

// Store a new home and make it current. The current one becomes the previous
// home; the one before that is deleted.
export async function addHome(files: Record<string, opfs.Data>): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  for (const [rel, data] of Object.entries(files)) await opfs.writeFile(homePath(id, rel), data);
  const state = await readState();
  if (state.previous) {
    await opfs.remove(homePath(state.previous));
    delete state.unsavedToFile[state.previous];
  }
  await writeState({ ...state, previous: state.current, current: id, unsavedToFile: { ...state.unsavedToFile, [id]: false } });
  return id;
}

// Bring the previous home back; the current one takes its place as previous.
export async function swapWithPrevious(): Promise<string> {
  const state = await readState();
  if (!state.previous) throw new Error("there's no previous home");
  await writeState({ ...state, current: state.previous, previous: state.current });
  return state.previous;
}

export async function markChanged(id: string) {
  const state = await readState();
  if (state.unsavedToFile[id]) return;
  await writeState({ ...state, unsavedToFile: { ...state.unsavedToFile, [id]: true } });
}
