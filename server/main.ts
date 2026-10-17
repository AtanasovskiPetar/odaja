// Odaja without Vite, as one program: the companion. `bun build --compile`
// turns it into the `odaja-server` binary (scripts/package-server.ts):
//
//   odaja-server        the app and its backend on a local port (server/serve.ts)
//   odaja-server mcp    Odaja's MCP server on stdio, for Claude Code and others
//
// From the repo: `bun run build && bun run start`. The packaged binary finds
// the built app, the format docs and the sample flat in a `resources` folder
// next to it (or wherever ODAJA_APP_ROOT points).
import path from "node:path";
import { isCompiled } from "./env";

if (isCompiled && !process.env.ODAJA_APP_ROOT) {
  process.env.ODAJA_APP_ROOT = path.join(path.dirname(process.execPath), "resources");
}

// Imported only once the environment is set: they read it when loaded.
if (process.argv[2] === "mcp") {
  const { runMcpServer } = await import("../mcp/run");
  await runMcpServer();
} else {
  const { startServer } = await import("./serve");
  await startServer().catch((err) => {
    console.error(`[odaja] ${err.message}`);
    process.exit(1);
  });
}
