// Reformat every JSON file in a project folder the way Odaja saves them.
// Usage: bun scripts/format-project.ts <project-dir>
import { Glob } from "bun";
import path from "node:path";
import { formatJson } from "../src/model/format";

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun scripts/format-project.ts <project-dir>");
for await (const rel of new Glob("**/*.json").scan(dir)) {
  const file = path.join(dir, rel);
  const text = await Bun.file(file).text();
  const formatted = formatJson(JSON.parse(text));
  if (formatted !== text) {
    await Bun.write(file, formatted);
    console.log("formatted", rel);
  }
}
