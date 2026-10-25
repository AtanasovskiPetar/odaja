// Inspector for Structure mode: edit the selected wall, door/window, room or
// stair, or turn an enclosed area into a room.
import { formatCm, polygonArea, wallLength } from "../model/geometry";
import { levelAbove } from "../model/levels";
import { addRoom, deleteOpening, deleteRoom, deleteWall, setWallLength, updateOpening, updateRoom, updateWall } from "../model/shellOps";
import { DEFAULT_SHELL, STAIR_TYPES, type Stair } from "../model/schema";
import { defaultStairSize, deleteStair, flightWidth, stepSizes, updateStair } from "../model/stairs";
import { useOdaja } from "../store";
import { JoineryFields, MaterialSelect, RoomFinishes, WallFinishes } from "./FinishesInspector";
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
      stairs: "Click where the stairs go: a straight flight up to the level above. Then drag it into place and set its type, size and direction here.",
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
        <MaterialSelect label="Wall material (bare wall)" value={wall.material ?? "wall"} onChange={(m) => applyShell(updateWall(wall.id, { material: !m || m === "wall" ? undefined : m }))} />
        <WallFinishes wall={wall} />
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
        <JoineryFields opening={o} />
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

  if (selection.kind === "stair") {
    const stair = shell.stairs.find((s) => s.id === selection.id);
    return stair ? <StairInspector stair={stair} /> : null;
  }

  const room = shell.rooms.find((r) => r.id === selection.id);
  if (!room) return null;
  return (
    <section className="inspector">
      <div className="group-title">Room · {room.id}</div>
      <Field label="Name" value={room.name} onCommit={(v) => v.trim() && applyShell(updateRoom(room.id, { name: v.trim() }))} />
      <MaterialSelect label="Floor (room default)" value={room.floor ?? "oak"} onChange={(m) => m && applyShell(updateRoom(room.id, { floor: m }))} />
      <RoomFinishes room={room} />
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

export const STAIR_NAMES: Record<Stair["type"], string> = { straight: "Straight", l: "L-shaped", u: "U-shaped", spiral: "Spiral" };

function StairInspector({ stair }: { stair: Stair }) {
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const above = useOdaja((s) => (s.wholeShell ? levelAbove(s.wholeShell, s.level) : undefined));
  // The level view fills in the rise (up to the level above).
  const rise = stair.rise ?? 280;
  const { count, riser, going } = stepSizes(stair, rise);
  const set = (patch: Parameters<typeof updateStair>[1]) => applyShell(updateStair(stair.id, patch));
  const size = (i: 0 | 1) => (v: string) => set({ size: (i === 0 ? [Number(v), stair.size[1]] : [stair.size[0], Number(v)]) as [number, number] });
  return (
    <section className="inspector">
      <div className="group-title">Stairs · {stair.id}</div>
      <label className="field">
        <span>Type</span>
        <select
          value={stair.type}
          onChange={(e) => {
            const type = e.target.value as Stair["type"];
            set({ type, size: defaultStairSize(type, rise), width: undefined });
          }}
        >
          {STAIR_TYPES.map((t) => (
            <option key={t} value={t}>
              {STAIR_NAMES[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        {stair.type === "spiral" ? (
          <Field label="Diameter" numeric suffix="cm" min={100} max={400} value={stair.size[0]} onCommit={(v) => set({ size: [Number(v), Number(v)] })} />
        ) : (
          <>
            <Field label="Width" numeric suffix="cm" min={50} max={1000} value={stair.size[0]} onCommit={size(0)} />
            <Field label="Length" numeric suffix="cm" min={50} max={1500} value={stair.size[1]} onCommit={size(1)} />
          </>
        )}
        {(stair.type === "l" || stair.type === "u") && (
          <Field label="Flight width" numeric suffix="cm" min={50} max={300} value={Math.round(flightWidth(stair))} onCommit={(v) => set({ width: Number(v) })} />
        )}
        <Field label="Steps" numeric min={2} max={40} value={count} onCommit={(v) => set({ steps: Number(v) })} />
        <Field label="Rotation" numeric suffix="°" min={-360} max={360} value={stair.rotation} onCommit={(v) => set({ rotation: Number(v) })} />
      </div>
      {stair.type !== "spiral" && (
        <label className="check" title="Tread plates on stringers with nothing under them, instead of solid steps">
          <input type="checkbox" checked={stair.open === true} onChange={(e) => set({ open: e.target.checked || undefined })} />
          Open underneath
        </label>
      )}
      <div className="actions">
        <button onClick={() => set({ rotation: stair.rotation + 90 })}>Turn 90°</button>
        {stair.type !== "straight" && <button onClick={() => set({ turn: stair.turn === "left" ? "right" : "left" })}>Turn {stair.turn === "left" ? "right" : "left"} instead</button>}
      </div>
      <MaterialSelect label="Material" value={stair.material ?? "oak"} onChange={(m) => set({ material: m && m !== "oak" ? m : undefined })} />
      <p className="hint">
        Up {formatCm(rise)} cm {above ? `to ${above.name}` : "(no level above yet)"} in {count} steps: {riser.toFixed(1)} cm risers, {Math.round(going)} cm treads.
        {above && " The floor above gets an opening over the stairs."}
      </p>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            applyShell(deleteStair(stair.id));
            selectStructure(null);
          }}
          title="Delete (⌫)"
        >
          Delete stairs
        </button>
      </div>
      <SharedNote />
    </section>
  );
}
