// Odaja MCP server: lets Claude Code, Claude Desktop or any MCP client use
// Odaja's tools. It forwards to the running Odaja app (bun run dev), which
// does the work on the open project, so the app must be running.
//
//   claude mcp add odaja -- bun /path/to/odaja/mcp/server.ts
//
// ODAJA_URL overrides where the app runs (default http://localhost:5173).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.ODAJA_URL ?? "http://localhost:5173").replace(/\/$/, "");

const INSTRUCTIONS = `Odaja is the user's 3D home-design app. These tools read and change the open project.
Start with get_overview. Units are cm on a top-down plan (x east, y south); rotation is degrees clockwise from above and 0 means an object's front faces north.
Prefer built-in templates (list_templates) or the user's library (list_library); build from parts when nothing fits.
After changes, check_issues, and use screenshot to look at the result. Every change shows up live in the app and the user can undo it there.`;

async function api(path: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Odaja isn't running at ${BASE}. Start it with "bun run dev" in the Odaja folder.`);
  }
  if (!res.ok) throw new Error(`Odaja: ${res.status} ${await res.text()}`);
  return res.json();
}

const server = new Server({ name: "odaja", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = (await api("/tools")) as { name: string; description: string; inputSchema: Record<string, unknown> }[];
  return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object", ...t.inputSchema } })) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await api("/tools/call", { name: request.params.name, input: request.params.arguments ?? {} });
  } catch (err) {
    return { content: [{ type: "text", text: (err as Error).message }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
