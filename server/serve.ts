// The standalone web server: the built app (dist/) and the backend
// (server/api.ts) on one local port. Started by server/main.ts.
//
// Port 5180 unless ODAJA_PORT says otherwise; if 5180 is taken, any free
// port. The address is printed and written to ~/.odaja/server.json.
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createOdajaApi } from "./api";
import { announce, retract } from "./discovery";
import { loadLoginShellPath } from "./env";
import { openInBrowser, shouldOpen } from "./open";

const DEFAULT_PORT = 5180;
const DIST = path.resolve(process.env.ODAJA_DIST ?? path.join(process.env.ODAJA_APP_ROOT ?? ".", "dist"));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

// Only answer to this machine's own names. A website can point its domain at
// 127.0.0.1 (DNS rebinding); its requests then carry its own Host and are refused.
function localHost(req: IncomingMessage) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

async function serveApp(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  let file = path.join(DIST, pathname);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(400).end();
    return;
  }
  // Anything that isn't a built file is the app itself.
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) file = path.join(DIST, "index.html");
  const data = await fs.readFile(file).catch(() => null);
  if (!data) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end(`The app isn't built: run "bun run build" first (looked in ${DIST}).`);
    return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    // Built assets have content hashes in their names; the page itself must stay fresh.
    "Cache-Control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : data);
}

export async function startServer() {
  // Find the user's PATH early, so the chat's first Claude Code start is quick.
  void loadLoginShellPath();
  let port = Number(process.env.ODAJA_PORT ?? DEFAULT_PORT);
  const api = await createOdajaApi({ port: () => port });

  const server = createServer((req, res) => {
    if (!localHost(req)) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("Odaja only answers on localhost.");
      return;
    }
    const url = req.url ?? "/";
    if (url === "/api" || url.startsWith("/api/") || url.startsWith("/api?")) {
      req.url = url.slice(4) || "/";
      void api.handle(req, res);
      return;
    }
    serveApp(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(err?.message ?? err));
    });
  });

  // Local only: never reachable from the network. A port someone else has
  // (another program, or a second Odaja) falls back to a free one, unless
  // ODAJA_PORT asked for that port.
  await new Promise<void>((resolve, reject) => {
    const listen = (p: number) => server.listen(p, "127.0.0.1");
    server.on("listening", () => resolve());
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && !process.env.ODAJA_PORT && port === DEFAULT_PORT) {
        port = 0;
        listen(0);
      } else reject(err.code === "EADDRINUSE" ? new Error(`port ${port} is in use; set ODAJA_PORT to another port`) : err);
    });
    listen(port);
  });
  port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  await announce(url);
  // Shown in the terminal; scripts and launchers can read the address from it.
  console.log(`Odaja is running at ${url}`);
  if (shouldOpen()) openInBrowser(url);

  const shutdown = async () => {
    api.stop();
    server.close();
    await retract().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
}
