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
bun run typecheck
bun run format-project <dir>                   # reformat a project's JSON the way the app saves it
```

The app runs at http://localhost:5173. The furniture library is
`~/Documents/Odaja/Library` (`$ODAJA_HOME/Library`), served under `/api/library`.
`public/draco/` holds the Draco decoder for compressed glTF files. Recently opened projects are remembered
in `~/.odaja/state.json` (or `$ODAJA_HOME/.odaja-state.json`). The start screen lists those, every project folder in
`~/Documents/Odaja`, and the sample project.

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
| `src/three/modelImport.ts` | Loading model files (GLB/glTF, FBX, OBJ+MTL, DAE, 3DS, USDZ/USD, 3MF, STL, PLY, WRL), units/up-axis/facing normalisation, simplification, GLB export |
| `src/three/ModelView.tsx` | Renders model objects stretched to their size, with the bounding box as fallback |
| `src/three/thumbnail.ts` | Preview images for library items |
| `src/ui/libraryActions.ts` | Place library items, save objects to the library, finish imports |
| `src/model/operations.ts` | Named scene edits (`moveObject`, `rotateObject`, …). All UI changes go through these. The MCP server will expose the same set. |
| `src/model/format.ts` | JSON formatter used for every save: short values stay on one line |
| `src/model/geometry.ts` | 2D plan geometry: wall outlines, ray casts to walls, object footprints, room sizes, wall dimension chains |
| `src/model/units.ts` | Plan (cm, y down) ↔ three.js (metres, Y up) conversion |
| `src/store.ts` | Zustand store: loading, live reload, saving, modes and tools. Undo entries record before/after of every file a step touched, so a wall move and the attached furniture it carried (in every scene using that shell) undo together. |
| `src/platform.ts` | Host interface (file read/write/watch). Browser implementation now, Tauri later. |
| `src/three/` | React Three Fiber rendering: shell (walls, openings, floors), objects, viewport |
| `src/ui/` | App layout, sidebar, toolbar, styles. `Inspector.tsx` edits the selected object, `AddPanel.tsx` lists templates, `actions.ts` holds add/duplicate/delete. `StructureLayer.tsx` is the interactive SVG for Structure mode (drawing, dragging, its own pan/zoom), `StructureInspector.tsx` edits walls/openings/rooms, `IssuesPanel.tsx` lists issues. `StartScreen.tsx` is the project picker, `ScenesSection.tsx` the scene list. `PlanOverlay.tsx` draws the plan view's dimensions as SVG over the canvas, following the orthographic camera through `planView` in the store. |
| `server/project-server.ts` | Vite plugin: lists, creates and opens projects; serves the open project's files over `/api`; creates, renames and deletes scene files; pushes file-change events. It also copies `docs/project-format.md` into each project as `AGENTS.md`. |
| `src/model/defaults.ts` | Starting content for new projects (materials, the rectangular-room shell) and scenes |
| `examples/sample-flat/` | Sample project used in development |

## Conventions

- Project files keep only the fields their author wrote. The store keeps the
  raw document (`sceneDoc`) for saving and a parsed copy with defaults
  (`scene`) for rendering. Never save the parsed copy.
- Edits made outside the app (agents, editors) are pushed onto the undo stack,
  so the user can undo them in the app.
- Stack: Bun, Vite, React 19, React Three Fiber + drei, Zustand, Zod 4,
  TypeScript. Tauri (desktop shell) comes later.
