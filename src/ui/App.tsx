import { useEffect } from "react";
import { rotateObject } from "../model/operations";
import { useOdaja } from "../store";
import { Viewport } from "../three/Viewport";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = useOdaja.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod) return;
      const selected = s.scene?.objects.find((o) => o.id === s.selectedId);
      switch (e.key.toLowerCase()) {
        case "r":
          if (selected && !selected.locked) s.apply(rotateObject(selected.id, e.shiftKey ? 15 : 90));
          break;
        case "t":
          s.requestView("top");
          break;
        case "p":
          s.requestView("perspective");
          break;
        case "c":
          s.toggleWallsCut();
          break;
        case "escape":
          s.select(null);
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
        <h2>Objects</h2>
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
      </section>

      <Inspector />
    </aside>
  );
}

function Inspector() {
  const object = useOdaja((s) => s.scene?.objects.find((o) => o.id === s.selectedId));
  if (!object) return <section className="inspector muted">Click an object to select it.</section>;
  return (
    <section className="inspector">
      <h2>{object.name}</h2>
      <dl>
        <dt>id</dt>
        <dd>{object.id}</dd>
        <dt>position</dt>
        <dd>
          {object.position[0]} × {object.position[1]} cm
        </dd>
        <dt>rotation</dt>
        <dd>{object.rotation}°</dd>
        {object.room && (
          <>
            <dt>room</dt>
            <dd>{object.room}</dd>
          </>
        )}
      </dl>
      <p className="hint">Drag the arrows to move · R rotate 90° · Shift+R rotate 15°</p>
    </section>
  );
}

function Toolbar() {
  const wallsCut = useOdaja((s) => s.wallsCut);
  const toggleWallsCut = useOdaja((s) => s.toggleWallsCut);
  const requestView = useOdaja((s) => s.requestView);
  const undo = useOdaja((s) => s.undo);
  const redo = useOdaja((s) => s.redo);
  const canUndo = useOdaja((s) => s.undoStack.length > 0);
  const canRedo = useOdaja((s) => s.redoStack.length > 0);

  return (
    <div className="toolbar">
      <button onClick={() => requestView("perspective")} title="Perspective view (P)">3D</button>
      <button onClick={() => requestView("top")} title="Top view (T)">Top</button>
      <button className={wallsCut ? "active" : ""} onClick={toggleWallsCut} title="Cut walls at 110 cm (C)">
        Cut walls
      </button>
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
        <Toolbar />
        <Errors />
      </main>
    </div>
  );
}
