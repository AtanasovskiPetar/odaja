import { useState } from "react";
import { levelById, levelsTopDown } from "../model/levels";
import { useOdaja } from "../store";
import { Field } from "./Inspector";
import { RenameInput } from "./ScenesSection";

const metres = (cm: number) => `${cm > 0 ? "+" : ""}${(cm / 100).toFixed(2)} m`;

// The levels (storeys), highest first: click one to view and edit only it
// (the 3D view shows it with the levels below). Shown once a home has more
// than one level, and always in Structure mode, where levels are added,
// renamed (double-click), raised and deleted.
export function LevelsSection() {
  const whole = useOdaja((s) => s.wholeShell);
  const levelId = useOdaja((s) => s.level);
  const empty = useOdaja((s) => s.shell !== null && s.shell.walls.length === 0);
  const structure = useOdaja((s) => s.mode === "structure");
  const setLevel = useOdaja((s) => s.setLevel);
  const updateLevel = useOdaja((s) => s.updateLevel);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!whole) return null;
  const levels = levelsTopDown(whole);
  if (levels.length < 2 && !structure) return null;
  const active = levelById(whole, levelId);
  const below = levels.find((l) => l.elevation < active.elevation);

  return (
    <section>
      <div className="section-head">
        <h2>Levels</h2>
        {structure && (
          <button className="add-button" onClick={() => useOdaja.getState().addLevel()} title="Add a level on top of the highest one">
            + Level
          </button>
        )}
      </div>
      <ul className="list">
        {levels.map((l) => (
          <li key={l.id}>
            {renaming === l.id ? (
              <RenameInput
                initial={l.name}
                onDone={(name) => {
                  setRenaming(null);
                  if (name && name !== l.name) updateLevel(l.id, { name });
                }}
              />
            ) : (
              <button
                className={l.id === active.id ? "active" : ""}
                onClick={() => setLevel(l.id)}
                onDoubleClick={() => setRenaming(l.id)}
                title={`${l.id} · double-click to rename · PageUp/PageDown to switch`}
              >
                {l.name}
                <span className="muted">{metres(l.elevation)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {structure && (
        <>
          <div className="grid-2 level-fields">
            <Field label="Floor level" numeric suffix="cm" min={-2000} max={10000} value={active.elevation} onCommit={(v) => updateLevel(active.id, { elevation: Number(v) })} />
            <Field label="Wall height" numeric suffix="cm" min={50} max={1000} value={active.height ?? whole.wallHeight} onCommit={(v) => updateLevel(active.id, { height: Number(v) })} />
          </div>
          {empty && below && (
            <div className="scene-actions">
              <button onClick={() => useOdaja.getState().copyLevelWalls(below.id)} title={`Copy the walls and rooms of ${below.name} (not its doors and windows)`}>
                Copy walls from {below.name}
              </button>
            </div>
          )}
          <div className="scene-actions">
            <button onClick={() => setRenaming(active.id)}>Rename</button>
            <button
              className="danger"
              disabled={levels.length < 2}
              title={levels.length < 2 ? "A home needs at least one level" : undefined}
              onClick={() =>
                window.confirm(`Delete "${active.name}" with its walls, rooms and furniture (in every scene using these walls)?`) && useOdaja.getState().deleteLevel(active.id)
              }
            >
              Delete level
            </button>
          </div>
        </>
      )}
    </section>
  );
}
