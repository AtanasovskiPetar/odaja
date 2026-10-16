// Formats project JSON for humans and agents: any value that fits on one line
// (a point, a part, a small object) stays on one line; larger ones are
// indented. Keeps diffs small and files easy to scan.
const MAX_LINE = 120;

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function format(value: unknown, indent: string, prefixLength: number): string {
  const flat = inline(value);
  if (typeof value !== "object" || value === null || indent.length + prefixLength + flat.length <= MAX_LINE) return flat;
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => inner + format(v, inner, 0)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  const lines = entries.map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `;
    return inner + key + format(v, inner, key.length);
  });
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

export function formatJson(value: unknown): string {
  return format(value, "", 0) + "\n";
}
