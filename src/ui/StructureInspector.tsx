// Inspector for Structure mode: edit the selected wall, door/window or room,
// or turn an enclosed area into a room.
import { formatCm, polygonArea, wallLength } from "../model/geometry";
import { addRoom, deleteOpening, deleteRoom, deleteWall, setWallLength, updateOpening, updateRoom, updateWall } from "../model/shellOps";
import { DEFAULT_SHELL } from "../model/schema";
import { useOdaja } from "../store";
import { Field } from "./Inspector";

function SharedNote() {
  const scenes = useOdaja((s) => s.scenes);
  const shellPath = useOdaja((s) => s.shellPath);
  const users = scenes.filter((sc) => sc.shell === shellPath);
  if (users.length <= 1) return null;
  return (
    <p className="shared-note">
      These walls are shared by {users.length} scenes ({users.map((u) => u.name).join(", ")}). Changes apply to all of them.
      {shellPath === DEFAULT_SHELL && " To try a wall change in one scene only, duplicate it with its own walls first."}
    </p>
  );
}

export function StructureInspector() {
  const selection = useOdaja((s) => s.structureSelection);
  const shell = useOdaja((s) => s.shell);
  const materials = useOdaja((s) => s.project?.materials);
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const tool = useOdaja((s) => s.tool);

  if (!shell) return null;

  if (!selection) {
    const hints: Record<string, string> = {
      select: "Click a wall, door, window or room to edit it. Drag walls and corners to move them. Click inside an enclosed area to make it a room.",
      wall: "Click to start a wall, click again for each corner. Type a length and press Enter for an exact wall. Double-click or Esc to finish.",
      room: "Click two opposite corners, or click one corner and type the inside size like 420x330, then Enter.",
      door: "Click on a wall to add a door. It's kept clear of corners and other openings.",
      window: "Click on a wall to add a window.",
    };
    return (
      <section className="inspector muted">
        {hints[tool]}
        <SharedNote />
      </section>
    );
  }

  if (selection.kind === "area") {
    const size = polygonArea(selection.polygon) / 10000;
    return (
      <section className="inspector">
        <div className="group-title">Enclosed area · {size.toFixed(1)} m² (to wall centres)</div>
        <div className="actions">
          <button
            onClick={async () => {
              const before = new Set(shell.rooms.map((r) => r.id));
              await applyShell(addRoom(selection.polygon));
              const created = useOdaja.getState().shell?.rooms.find((r) => !before.has(r.id));
              if (created) selectStructure({ kind: "room", id: created.id });
            }}
          >
            Make room
          </button>
        </div>
      </section>
    );
  }

  if (selection.kind === "wall") {
    const wall = shell.walls.find((w) => w.id === selection.id);
    if (!wall) return null;
    const openings = shell.openings.filter((o) => o.wall === wall.id);
    return (
      <section className="inspector">
        <div className="group-title">Wall · {wall.id}</div>
        <div className="grid-2">
          <Field label="Length (centre line)" numeric suffix="cm" min={10} value={formatCm(wallLength(wall))} onCommit={(v) => applyShell(setWallLength(wall.id, Number(v)))} />
          <Field label="Thickness" numeric suffix="cm" min={1} max={100} value={wall.thickness} onCommit={(v) => applyShell(updateWall(wall.id, { thickness: Number(v) }))} />
          <Field
            label="Height"
            numeric
            suffix="cm"
            min={10}
            max={1000}
            value={wall.height ?? shell.wallHeight}
            onCommit={(v) => applyShell(updateWall(wall.id, { height: Number(v) === shell.wallHeight ? undefined : Number(v) }))}
          />
        </div>
        <MaterialSelect
          label="Material"
          value={wall.material ?? "wall"}
          materials={materials}
          onChange={(m) => applyShell(updateWall(wall.id, { material: m === "wall" ? undefined : m }))}
        />
        {openings.length > 0 && <p className="hint">{openings.length} door/window opening(s) in this wall are deleted with it.</p>}
        <div className="actions">
          <button
            className="danger"
            onClick={() => {
              applyShell(deleteWall(wall.id));
              selectStructure(null);
            }}
            title="Delete (⌫)"
          >
            Delete wall
          </button>
        </div>
        <SharedNote />
      </section>
    );
  }

  if (selection.kind === "opening") {
    const o = shell.openings.find((x) => x.id === selection.id);
    const wall = o && shell.walls.find((w) => w.id === o.wall);
    if (!o || !wall) return null;
    const set = (patch: Parameters<typeof updateOpening>[1]) => applyShell(updateOpening(o.id, patch));
    return (
      <section className="inspector">
        <div className="group-title">
          {o.type === "door" ? "Door" : o.type === "window" ? "Window" : "Opening"} · {o.id} · in {wall.id}
        </div>
        <label className="field">
          <span>Type</span>
          <select value={o.type} onChange={(e) => set({ type: e.target.value as typeof o.type })}>
            <option value="door">Door</option>
            <option value="window">Window</option>
            <option value="opening">Opening (no door)</option>
          </select>
        </label>
        <div className="grid-2">
          <Field label="Width" numeric suffix="cm" min={10} value={o.width} onCommit={(v) => set({ width: Number(v) })} />
          <Field label="Height" numeric suffix="cm" min={10} value={o.height} onCommit={(v) => set({ height: Number(v) })} />
          <Field label="Sill (from floor)" numeric suffix="cm" min={0} value={o.sill} onCommit={(v) => set({ sill: Number(v) || undefined })} />
          <Field label="From wall start" numeric suffix="cm" min={0} value={o.offset} onCommit={(v) => set({ offset: Number(v) })} />
        </div>
        {o.type === "door" && (
          <div className="actions">
            <button onClick={() => set({ hinge: o.hinge === "start" ? "end" : "start" })}>Flip hinge</button>
            <button onClick={() => set({ swing: o.swing === "left" ? "right" : "left" })}>Flip swing</button>
          </div>
        )}
        <p className="hint">Changes that don't fit (overlapping a corner or another opening) are adjusted or ignored.</p>
        <div className="actions">
          <button
            className="danger"
            onClick={() => {
              applyShell(deleteOpening(o.id));
              selectStructure(null);
            }}
          >
            Delete
          </button>
        </div>
        <SharedNote />
      </section>
    );
  }

  const room = shell.rooms.find((r) => r.id === selection.id);
  if (!room) return null;
  return (
    <section className="inspector">
      <div className="group-title">Room · {room.id}</div>
      <Field label="Name" value={room.name} onCommit={(v) => v.trim() && applyShell(updateRoom(room.id, { name: v.trim() }))} />
      <MaterialSelect label="Floor" value={room.floor ?? "oak"} materials={materials} onChange={(m) => applyShell(updateRoom(room.id, { floor: m }))} />
      <p className="hint">{(polygonArea(room.polygon) / 10000).toFixed(1)} m² to wall centres.</p>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            applyShell(deleteRoom(room.id));
            selectStructure(null);
          }}
        >
          Delete room (keeps walls)
        </button>
      </div>
      <SharedNote />
    </section>
  );
}

function MaterialSelect({
  label,
  value,
  materials,
  onChange,
}: {
  label: string;
  value: string;
  materials?: Record<string, { color: string }>;
  onChange: (name: string) => void;
}) {
  const names = Object.keys(materials ?? {});
  if (!names.includes(value)) names.unshift(value);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
