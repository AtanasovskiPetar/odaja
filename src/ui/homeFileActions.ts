// Saving the home to a .odaja file and opening one. Where the browser allows
// it (Chrome, Edge) ⌘S writes straight back to the file the home was last
// saved to or opened from; elsewhere each save downloads the file.
import { kvGet, kvSet } from "../browser/kv";
import { HOME_EXTENSION, homeFileName } from "../model/homeFile";
import { platform } from "../platform";
import { useOdaja } from "../store";

// The File System Access API (Chrome, Edge), which TypeScript's DOM types don't cover.
interface WritableHandle extends FileSystemFileHandle {
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}
type PickerOptions = { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] };
interface FileAccessWindow {
  showSaveFilePicker?(options: PickerOptions): Promise<WritableHandle>;
  showOpenFilePicker?(options: PickerOptions): Promise<WritableHandle[]>;
}
const picker = window as unknown as FileAccessWindow;

const FILE_TYPES = [{ description: "Odaja home", accept: { "application/octet-stream": [HOME_EXTENSION] } }];
const handleKey = (home: string) => `save-handle:${home}`;
const chatsKey = (home: string) => `save-chats:${home}`;

// The home being saved: the open one, or on the website's start screen the
// one kept in the browser.
function target(): { key: string; name: string } | null {
  const s = useOdaja.getState();
  if (s.projectDir) return { key: s.projectDir, name: s.project?.name ?? "Home" };
  const kept = s.homes?.current;
  return kept ? { key: `browser:${kept.id}`, name: kept.name } : null;
}

const cancelled = (err: unknown) => (err as Error)?.name === "AbortError";

async function canWrite(handle: WritableHandle) {
  const mode = { mode: "readwrite" } as const;
  if ((await handle.queryPermission?.(mode)) === "granted") return true;
  return (await handle.requestPermission?.(mode)) === "granted";
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// Whether chats go into the file, as last chosen for this home (off at first).
export async function rememberedChatsChoice(): Promise<boolean> {
  const t = target();
  return t ? ((await kvGet<boolean>(chatsKey(t.key))) ?? false) : false;
}

// Save the home to a file. Returns false if nothing was saved (cancelled, or
// the save dialog opened to ask about chats first).
export async function saveHome({ saveAs = false, includeChats }: { saveAs?: boolean; includeChats?: boolean } = {}): Promise<boolean> {
  const t = target();
  const store = useOdaja.getState();
  if (!t) return false;
  try {
    if (includeChats === undefined) {
      const asked = await kvGet<boolean>(chatsKey(t.key));
      // The first save of a home with chats, or "Save a copy", asks whether to include them.
      if ((asked === undefined || saveAs) && (await platform.homeHasChats())) {
        store.openDialog({ kind: "save-file", saveAs });
        return false;
      }
      includeChats = asked ?? false;
    }
    const blob = await platform.exportHome(includeChats);
    let savedAs = homeFileName(t.name);
    if (picker.showSaveFilePicker) {
      let handle = saveAs ? undefined : await kvGet<WritableHandle>(handleKey(t.key));
      if (handle && !(await canWrite(handle).catch(() => false))) handle = undefined;
      handle ??= await picker.showSaveFilePicker({ suggestedName: savedAs, types: FILE_TYPES });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      await kvSet(handleKey(t.key), handle);
      savedAs = handle.name;
    } else {
      download(blob, savedAs);
    }
    await kvSet(chatsKey(t.key), includeChats);
    await platform.markSavedToFile();
    store.setUnsavedToFile(false);
    store.setNotice(`Saved to ${savedAs}`);
    return true;
  } catch (err) {
    if (!cancelled(err)) store.setNotice(`Couldn't save: ${(err as Error).message}`);
    return false;
  }
}

export interface PickedHome {
  file: File;
  handle?: FileSystemFileHandle;
}

// Ask for a .odaja file. With the File System Access API the handle is kept,
// so ⌘S later writes back to the same file.
export async function pickHomeFile(): Promise<PickedHome | null> {
  if (picker.showOpenFilePicker) {
    try {
      const [handle] = await picker.showOpenFilePicker({ types: FILE_TYPES });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (cancelled(err)) return null;
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = HOME_EXTENSION;
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0] } : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const isHomeFile = (file: File) => file.name.toLowerCase().endsWith(HOME_EXTENSION);

// Open a picked file (any confirmation has already happened).
export async function openHome({ file, handle }: PickedHome) {
  const store = useOdaja.getState();
  await store.openHomeFile(new Uint8Array(await file.arrayBuffer()));
  const key = useOdaja.getState().projectDir;
  if (key && handle) await kvSet(handleKey(key), handle);
  store.setNotice(`Opened ${file.name}`);
  // Furniture and materials from someone's library come with the home, but
  // join your library only if you say so.
  const { findMissingLibraryItems } = await import("./libraryFiles");
  const missing = await findMissingLibraryItems().catch(() => []);
  if (missing.length) useOdaja.getState().openDialog({ kind: "add-to-library", items: missing });
}

// From inside the app: on the website this replaces the home, so it asks first.
export async function requestOpenHome(picked: PickedHome) {
  const s = useOdaja.getState();
  if (platform.kind === "browser" && s.projectDir) s.openDialog({ kind: "open-home", file: picked.file, handle: picked.handle });
  else await openHome(picked).catch((err) => s.setNotice(`Couldn't open ${picked.file.name}: ${(err as Error).message}`));
}
