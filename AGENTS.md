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
bun run dev                                    # opens the sample project
ODAJA_PROJECT=/path/to/project bun run dev     # opens another project folder
bun run typecheck
bun run format-project <dir>                   # reformat a project's JSON the way the app saves it
```

The app runs at http://localhost:5173.

## Layout

| Path | What |
|---|---|
| `src/model/schema.ts` | Zod schemas for the project format. **Source of truth**: keep `docs/project-format.md` in sync. |
| `src/model/operations.ts` | Named scene edits (`moveObject`, `rotateObject`, …). All UI changes go through these. The MCP server will expose the same set. |
| `src/model/format.ts` | JSON formatter used for every save: short values stay on one line |
| `src/model/geometry.ts` | 2D plan geometry: wall outlines, ray casts to walls, object footprints, room sizes, wall dimension chains |
| `src/model/units.ts` | Plan (cm, y down) ↔ three.js (metres, Y up) conversion |
| `src/store.ts` | Zustand store: loading, live reload, undo/redo, saving |
| `src/platform.ts` | Host interface (file read/write/watch). Browser implementation now, Tauri later. |
| `src/three/` | React Three Fiber rendering: shell (walls, openings, floors), objects, viewport |
| `src/ui/` | App layout, sidebar, toolbar, styles. `PlanOverlay.tsx` draws the plan view's dimensions as SVG over the canvas, following the orthographic camera through `planView` in the store. |
| `server/project-server.ts` | Vite plugin serving the project folder over `/api` and pushing file-change events. It also copies `docs/project-format.md` into each project as `AGENTS.md`. |
| `examples/sample-flat/` | Sample project used in development |

## Conventions

- Project files keep only the fields their author wrote. The store keeps the
  raw document (`sceneDoc`) for saving and a parsed copy with defaults
  (`scene`) for rendering. Never save the parsed copy.
- Edits made outside the app (agents, editors) are pushed onto the undo stack,
  so the user can undo them in the app.
- Stack: Bun, Vite, React 19, React Three Fiber + drei, Zustand, Zod 4,
  TypeScript. Tauri (desktop shell) comes later.
