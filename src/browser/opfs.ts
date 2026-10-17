// Small file helpers over the browser's private file system (OPFS): a real
// folder tree that only Odaja's own website can see. Paths are relative,
// "/"-separated, under Odaja's own folder.
export type Data = string | Blob | ArrayBuffer;

let rootDir: Promise<FileSystemDirectoryHandle> | null = null;

function root() {
  rootDir ??= navigator.storage.getDirectory().then((d) => d.getDirectoryHandle("odaja", { create: true }));
  return rootDir;
}

function parts(path: string): string[] {
  const list = path.split("/").filter((p) => p && p !== ".");
  if (list.includes("..")) throw new Error(`invalid path: ${path}`);
  return list;
}

async function dirAt(names: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root();
  for (const name of names) {
    try {
      dir = await dir.getDirectoryHandle(name, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

async function fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
  const names = parts(path);
  const name = names.pop();
  if (!name) return null;
  const dir = await dirAt(names, create);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(name, { create });
  } catch {
    return null;
  }
}

// The file at `path` (a lazy, disk-backed Blob), or null.
export async function readFile(path: string): Promise<File | null> {
  const handle = await fileHandle(path, false);
  return handle ? handle.getFile() : null;
}

export async function readText(path: string): Promise<string | null> {
  const file = await readFile(path);
  return file ? file.text() : null;
}

export async function writeFile(path: string, data: Data): Promise<void> {
  const handle = await fileHandle(path, true);
  if (!handle) throw new Error(`can't write ${path}`);
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function exists(path: string): Promise<boolean> {
  return (await fileHandle(path, false)) !== null || (await dirAt(parts(path), false)) !== null;
}

export async function list(path: string): Promise<{ name: string; kind: "file" | "directory" }[]> {
  const dir = await dirAt(parts(path), false);
  if (!dir) return [];
  const out: { name: string; kind: "file" | "directory" }[] = [];
  for await (const [name, handle] of dir.entries()) out.push({ name, kind: handle.kind });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Every file under `path`, as paths relative to it.
export async function walk(path: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await list(path)) {
    const child = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === "file") out.push(entry.name);
    else for (const sub of await walk(child)) out.push(`${entry.name}/${sub}`);
  }
  return out;
}

export async function remove(path: string): Promise<void> {
  const names = parts(path);
  const name = names.pop();
  if (!name) return;
  const dir = await dirAt(names, false);
  await dir?.removeEntry(name, { recursive: true }).catch(() => {});
}
