// Regenerates the template table in docs/project-format.md from library.ts.
// Usage: bun run docs:templates
import { TEMPLATES, templateParams } from "../src/model/library";

const DOC = "docs/project-format.md";
const START = "<!-- templates:start -->";
const END = "<!-- templates:end -->";

const rows = TEMPLATES.map((t) => {
  const params = t.params.map((p) => `\`${p.key}\` ${p.default}`).join(", ");
  const notes = [
    t.elevation ? `Set \`elevation\` (usually ${t.elevation})` : "",
    t.fromCeiling ? `At the ceiling: \`elevation\` = wall height − ${t.fromCeiling(templateParams(t))} (with the default params)` : "",
    t.light ? "Gives light" : "",
  ];
  const note = notes.filter(Boolean).join(". ");
  return `| \`${t.id}\` | ${t.name} | ${params} | ${note} |`;
});
const table = ["| Template | What | Params (defaults, cm) | Notes |", "|---|---|---|---|", ...rows].join("\n");

const text = await Bun.file(DOC).text();
const [before, rest] = text.split(START);
const after = rest?.split(END)[1];
if (after === undefined) throw new Error(`markers ${START} / ${END} not found in ${DOC}`);
await Bun.write(DOC, `${before}${START}\n${table}\n${END}${after}`);
console.log(`updated ${DOC} (${rows.length} templates)`);
