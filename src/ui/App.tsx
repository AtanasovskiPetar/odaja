import { useEffect, useState } from "react";
import { rotateObject } from "../model/operations";
import { useOdaja } from "../store";
import { Viewport } from "../three/Viewport";
import { deleteSelected, duplicateSelected } from "./actions";
import { AddPanel } from "./AddPanel";
import { Inspector } from "./Inspector";
import { PlanOverlay } from "./PlanOverlay";
import { ScenesSection } from "./ScenesSection";
import { StartScreen } from "./StartScreen";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = useOdaja.getState();
      if (s.status !== "project") return;
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
  const projectDir = useOdaja((s) => s.projectDir);
  const closeProject = useOdaja((s) => s.closeProject);
  const scene = useOdaja((s) => s.scene);
  const selectedId = useOdaja((s) => s.selectedId);
  const select = useOdaja((s) => s.select);
  const [adding, setAdding] = useState(false);

  return (
    <aside className="sidebar">
      <header className="brand">
        <button className="logo-button" onClick={closeProject} title="Back to projects">
          <span className="logo">Odaja</span>
        </button>
        <span className="project-name" title={projectDir ?? undefined}>
          {project?.name ?? "…"}
        </span>
      </header>

      <ScenesSection />

      <section className="grow">
        <div className="section-head">
          <h2>{adding ? "Add object" : "Objects"}</h2>
          <button className={`add-button ${adding ? "active" : ""}`} onClick={() => setAdding(!adding)} disabled={!scene}>
            {adding ? "Close" : "+ Add"}
          </button>
        </div>
        {adding ? (
          <AddPanel onClose={() => setAdding(false)} />
        ) : scene?.objects.length === 0 ? (
          <p className="muted empty-hint">No objects yet. Click + Add, or ask an agent to furnish this scene.</p>
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
  const status = useOdaja((s) => s.status);
  useEffect(() => {
    load();
  }, [load]);
  useShortcuts();

  if (status === "loading") return null;
  if (status === "start") return <StartScreen />;
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
