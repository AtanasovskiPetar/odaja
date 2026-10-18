// Release files of the companion, one program per platform:
//
//   bun run release                     → every platform
//   bun run release macos-arm64 ...     → only these
//
// Each is a single file in release/: odaja-<platform> (odaja-windows-x64.exe),
// carrying the app inside (scripts/package-server.ts). The install scripts
// (public/install.sh, public/install.ps1) download them from the latest GitHub
// Release. The workflow (.github/workflows/release.yml) runs this on a version
// tag; macOS builds run on a Mac so the program is signed (ad hoc) the way
// Apple Silicon requires.
import { $ } from "bun";
import fs from "node:fs/promises";
import path from "node:path";
import { compileOdaja } from "./package-server";

const PLATFORMS: Record<string, string> = {
  "macos-arm64": "bun-darwin-arm64",
  "macos-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "windows-x64": "bun-windows-x64",
};

const chosen = process.argv.slice(2);
for (const name of chosen) if (!PLATFORMS[name]) throw new Error(`unknown platform ${name}; one of ${Object.keys(PLATFORMS).join(", ")}`);
const platforms = chosen.length ? chosen : Object.keys(PLATFORMS);

const out = path.resolve("release");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out);
await $`bun run build`;

for (const name of platforms) {
  const file = path.join(out, `odaja-${name}${name.startsWith("windows") ? ".exe" : ""}`);
  await compileOdaja(PLATFORMS[name], file);
  console.log(`release/${path.basename(file)}`);
}
