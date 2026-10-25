// Inspector for Structure mode: edit the selected wall, door/window, room or
// stair, or turn an enclosed area into a room.
import { formatCm, polygonArea, wallLength, wallOutline } from "../model/geometry";
import { addRoof, deleteRoof, hullOf, ROOF_LOOK, roofOverhang, roofPitch, roofRidge, roofRise, roofThickness, updateRoof } from "../model/roofs";
import { useDrawTools } from "./drawTools";
import { levelAbove } from "../model/levels";
import { addRoom, deleteOpening, deleteRoom, deleteWall, setWallLength, updateOpening, updateRoom, updateWall } from "../model/shellOps";
import { AREA_KINDS, DEFAULT_SHELL, FENCE_STYLES, ROOF_TYPES, STAIR_TYPES, type Area, type Fence, type Roof, type Stair } from "../model/schema";
import { addGate, AREA_LOOK, deleteArea, deleteFence, FENCE_LOOK, fenceHeight, fenceLength, fenceThickness, setPlot, updateArea, updateFence, updatePlot } from "../model/site";
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
      roof: "Click the corners of the outline the roof covers (usually the outer wall faces), then the first corner again or Enter. An L-shaped house takes two roofs.",
      garden: "Click the corners of a lawn, terrace, path or pool (pick the kind in the toolbar). Click the first corner again, double-click or press Enter to finish.",
      fence: "Click to start a fence, click again for each corner. Double-click or Esc to finish. Add gates in its inspector.",
      plot: "Click the corners of the plot's boundary, then the first corner again (or Enter) to finish. Drawing a new plot replaces the old one.",
    };
    return (
      <section className="inspector muted">
        {hints[tool]}
        {tool === "roof" && shell.walls.length > 0 && (
          <div className="actions">
            <button
              onClick={async () => {
                const before = new Set(shell.roofs.map((r) => r.id));
                await applyShell(addRoof({ type: useDrawTools.getState().roof, polygon: hullOf(shell.walls.flatMap(wallOutline)) }));
                const added = useOdaja.getState().shell?.roofs.find((r) => !before.has(r.id));
                useOdaja.getState().setTool("select");
                if (added) selectStructure({ kind: "roof", id: added.id });
              }}
            >
              Roof over this level's walls
            </button>
          </div>
        )}
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
  if (selection.kind === "roof") {
    const roof = shell.roofs.find((r) => r.id === selection.id);
    return roof ? <RoofInspector roof={roof} /> : null;
  }
  if (selection.kind === "garden") {
    const area = shell.areas.find((a) => a.id === selection.id);
    return area ? <AreaInspector area={area} /> : null;
  }
  if (selection.kind === "fence") {
    const fence = shell.fences.find((f) => f.id === selection.id);
    return fence ? <FenceInspector fence={fence} /> : null;
  }
  if (selection.kind === "plot") return shell.plot ? <PlotInspector /> : null;

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

function AreaInspector({ area }: { area: Area }) {
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const set = (patch: Parameters<typeof updateArea>[1]) => applyShell(updateArea(area.id, patch));
  return (
    <section className="inspector">
      <div className="group-title">{AREA_LOOK[area.kind].label} · {area.id}</div>
      <Field label="Name" value={area.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} />
      <label className="field">
        <span>Kind</span>
        <select value={area.kind} onChange={(e) => set({ kind: e.target.value as Area["kind"], material: undefined })}>
          {AREA_KINDS.map((k) => (
            <option key={k} value={k}>
              {AREA_LOOK[k].label}
            </option>
          ))}
        </select>
      </label>
      <MaterialSelect label="Surface" value={area.material ?? null} allowNone={`${AREA_LOOK[area.kind].label} colour`} onChange={(m) => set({ material: m ?? undefined })} />
      {area.kind !== "water" && (
        <Field label="Raised by (deck, terrace)" numeric suffix="cm" min={0} max={300} value={area.height ?? 0} onCommit={(v) => set({ height: Number(v) || undefined })} />
      )}
      <p className="hint">{(polygonArea(area.polygon) / 10000).toFixed(1)} m². Drag it to move it, or drag its corners; double-click an edge to add a corner, a corner to remove it.</p>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            applyShell(deleteArea(area.id));
            selectStructure(null);
          }}
          title="Delete (⌫)"
        >
          Delete area
        </button>
      </div>
      <SharedNote />
    </section>
  );
}

function FenceInspector({ fence }: { fence: Fence }) {
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const set = (patch: Parameters<typeof updateFence>[1]) => applyShell(updateFence(fence.id, patch));
  const look = FENCE_LOOK[fence.style];
  const setGate = (i: number, patch: Partial<Fence["gates"][number]>) => set({ gates: fence.gates.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  return (
    <section className="inspector">
      <div className="group-title">{look.label} · {fence.id}</div>
      <label className="field">
        <span>Style</span>
        <select value={fence.style} onChange={(e) => set({ style: e.target.value as Fence["style"], height: undefined, thickness: undefined, material: undefined })}>
          {FENCE_STYLES.map((k) => (
            <option key={k} value={k}>
              {FENCE_LOOK[k].label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <Field label="Height" numeric suffix="cm" min={20} max={400} value={fenceHeight(fence)} onCommit={(v) => set({ height: Number(v) === look.height ? undefined : Number(v) })} />
        <Field label="Thickness" numeric suffix="cm" min={1} max={200} value={fenceThickness(fence)} onCommit={(v) => set({ thickness: Number(v) === look.thickness ? undefined : Number(v) })} />
      </div>
      <MaterialSelect label="Material" value={fence.material ?? null} allowNone={`${look.label} colour`} onChange={(m) => set({ material: m ?? undefined })} />
      {fence.gates.map((g, i) => (
        <div key={i} className="grid-2">
          <Field label={`Gate ${i + 1} from start`} numeric suffix="cm" min={0} value={g.offset} onCommit={(v) => setGate(i, { offset: Number(v) })} />
          <Field label="Width" numeric suffix="cm" min={30} value={g.width} onCommit={(v) => setGate(i, { width: Number(v) })} />
        </div>
      ))}
      <p className="hint">{formatCm(fenceLength(fence))} cm long. Drag it to move it, or drag its ends.</p>
      <div className="actions">
        <button onClick={() => applyShell(addGate(fence.id))}>Add gate</button>
        {fence.gates.length > 0 && <button onClick={() => set({ gates: fence.gates.slice(0, -1) })}>Remove last gate</button>}
        <button
          className="danger"
          onClick={() => {
            applyShell(deleteFence(fence.id));
            selectStructure(null);
          }}
          title="Delete (⌫)"
        >
          Delete fence
        </button>
      </div>
      <SharedNote />
    </section>
  );
}

function PlotInspector() {
  const plot = useOdaja((s) => s.shell?.plot);
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  if (!plot) return null;
  return (
    <section className="inspector">
      <div className="group-title">Plot</div>
      <MaterialSelect label="Ground" value={plot.material ?? null} allowNone="Grass colour" onChange={(m) => applyShell(updatePlot({ material: m }))} />
      <p className="hint">{(polygonArea(plot.polygon) / 10000).toFixed(1)} m². Drag its corners to reshape it; double-click an edge to add a corner, a corner to remove it.</p>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            applyShell(setPlot(null));
            selectStructure(null);
          }}
        >
          Delete plot
        </button>
      </div>
      <SharedNote />
    </section>
  );
}

function RoofInspector({ roof }: { roof: Roof }) {
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const set = (patch: Parameters<typeof updateRoof>[1]) => applyShell(updateRoof(roof.id, patch));
  const look = ROOF_LOOK[roof.type];
  return (
    <section className="inspector">
      <div className="group-title">{look.label} · {roof.id}</div>
      <label className="field">
        <span>Type</span>
        <select value={roof.type} onChange={(e) => set({ type: e.target.value as Roof["type"], pitch: undefined, overhang: undefined })}>
          {ROOF_TYPES.map((k) => (
            <option key={k} value={k}>
              {ROOF_LOOK[k].label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        {roof.type !== "flat" && (
          <Field label="Pitch" numeric suffix="°" min={0} max={75} value={roofPitch(roof)} onCommit={(v) => set({ pitch: Number(v) === look.pitch ? undefined : Number(v) })} />
        )}
        <Field label="Overhang" numeric suffix="cm" min={0} max={200} value={roofOverhang(roof)} onCommit={(v) => set({ overhang: Number(v) === look.overhang ? undefined : Number(v) })} />
        <Field label="Thickness" numeric suffix="cm" min={1} max={100} value={roofThickness(roof)} onCommit={(v) => set({ thickness: Number(v) })} />
      </div>
      {roof.type === "gable" && (
        <div className="actions">
          <button onClick={() => set({ ridge: roofRidge(roof) === "x" ? "y" : "x" })}>Turn the ridge</button>
        </div>
      )}
      {roof.type === "shed" && (
        <label className="field">
          <span>Slopes down to</span>
          <select value={roof.downTo ?? "south"} onChange={(e) => set({ downTo: e.target.value as NonNullable<Roof["downTo"]> })}>
            {(["north", "east", "south", "west"] as const).map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}
      <MaterialSelect label="Covering" value={roof.material ?? null} allowNone="Roof colour" onChange={(m) => set({ material: m ?? undefined })} />
      {roof.type !== "flat" && (
        <label className="check" title="The roof's underside is the ceiling of the rooms under it, and inside walls rise to meet it (a loft or vaulted room)">
          <input type="checkbox" checked={roof.ceiling === "sloped"} onChange={(e) => set({ ceiling: e.target.checked ? "sloped" : undefined })} />
          Sloped ceilings in the rooms under it
        </label>
      )}
      <p className="hint">
        {roof.type === "flat" ? "Flat" : `Rises ${formatCm(roofRise(roof))} cm above the walls`}. Hide roofs with the roof button in the 3D view to look inside. Drag the outline's corners to reshape it; double-click an edge to add a corner, a corner to remove it.
      </p>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            applyShell(deleteRoof(roof.id));
            selectStructure(null);
          }}
          title="Delete (⌫)"
        >
          Delete roof
        </button>
      </div>
      <SharedNote />
    </section>
  );
}
