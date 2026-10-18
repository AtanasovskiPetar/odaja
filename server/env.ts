// What the server needs to know about how it runs.

// Modules inside a `bun build --compile` binary live in Bun's virtual file
// system (/$bunfs/… on macOS and Linux, B:\~BUN\… on Windows).
export const isCompiled = import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN");
