// Builds Odaja's server as one program that runs without Bun or Node:
//
//   bun run package:server                     → build/odaja-server for this machine
//   bun run package:server bun-darwin-x64      → for another platform (Bun target name)
//
// Output, ready to drop into the desktop app:
//   build/odaja-server            the server binary (also the MCP server: `odaja-server mcp`)
//   build/resources/dist/         the built app it serves
//   build/resources/docs/         the format docs it copies into each project
//   build/resources/examples/     the sample flat
import { $ } from "bun";
import fs from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
const out = path.resolve("build");
const binary = path.join(out, target?.includes("windows") ? "odaja-server.exe" : "odaja-server");
const resources = path.join(out, "resources");

await fs.rm(out, { recursive: true, force: true });
await $`bun run build`;
await $`bun build --compile --minify --sourcemap ${target ? [`--target=${target}`] : []} server/main.ts --outfile ${binary}`;

await fs.cp("dist", path.join(resources, "dist"), { recursive: true });
await fs.mkdir(path.join(resources, "docs"), { recursive: true });
await fs.copyFile("docs/project-format.md", path.join(resources, "docs", "project-format.md"));
await fs.cp("examples/sample-flat", path.join(resources, "examples", "sample-flat"), {
  recursive: true,
  // Chats saved while developing stay behind.
  filter: (src) => !src.split(path.sep).includes(".odaja"),
});

const size = (await fs.stat(binary)).size / 1024 / 1024;
console.log(`\nBuilt ${path.relative(".", binary)} (${size.toFixed(0)} MB) and ${path.relative(".", resources)}/`);
