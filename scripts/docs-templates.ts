// Regenerates the template table in docs/project-format.md from library.ts.
// Usage: bun run docs:templates
import { TEMPLATES } from "../src/model/library";

const DOC = "docs/project-format.md";
const START = "<!-- templates:start -->";
const END = "<!-- templates:end -->";

const rows = TEMPLATES.map((t) => {
  const params = t.params.map((p) => `\`${p.key}\` ${p.default}`).join(", ");
  const note = t.elevation ? `Set \`elevation\` (usually ${t.elevation})` : "";
  return `| \`${t.id}\` | ${t.name} | ${params} | ${note} |`;
});
const table = ["| Template | What | Params (defaults, cm) | Notes |", "|---|---|---|---|", ...rows].join("\n");

const text = await Bun.file(DOC).text();
const [before, rest] = text.split(START);
const after = rest?.split(END)[1];
if (after === undefined) throw new Error(`markers ${START} / ${END} not found in ${DOC}`);
await Bun.write(DOC, `${before}${START}\n${table}\n${END}${after}`);
console.log(`updated ${DOC} (${rows.length} templates)`);
