// Odaja's MCP server: forwards Odaja's tools to an MCP client over stdio.
// The work happens in the running app, so it must be running. Started by
// mcp/server.ts (development) or as `odaja mcp` (the packaged program).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { findRunningOdaja } from "../server/discovery";

// ODAJA_URL wins; otherwise the Odaja that is running on this machine;
// otherwise the development server.
async function base() {
  return (process.env.ODAJA_URL ?? (await findRunningOdaja()) ?? "http://localhost:5173").replace(/\/$/, "");
}

const INSTRUCTIONS = `Odaja is the user's 3D home-design app. These tools read and change the open project.
Start with get_overview. Units are cm on a top-down plan (x east, y south); rotation is degrees clockwise from above and 0 means an object's front faces north.
Prefer built-in templates (list_templates) or the user's library (list_library); build from parts when nothing fits.
Tiles, paint and floors: set_material, set_finish, get_quantities. Door and window types: style on add_opening/update_opening.
Floor plans: set_background (scale_from a printed dimension, or ask the user for one), image_to_plan to read positions off the image, build_shell for all walls, openings and rooms at once, then screenshot the plan view to compare with the background.
Houses can have several levels (storeys): get_overview lists them; tools work on the level open in the app unless given level; set_level adds and changes levels, set_stairs connects them, set_roof puts a roof on top.
The garden: set_plot, set_area (lawn, paving, gravel, deck, bed, water), set_fence; plants are templates (tree, conifer, shrub, planter).
After changes, check_issues, and use screenshot to look at the result. Every change shows up live in the app and the user can undo it there.`;

// Set when Odaja's chat starts Claude Code, so tools can use the chat's photos.
const CHAT_ID = process.env.ODAJA_CHAT_ID;

async function api(path: string, body?: unknown) {
  const BASE = await base();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Odaja isn't running at ${BASE}. Open the Odaja app (or "bun run dev" in the Odaja folder).`);
  }
  if (!res.ok) throw new Error(`Odaja: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function runMcpServer() {
  const server = new Server({ name: "odaja", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = (await api("/tools")) as { name: string; description: string; inputSchema: Record<string, unknown> }[];
    return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object", ...t.inputSchema } })) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await api("/tools/call", { name: request.params.name, input: request.params.arguments ?? {}, chatId: CHAT_ID });
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}
