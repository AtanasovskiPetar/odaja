// Release archives of the companion (odaja-server), one per platform:
//
//   bun scripts/release.ts                     → every platform
//   bun scripts/release.ts macos-arm64 ...     → only these
//
// Each archive holds a folder odaja-server-<platform>/ with the binary, its
// resources/, a short README.txt and the LICENSE: .zip for macOS and Windows,
// .tar.gz for Linux, in release/. The GitHub workflow (.github/workflows/release.yml)
// runs this on a version tag; macOS builds run on a Mac so the binary is signed
// (ad hoc) the way Apple Silicon requires.
import { $ } from "bun";
import fs from "node:fs/promises";
import path from "node:path";
import { layOut } from "./package-server";

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
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version as string;

const out = path.resolve("release");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out);
await $`bun run build`;

for (const name of platforms) {
  const folder = `odaja-server-${name}`;
  const dir = path.join(out, folder);
  await layOut(PLATFORMS[name], dir);
  // The source map is built into the binary already.
  await fs.rm(path.join(dir, "main.js.map"), { force: true });
  await fs.copyFile("LICENSE", path.join(dir, "LICENSE"));
  await fs.writeFile(path.join(dir, "README.txt"), readme(name));
  const archive = name.startsWith("linux") ? `${folder}.tar.gz` : `${folder}.zip`;
  if (archive.endsWith(".zip")) await $`zip -qry ${archive} ${folder}`.cwd(out);
  else await $`tar -czf ${archive} ${folder}`.cwd(out);
  await fs.rm(dir, { recursive: true });
  console.log(`release/${archive}`);
}

function readme(platform: string): string {
  const windows = platform.startsWith("windows");
  const exe = windows ? "odaja-server.exe" : "./odaja-server";
  return `Odaja companion ${version} (${platform})
https://github.com/AtanasovskiPetar/odaja

The companion runs Odaja on your computer, with homes as real folders
(Documents/Odaja) and an MCP server, so Claude Desktop, Claude Code and other
MCP clients can work on your design.

Start it (keep the resources folder next to the program):

  ${exe}

then open the address it prints (http://localhost:5180 unless that port is taken).
${
  platform.startsWith("macos")
    ? `
macOS: the program isn't notarised by Apple yet. If macOS refuses to open it,
remove the download quarantine once, in Terminal, in this folder:

  xattr -dr com.apple.quarantine .
`
    : ""
}
Connect Claude Code (Odaja must be running):

  claude mcp add odaja -- "${windows ? "C:\\path\\to\\" : "/path/to/"}${windows ? "odaja-server.exe" : "odaja-server"}" mcp

Connect Claude Desktop: Settings → Developer → Edit Config, and add to
claude_desktop_config.json:

  {
    "mcpServers": {
      "odaja": { "command": "${windows ? "C:\\\\path\\\\to\\\\odaja-server.exe" : "/path/to/odaja-server"}", "args": ["mcp"] }
    }
  }

Restart Claude Desktop, and ask it about your design.
`;
}
