// Odaja without Vite, as one program: the companion. `bun build --compile`
// turns it into the single-file `odaja` program (scripts/package-server.ts):
//
//   odaja               the app and its backend on a local port (server/serve.ts),
//                       opened in the browser (--no-open: don't); if Odaja is
//                       already running, it just opens that one
//   odaja mcp           Odaja's MCP server on stdio, for Claude Code and others
//
// From the repo: `bun run companion` (or `bun run build && bun run start`).
// The program carries the built app, the format docs and the sample flat
// (server/appFiles.ts); ODAJA_APP_ROOT points elsewhere instead.
import path from "node:path";
import { embeddedApp, unpackApp } from "./appFiles";
import { isCompiled } from "./env";

// Imported only once the environment is set: they read it when loaded.
if (process.argv[2] === "mcp") {
  const { runMcpServer } = await import("../mcp/run");
  await runMcpServer();
} else {
  const { findRunningOdaja } = await import("./discovery");
  const { openInBrowser, shouldOpen } = await import("./open");
  const running = process.env.ODAJA_PORT ? null : await findRunningOdaja();
  if (running) {
    console.log(`Odaja is already running at ${running}`);
    if (shouldOpen()) openInBrowser(running);
    process.exit(0);
  }
  const app = embeddedApp();
  if (!process.env.ODAJA_APP_ROOT) {
    if (app) process.env.ODAJA_APP_ROOT = await unpackApp(app);
    // Older packaging: the files in a `resources` folder next to the program.
    else if (isCompiled) process.env.ODAJA_APP_ROOT = path.join(path.dirname(process.execPath), "resources");
  }
  const { startServer } = await import("./serve");
  await startServer().catch((err) => {
    console.error(`[odaja] ${err.message}`);
    process.exit(1);
  });
}
