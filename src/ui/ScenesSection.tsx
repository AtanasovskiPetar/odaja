import { useRef, useState } from "react";
import { useOdaja } from "../store";

// Scene list with new / duplicate / rename / delete. Double-click a scene to
// rename it.
export function ScenesSection() {
  const scenes = useOdaja((s) => s.scenes);
  const scenePath = useOdaja((s) => s.scenePath);
  const openScene = useOdaja((s) => s.openScene);
  const newScene = useOdaja((s) => s.newScene);
  const duplicateScene = useOdaja((s) => s.duplicateScene);
  const renameScene = useOdaja((s) => s.renameScene);
  const deleteScene = useOdaja((s) => s.deleteScene);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((err) => setError((err as Error).message));
  };
  const current = scenes.find((s) => s.path === scenePath);

  return (
    <section>
      <div className="section-head">
        <h2>Scenes</h2>
        <button className="add-button" onClick={() => run(async () => setRenaming(await newScene()))}>
          + New
        </button>
      </div>
      <ul className="list">
        {scenes.map((scene) => (
          <li key={scene.path}>
            {renaming === scene.path ? (
              <RenameInput
                initial={scene.name}
                onDone={(name) => {
                  setRenaming(null);
                  if (name && name !== scene.name) run(() => renameScene(scene.path, name));
                }}
              />
            ) : (
              <button
                className={scene.path === scenePath ? "active" : ""}
                onClick={() => scene.path !== scenePath && run(() => openScene(scene.path))}
                onDoubleClick={() => setRenaming(scene.path)}
                title={`${scene.path} · double-click to rename`}
              >
                {scene.name}
                {scene.shell !== "shell.json" && <span className="tag" title={`Uses ${scene.shell}`}>own walls</span>}
              </button>
            )}
          </li>
        ))}
      </ul>
      {current && renaming === null && (
        <div className="scene-actions">
          <button onClick={() => setRenaming(current.path)}>Rename</button>
          <button onClick={() => run(() => duplicateScene(false))} title="Copy this scene's furniture; walls stay shared">
            Duplicate
          </button>
          <button onClick={() => run(() => duplicateScene(true))} title="Copy this scene with its own copy of the walls, to try wall changes (a renovation option)">
            + own walls
          </button>
          <button
            className="danger"
            disabled={scenes.length <= 1}
            title={scenes.length <= 1 ? "A project needs at least one scene" : undefined}
            onClick={() => window.confirm(`Delete the scene "${current.name}"? This removes ${current.path}.`) && run(() => deleteScene(current.path))}
          >
            Delete
          </button>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

export function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  // Escape and blur can both fire; only report once.
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="rename-input"
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}
