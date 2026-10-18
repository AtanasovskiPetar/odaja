# Odaja

Odaja (Одаја, "room") is a small local 3D home-design tool. You can model a flat,
place furniture, and let LLM agents read and edit the design. Projects are
folders of JSON files that the app watches, so any edit on disk shows up live.

## Two kinds of work

- **Editing a home design** (moving furniture, adding objects, new layouts):
  edit the project's JSON files. The format is specified in
  [docs/project-format.md](docs/project-format.md). Every project folder also
  gets a copy as its own `AGENTS.md`, so agents opened in a project folder have it.
- **Changing the Odaja app itself**: see the layout and conventions below.

## Running

```bash
bun install
bun run dev                                    # reopens the last project, or shows the start screen
ODAJA_PROJECT=/path/to/project bun run dev     # opens a specific project folder
ODAJA_HOME=/path bun run dev                   # where new projects are created (default ~/Documents/Odaja)
bun run build && bun run start                 # the built app without Vite, at http://localhost:5180 (ODAJA_PORT)
bun run package:server                         # build/odaja-server (one binary, no Bun needed) + build/resources/
bun run typecheck
bun run format-project <dir>                   # reformat a project's JSON the way the app saves it
```

In development the app runs at http://localhost:5173; `bun run start` serves the
built app and the same backend from `server/main.ts`: the **companion** that
power users download as `odaja-server` (real project folders, MCP). The plan
for the website version is in [docs/web-plan.md](docs/web-plan.md). The furniture library is
`~/Documents/Odaja/Library` (`$ODAJA_HOME/Library`), served under `/api/library`.
`public/draco/` holds the Draco decoder for compressed glTF files. Recently opened projects are remembered
in `~/.odaja/state.json` (or `$ODAJA_HOME/.odaja-state.json`). The start screen lists those and every project folder in
`~/Documents/Odaja`, and offers "Try the sample flat".

The sample in `examples/sample-flat` is never opened in place: trying it
copies it to `~/Documents/Odaja/Sample flat` (without `.odaja/`), and "Start
over" replaces that copy with a fresh one. Opening the repo path redirects to
the copy too. To change the sample itself, open it deliberately with
`ODAJA_PROJECT=examples/sample-flat bun run dev`.

## AI integration

- **Tools** (`server/tools.ts`): one set of tools (get_overview, add_object,
  update_wall, screenshot, check_issues, …) that read and change the open
  project. The server exposes them at `/api/tools` and `/api/tools/call`.
  Screenshots are taken by the open app (the server asks it over the event
  stream), so the app must be open in a browser.
- **MCP server** (`mcp/run.ts`, started by `mcp/server.ts` or as
  `odaja-server mcp`): forwards Odaja's tools to any MCP client. The app must
  be running. To use Odaja from Claude Code:
  `claude mcp add odaja -- bun /path/to/odaja/mcp/server.ts`. It finds the
  running app through `~/.odaja/server.json` (written by the standalone
  server), else http://localhost:5173; `ODAJA_URL` overrides both.
- **In-app chat** (`server/chat/`, `src/ui/chat/`): a chat panel (⌘J) with a
  model picker. Connections:
  - *Claude Code (subscription)*: drives the user's own installed, signed-in
    `claude` in headless stream-json mode with only Odaja's MCP tools
    (`--tools "" --strict-mcp-config --allowedTools "mcp__odaja__*"
    --permission-mode dontAsk`), with `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`
    removed so the subscription is used. Odaja never reads Claude credentials.
    `claude` is looked up on the login shell's PATH; the chat settings can set
    its path by hand. For personal use only.
  - *Anthropic API*: the official `@anthropic-ai/sdk`, streaming tool loop
    (default model `claude-opus-5-5`, server-side refusal fallback on).
  - *OpenAI, Gemini, OpenRouter, Ollama, LM Studio*: the Vercel AI SDK.
  - API keys and local server URLs live in `~/.odaja/settings.json` (mode 600),
    never in projects. Conversations are saved per project in
    `<project>/.odaja/chats/`.

## Security

The dev server listens on localhost only. Its `/api` can change files, delete
library items and run models on the user's accounts, so it refuses requests
whose browser `Origin` isn't Odaja itself (other websites the user visits);
local programs without an Origin (the MCP server, curl) are allowed, and Vite's
host check refuses DNS-rebinding hosts. Keep new endpoints under `/api` so they
get the same check. Never put API keys or Claude credentials in the repo or in
project folders.

## Layout

| Path | What |
|---|---|
| `src/model/schema.ts` | Zod schemas for the project format. **Source of truth**: keep `docs/project-format.md` in sync. |
| `src/model/library.ts` | Built-in furniture templates (parametric parts). After changing it, run `bun run docs:templates` to refresh the table in the format doc. |
| `src/model/shellOps.ts` | Named shell edits (add walls/rooms/openings, move corners and walls, resize, delete). Tools only produce valid geometry. |
| `src/model/attach.ts` | Snapping objects against walls and moving attached objects when walls move |
| `src/model/rooms.ts` | Finding enclosed areas in the wall graph ("Make room") |
| `src/model/snap.ts` | Snapping for the wall tools (ends, onto walls, 45° angles, alignment, grid) |
| `src/model/issues.ts` | Design checks (furniture in walls, overlaps, blocked doors, clearances) with quick fixes |
| `server/tools.ts` | AI tools shared by the chat and the MCP server |
| `server/chat/` | Chat backend: providers and models, settings, conversations, the three runners, HTTP routes |
| `mcp/server.ts` | MCP server forwarding Odaja's tools to MCP clients |
| `src/model/finishes.ts`, `src/model/finishOps.ts` | Finishes: face rectangles with openings cut out, wall sides facing a room, quantities; and the named edits |
| `src/three/textures.ts` | Real-scale tile textures (patterns drawn on canvas, or photos) |
| `src/three/JoineryView.tsx` | 3D doors and windows by type (frames, sashes, glazing bars, leaves) |
| `server/photos.ts` | Image edits for photo tools (crop, perspective straightening, colour, seamless); edits stay in memory until saved |
| `src/ui/MaterialsDialog.tsx`, `src/ui/FinishesInspector.tsx` | Materials editor; finishes, joinery and quantities in the inspector |
| `src/model/parts.ts`, `src/model/partOps.ts` | Part sizes and footprints for every shape; editing parts (add, duplicate, mirror, sit on top, snap) |
| `src/three/partGeometry.ts` | 3D geometry for every part shape (cut-outs as extrusion holes) |
| `src/three/ShapeEditorView.tsx`, `src/ui/PartsEditor.tsx` | Shape editor: parts in 3D with handles; parts list and part inspector |
| `src/model/walk.ts` | Walk view: what blocks you (walls at body height, furniture taller than 45 cm), sliding collision, default start |
| `src/three/WalkControls.tsx` | First-person controls (pointer-lock or drag look, W A S D, Q/E turn, Shift) |
| `src/ui/WalkOverlay.tsx` | Picking a start on the plan, mini-map, controls hint, eye height |
| `src/model/underlay.ts`, `src/three/UnderlayView.tsx`, `src/ui/UnderlayPanel.tsx`, `src/ui/planImage.ts` | Floor plan background: image ↔ plan maths and scale from one known length; the image under the plan view; the panel (scale, move, rotate, opacity); loading images and PDFs (first page) into `assets/plans/` |
| `src/three/capture.ts` | Viewport screenshots (plan view includes the dimension overlay) |
| `src/ui/chat/` | Chat panel, model picker, connection settings |
| `src/three/modelImport.ts` | Loading model files (GLB/glTF, FBX, OBJ+MTL, DAE, 3DS, USDZ/USD, 3MF, STL, PLY, WRL), units/up-axis/facing normalisation, simplification, GLB export |
| `src/three/ModelView.tsx` | Renders model objects stretched to their size, with the bounding box as fallback |
| `src/three/thumbnail.ts` | Preview images for library items |
| `src/ui/libraryActions.ts` | Place library items, save objects to the library, finish imports |
| `src/model/operations.ts` | Named scene edits (`moveObject`, `rotateObject`, …). All UI changes go through these. The MCP server will expose the same set. |
| `src/model/format.ts` | JSON formatter used for every save: short values stay on one line |
| `src/model/geometry.ts` | 2D plan geometry: wall outlines, ray casts to walls, object footprints, room sizes, wall dimension chains |
| `src/model/units.ts` | Plan (cm, y down) ↔ three.js (metres, Y up) conversion |
| `src/store.ts` | Zustand store: loading, live reload, saving, modes and tools. Undo entries record before/after of every file a step touched, so a wall move and the attached furniture it carried (in every scene using that shell) undo together. |
| `src/platform.ts` | Host interface (projects, scenes, files, library, events). `initPlatform()` picks the host at startup: `/api` answering JSON means dev or the companion (folders on disk); otherwise it's the website. `platform` passes every call to the chosen host. |
| `src/model/homeFile.ts` | `.odaja` files (zip of a project folder plus `odaja.json`): pack, unpack with checks (safe paths, size, newer versions), what belongs in a file. Shared by the website and the companion (`/api/project/export`, `/api/projects/import`). |
| `src/ui/homeFileActions.ts`, `src/ui/HomeMenu.tsx`, `src/ui/HomeFileDialogs.tsx` | Save (⌘S writes back to the same file where the browser allows it, else downloads), save a copy, open (button, ⌘O or drop), the "Include chat history" choice, export PNG/JPG; the file menu on the home's name with the unsaved-changes dot |
| `src/browser/` | The website's host: `opfs.ts` (file helpers over the browser's private file system), `homes.ts` (one home at a time plus the previous one, restorable), `platform.ts` (the same interface over browser storage; files are shown through `blob:` URLs), `sample.ts` (the sample flat bundled into the build), `kv.ts` (a small IndexedDB store, e.g. for where each home was saved) |
| `src/three/` | React Three Fiber rendering: shell (walls, openings, floors), objects, viewport |
| `src/ui/` | App layout, sidebar, toolbar, styles. `Inspector.tsx` edits the selected object, `AddPanel.tsx` lists templates, `actions.ts` holds add/duplicate/delete. `StructureLayer.tsx` is the interactive SVG for Structure mode (drawing, dragging, its own pan/zoom), `StructureInspector.tsx` edits walls/openings/rooms, `IssuesPanel.tsx` lists issues. `StartScreen.tsx` is the project picker, `ScenesSection.tsx` the scene list. `PlanOverlay.tsx` draws the plan view's dimensions as SVG over the canvas, following the orthographic camera through `planView` in the store. |
| `server/api.ts` | The backend, independent of Vite: lists, creates and opens projects; serves the open project's files over `/api`; creates, renames and deletes scene files; watches the project and pushes events (file changes, screenshot and open-scene requests) on `/api/events` (Server-Sent Events); serves the tools, the library and the chat. It also copies `docs/project-format.md` into each project as `AGENTS.md`. |
| `server/project-server.ts` | Vite plugin mounting `server/api.ts` at `/api` in development |
| `server/main.ts` | Entry point of the standalone server and of the `odaja-server` binary: serves (`server/serve.ts`), or runs the MCP server with `mcp`. Packaged, it finds its files in `resources/` next to it (`ODAJA_APP_ROOT`). |
| `server/serve.ts` | Standalone web server: the built app (`dist/`) plus `server/api.ts` on 127.0.0.1 only, Host check against DNS rebinding, port 5180 or a free one, announced in `~/.odaja/server.json` (`server/discovery.ts`) |
| `server/env.ts` | The machine: compiled or not, the login shell's PATH (apps from the Dock get a bare one), the `claude` command (chat settings can set its path) and how to start the MCP server |
| `scripts/package-server.ts` | `bun run package:server [bun-target]`: compiles the server binary and lays out `build/resources/` |
| `src/model/defaults.ts` | Starting content for new projects (materials, the rectangular-room shell) and scenes |
| `examples/sample-flat/` | The sample flat: offered on the start screen as a copy, and the fixture for development |

## Conventions

- Project files keep only the fields their author wrote. The store keeps the
  raw document (`sceneDoc`) for saving and a parsed copy with defaults
  (`scene`) for rendering. Never save the parsed copy.
- Edits made outside the app (agents, editors) are pushed onto the undo stack,
  so the user can undo them in the app.
- Stack: Bun, Vite, React 19, React Three Fiber + drei, Zustand, Zod 4,
  TypeScript. Odaja is heading for a local-first website plus the optional
  companion; there is no desktop (Tauri) app.
