// Calling Odaja's AI tools from the app. On the website they run right here
// in the page, on the home in browser storage; in development and the
// companion they run on the server, next to the project folder.
import { platform } from "../platform";
import { useOdaja } from "../store";
import type { ToolContext, ToolResult } from "./tools";

// Photos shared in the chat this call comes from (photo-1, photo-2, …).
type Photos = () => Promise<{ mimeType: string; data: string }[]>;

async function localContext(photos?: Photos): Promise<ToolContext> {
  const local = platform.localTools!;
  const { captureView } = await import("../three/capture");
  return {
    files: () => local.files(),
    scenePath: () => useOdaja.getState().scenePath,
    editingObject: () => useOdaja.getState().editingObjectId,
    screenshot: (view) => captureView(view),
    openScene: (path) => local.openScene(path),
    photos,
  };
}

export async function listTools(): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]> {
  if (platform.localTools) {
    // Loaded only when needed: the tools bring zod schemas and image code.
    const { TOOLS, inputJsonSchema } = await import("./tools");
    return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: inputJsonSchema(t) }));
  }
  const res = await fetch("/api/tools");
  if (!res.ok) throw new Error(`couldn't list tools (${res.status})`);
  return res.json();
}

export async function callTool(name: string, input: unknown, options: { photos?: Photos } = {}): Promise<ToolResult> {
  if (platform.localTools) {
    const [tools, photos, { canvasCodec }] = await Promise.all([import("./tools"), import("./photos"), import("./canvasCodec")]);
    photos.setImageCodec(canvasCodec);
    return tools.callTool(name, input, await localContext(options.photos));
  }
  // Tools refer to the chat's photos by name (photo-1, …); send them along
  // only when the input does.
  const photos = options.photos && /"photo-\d+"/.test(JSON.stringify(input ?? null)) ? await options.photos() : undefined;
  const res = await fetch("/api/tools/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, input, photos }),
  });
  if (!res.ok) return { content: [{ type: "text", text: `Odaja: ${res.status} ${await res.text()}` }], isError: true };
  return res.json();
}
