import { useEffect, useState } from "react";
import { rotateObject } from "../model/operations";
import { useOdaja } from "../store";
import { Viewport } from "../three/Viewport";
import { deleteSelected, duplicateSelected } from "./actions";
import { AddPanel } from "./AddPanel";
import { Inspector } from "./Inspector";
import { PlanOverlay } from "./PlanOverlay";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = useOdaja.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod) return;
      const selected = s.scene?.objects.find((o) => o.id === s.selectedId);
      switch (e.key.toLowerCase()) {
        case "r":
          if (selected && !selected.locked) s.apply(rotateObject(selected.id, e.shiftKey ? 15 : 90));
          break;
        case "2":
        case "t":
          s.setViewMode("plan");
          break;
        case "3":
        case "p":
          s.setViewMode("3d");
          break;
        case "c":
          s.toggleWallsCut();
          break;
        case "escape":
          s.select(null);
          break;
        case "delete":
        case "backspace":
          e.preventDefault();
          deleteSelected();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Sidebar() {
  const project = useOdaja((s) => s.project);
  const scenePaths = useOdaja((s) => s.scenePaths);
  const scenePath = useOdaja((s) => s.scenePath);
  const scene = useOdaja((s) => s.scene);
  const selectedId = useOdaja((s) => s.selectedId);
  const openScene = useOdaja((s) => s.openScene);
  const select = useOdaja((s) => s.select);
  const [adding, setAdding] = useState(false);

  return (
    <aside className="sidebar">
      <header className="brand">
        <span className="logo">Odaja</span>
        <span className="project-name">{project?.name ?? "…"}</span>
      </header>

      <section>
        <h2>Scenes</h2>
        <ul className="list">
          {scenePaths.map((path) => (
            <li key={path}>
              <button className={path === scenePath ? "active" : ""} onClick={() => openScene(path)}>
                {path === scenePath && scene ? scene.name : path.replace(/^scenes\//, "").replace(/\.json$/, "")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="grow">
        <div className="section-head">
          <h2>{adding ? "Add object" : "Objects"}</h2>
          <button className={`add-button ${adding ? "active" : ""}`} onClick={() => setAdding(!adding)} disabled={!scene}>
            {adding ? "Close" : "+ Add"}
          </button>
        </div>
        {adding ? (
          <AddPanel onClose={() => setAdding(false)} />
        ) : (
        <ul className="list">
          {scene?.objects.map((o) => (
            <li key={o.id}>
              <button className={o.id === selectedId ? "active" : ""} onClick={() => select(o.id)}>
                {o.name}
                <span className="muted">{o.id}</span>
              </button>
            </li>
          ))}
        </ul>
        )}
      </section>

      <Inspector />
    </aside>
  );
}

function Toolbar() {
  const wallsCut = useOdaja((s) => s.wallsCut);
  const toggleWallsCut = useOdaja((s) => s.toggleWallsCut);
  const viewMode = useOdaja((s) => s.viewMode);
  const setViewMode = useOdaja((s) => s.setViewMode);
  const undo = useOdaja((s) => s.undo);
  const redo = useOdaja((s) => s.redo);
  const canUndo = useOdaja((s) => s.undoStack.length > 0);
  const canRedo = useOdaja((s) => s.redoStack.length > 0);

  return (
    <div className="toolbar">
      <button className={viewMode === "plan" ? "active" : ""} onClick={() => setViewMode("plan")} title="Floor plan with dimensions (T)">
        Plan
      </button>
      <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")} title="3D view (P)">
        3D
      </button>
      {viewMode === "3d" && (
        <button className={wallsCut ? "active" : ""} onClick={toggleWallsCut} title="Cut walls at 110 cm (C)">
          Cut walls
        </button>
      )}
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
      <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
    </div>
  );
}

function Errors() {
  const errors = useOdaja((s) => s.errors);
  if (errors.length === 0) return null;
  return (
    <div className="errors">
      {errors.map((e) => (
        <div key={e.path}>
          <strong>{e.path}</strong>
          <pre>{e.message}</pre>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const load = useOdaja((s) => s.load);
  useEffect(() => {
    load();
  }, [load]);
  useShortcuts();

  return (
    <div className="app">
      <Sidebar />
      <main className="viewport">
        <Viewport />
        <PlanOverlay />
        <Toolbar />
        <Errors />
      </main>
    </div>
  );
}
