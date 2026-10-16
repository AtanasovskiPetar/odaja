// Dev-time file bridge between the browser app and a project folder on disk.
// The app reads and writes project files through /api/*, and gets an
// "odaja:file-changed" event whenever a file in the project changes, so edits
// made by agents (or any editor) show up live. The Tauri build will replace
// this with native file access behind the same interface.
import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const AGENT_DOC_SOURCE = path.resolve("docs/project-format.md");

export function odajaProjectServer(): Plugin {
  const projectDir = path.resolve(process.env.ODAJA_PROJECT ?? "examples/sample-flat");

  // Resolve a project-relative path, refusing anything that escapes the project.
  function resolveInProject(relPath: string): string {
    const abs = path.resolve(projectDir, relPath);
    if (abs !== projectDir && !abs.startsWith(projectDir + path.sep)) {
      throw new Error(`Path escapes project: ${relPath}`);
    }
    return abs;
  }

  // Every project carries the format docs, so an agent opened in the project
  // folder knows how to edit it without access to this repo.
  async function syncAgentDocs() {
    const doc = await fs.readFile(AGENT_DOC_SOURCE, "utf8");
    const targets: [string, string][] = [
      ["AGENTS.md", doc],
      ["CLAUDE.md", "@AGENTS.md\n"],
    ];
    for (const [name, content] of targets) {
      const file = path.join(projectDir, name);
      const current = await fs.readFile(file, "utf8").catch(() => null);
      if (current !== content) await fs.writeFile(file, content);
    }
  }

  return {
    name: "odaja-project-server",
    async configureServer(server) {
      await syncAgentDocs();
      server.watcher.add([projectDir, AGENT_DOC_SOURCE]);
      server.watcher.on("all", (_event, file) => {
        if (file === AGENT_DOC_SOURCE) {
          syncAgentDocs();
          return;
        }
        if (!file.startsWith(projectDir + path.sep)) return;
        const rel = path.relative(projectDir, file).split(path.sep).join("/");
        server.ws.send({ type: "custom", event: "odaja:file-changed", data: { path: rel } });
      });

      server.middlewares.use("/api", async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        try {
          if (url.pathname === "/project" && req.method === "GET") {
            const sceneFiles = await fs.readdir(resolveInProject("scenes")).catch(() => []);
            return send(200, {
              dir: projectDir,
              scenes: sceneFiles.filter((f) => f.endsWith(".json")).map((f) => `scenes/${f}`).sort(),
            });
          }
          if (url.pathname === "/file") {
            const rel = url.searchParams.get("path");
            if (!rel) return send(400, { error: "missing path" });
            const abs = resolveInProject(rel);
            if (req.method === "GET") {
              const text = await fs.readFile(abs, "utf8").catch(() => null);
              if (text === null) return send(404, { error: `not found: ${rel}` });
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              return res.end(text);
            }
            if (req.method === "PUT") {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(chunk as Buffer);
              await fs.mkdir(path.dirname(abs), { recursive: true });
              await fs.writeFile(abs, Buffer.concat(chunks));
              return send(200, { ok: true });
            }
          }
          send(404, { error: "unknown endpoint" });
        } catch (err) {
          send(500, { error: String(err) });
        }
      });
    },
  };
}
