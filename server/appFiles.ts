// The single-file `odaja` program carries the built app, the format docs and
// the sample flat inside itself (scripts/package-server.ts embeds them). On
// first start they're unpacked once into ~/.odaja/app/<version>, so the server
// reads them as ordinary files.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface EmbeddedApp {
  version: string; // package version and content hash
  files: [string, string][]; // [relative path, embedded file path]
}

export function embeddedApp(): EmbeddedApp | undefined {
  return (globalThis as { __ODAJA_EMBEDDED__?: EmbeddedApp }).__ODAJA_EMBEDDED__;
}

// Returns the folder holding the app's files, unpacking them if needed.
export async function unpackApp(app: EmbeddedApp): Promise<string> {
  const root = path.join(os.homedir(), ".odaja", "app");
  const dir = path.join(root, app.version);
  const done = path.join(dir, ".complete");
  if (await fs.stat(done).then(() => true, () => false)) return dir;
  await fs.rm(dir, { recursive: true, force: true });
  for (const [rel, embedded] of app.files) {
    const target = path.join(dir, ...rel.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await fs.readFile(embedded));
  }
  await fs.writeFile(done, "");
  // Earlier versions' files aren't needed any more.
  for (const old of await fs.readdir(root)) if (old !== app.version) await fs.rm(path.join(root, old), { recursive: true, force: true });
  return dir;
}
