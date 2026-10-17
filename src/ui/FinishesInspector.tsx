// Inspector parts for finishes (tiles, paint, floors), joinery settings and
// quantities. Finishes belong to the open scene, so options can differ.
import { useState } from "react";
import { quantities, roomFacing } from "../model/finishes";
import { addFinish, clearRoomWalls, finishRoomWalls, removeFinishes, setRoomFloor, updateFinish } from "../model/finishOps";
import { wallLength } from "../model/geometry";
import type { Opening, Room, Wall } from "../model/schema";
import { updateOpening } from "../model/shellOps";
import { useOdaja } from "../store";
import { Field } from "./Inspector";

const EDIT = "__edit__";

// Material picker with a shortcut to the materials editor.
export function MaterialSelect({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (name: string | null) => void; allowNone?: string }) {
  const materials = useOdaja((s) => s.project?.materials);
  const openDialog = useOdaja((s) => s.openDialog);
  const names = Object.keys(materials ?? {}).sort();
  if (value && !names.includes(value)) names.unshift(value);
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === EDIT) openDialog({ kind: "materials", focus: value ?? undefined });
          else onChange(e.target.value || null);
        }}
      >
        {allowNone !== undefined && <option value="">{allowNone}</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
            {materials?.[n]?.tile ? ` (${materials[n].tile!.image ? "photo" : `${materials[n].tile!.size[0]}×${materials[n].tile!.size[1]}`})` : ""}
          </option>
        ))}
        <option value={EDIT}>Edit materials…</option>
      </select>
    </label>
  );
}

function defaultTileMaterial(materials: Record<string, { tile?: unknown }> | undefined) {
  const names = Object.keys(materials ?? {});
  return names.find((n) => materials![n].tile) ?? (names.includes("tile-white") ? "tile-white" : (names[0] ?? "wall"));
}

export function WallFinishes({ wall }: { wall: Wall }) {
  const shell = useOdaja((s) => s.shell);
  const finishes = useOdaja((s) => s.scene?.finishes);
  const materials = useOdaja((s) => s.project?.materials);
  const apply = useOdaja((s) => s.apply);
  if (!shell) return null;
  const height = wall.height ?? shell.wallHeight;
  return (
    <div className="field-group">
      <div className="group-title">Finishes (this scene)</div>
      {(["left", "right"] as const).map((side) => {
        const room = roomFacing(shell, wall, side);
        const list = (finishes ?? []).filter((f) => f.wall === wall.id && f.side === side);
        return (
          <div key={side} className="finish-side">
            <div className="finish-side-head">
              <span>{room ? `${room.name} side` : `${side} side (outside)`}</span>
              <button
                onClick={() => apply(addFinish({ surface: "wall", wall: wall.id, side, material: defaultTileMaterial(materials) }))}
                title="Tiles, paint or panels on this side"
              >
                + Add
              </button>
            </div>
            {list.map((f) => (
              <div key={f.id} className="finish-row">
                <MaterialSelect label="Material" value={f.material} onChange={(m) => m && apply(updateFinish(f.id, { material: m }))} />
                <div className="grid-2">
                  <Field label="From floor" numeric suffix="cm" min={0} max={height} value={f.bottom ?? 0} onCommit={(v) => apply(updateFinish(f.id, { bottom: Number(v) || undefined }))} />
                  <Field label="Up to" numeric suffix="cm" min={1} max={height} value={f.top ?? height} onCommit={(v) => apply(updateFinish(f.id, { top: Number(v) >= height ? undefined : Number(v) }))} />
                  <Field label="Along from" numeric suffix="cm" value={f.from ?? 0} onCommit={(v) => apply(updateFinish(f.id, { from: Number(v) || undefined }))} />
                  <Field
                    label="Along to"
                    numeric
                    suffix="cm"
                    value={f.to ?? Math.round(wallLength(wall))}
                    onCommit={(v) => apply(updateFinish(f.id, { to: Number(v) >= wallLength(wall) ? undefined : Number(v) }))}
                  />
                </div>
                <button className="link danger" onClick={() => apply(removeFinishes([f.id]))}>
                  Remove finish
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function RoomFinishes({ room }: { room: Room }) {
  const shell = useOdaja((s) => s.shell);
  const finishes = useOdaja((s) => s.scene?.finishes);
  const materials = useOdaja((s) => s.project?.materials);
  const apply = useOdaja((s) => s.apply);
  const [wallMaterial, setWallMaterial] = useState<string | null>(null);
  const [top, setTop] = useState("200");
  if (!shell) return null;
  const floor = finishes?.find((f) => f.surface === "floor" && f.room === room.id);
  const chosen = wallMaterial ?? defaultTileMaterial(materials);
  return (
    <div className="field-group">
      <div className="group-title">Finishes (this scene)</div>
      <MaterialSelect label="Floor" value={floor?.material ?? null} allowNone={`Room default (${room.floor ?? "oak"})`} onChange={(m) => apply(setRoomFloor(room.id, m))} />
      <div className="finish-row">
        <MaterialSelect label="All walls of this room" value={chosen} onChange={(m) => setWallMaterial(m)} />
        <div className="grid-2">
          <label className="field">
            <span>Up to</span>
            <span className="input-wrap">
              <input value={top} onChange={(e) => setTop(e.target.value)} inputMode="decimal" />
              <span className="suffix">cm</span>
            </span>
          </label>
          <div className="actions inline">
            <button onClick={() => apply(finishRoomWalls(shell, room.id, chosen, 0, Number(top) >= shell.wallHeight ? undefined : Number(top) || undefined))}>Apply</button>
            <button className="danger" onClick={() => apply(clearRoomWalls(shell, room.id))} title="Remove wall finishes in this room">
              Clear
            </button>
          </div>
        </div>
        <p className="hint">e.g. bathroom tiles up to 200 cm, or paint full height. Doors and windows are cut out.</p>
      </div>
    </div>
  );
}

const DOOR_STYLES = [
  ["single", "Single swing"],
  ["double", "Double"],
  ["sliding", "Sliding (on the wall)"],
  ["pocket", "Pocket (into the wall)"],
  ["folding", "Folding"],
  ["glass", "Glass"],
] as const;
const WINDOW_STYLES = [
  ["casement", "Casement"],
  ["double-casement", "Double casement"],
  ["tilt-turn", "Tilt and turn"],
  ["sliding", "Sliding"],
  ["fixed", "Fixed"],
] as const;

export function JoineryFields({ opening }: { opening: Opening }) {
  const applyShell = useOdaja((s) => s.applyShell);
  if (opening.type === "opening") return null;
  const set = (patch: Parameters<typeof updateOpening>[1]) => applyShell(updateOpening(opening.id, patch));
  const styles = opening.type === "door" ? DOOR_STYLES : WINDOW_STYLES;
  const style = opening.style ?? (opening.type === "door" ? "single" : "casement");
  const panes = opening.panes ?? [1, 1];
  return (
    <div className="field-group">
      <div className="group-title">{opening.type === "door" ? "Door" : "Window"} type</div>
      <label className="field">
        <span>Type</span>
        <select value={style} onChange={(e) => set({ style: e.target.value as typeof style })}>
          {styles.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <Field label="Frame width" numeric suffix="cm" min={0} max={30} value={opening.frame ?? (opening.type === "door" ? 4 : 6)} onCommit={(v) => set({ frame: Number(v) })} />
        {opening.type === "door" && !["sliding", "pocket"].includes(style) && (
          <Field label="Shown open" numeric suffix="°" min={0} max={110} value={opening.open ?? 20} onCommit={(v) => set({ open: Number(v) })} />
        )}
        {(opening.type === "window" || style === "glass") && (
          <>
            <Field label="Panes across" numeric min={1} max={8} value={panes[0]} onCommit={(v) => set({ panes: [Math.round(Number(v)), panes[1]] })} />
            <Field label="Panes down" numeric min={1} max={8} value={panes[1]} onCommit={(v) => set({ panes: [panes[0], Math.round(Number(v))] })} />
          </>
        )}
      </div>
      <MaterialSelect label="Frame colour" value={opening.frameMaterial ?? null} allowNone="White" onChange={(m) => set({ frameMaterial: m ?? undefined })} />
    </div>
  );
}

// What to buy for this scene's finishes.
export function QuantitiesSection() {
  const scene = useOdaja((s) => s.scene);
  const shell = useOdaja((s) => s.shell);
  const project = useOdaja((s) => s.project);
  if (!scene || !shell || !project || scene.finishes.length === 0) return null;
  const lines = quantities(scene, shell, project.materials);
  const totals = new Map<string, { area: number; tiles: number }>();
  for (const l of lines) {
    const t = totals.get(l.material) ?? { area: 0, tiles: 0 };
    totals.set(l.material, { area: t.area + l.areaM2, tiles: t.tiles + (l.tiles ?? 0) });
  }
  return (
    <>
      <h2 className="spaced">Quantities</h2>
      <table className="quantities">
        <tbody>
          {[...totals].map(([material, t]) => (
            <tr key={material}>
              <td>{material}</td>
              <td>{t.area.toFixed(1)} m²</td>
              <td>{t.tiles ? `${t.tiles} tiles` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Tile counts include 10% for cuts and breakage. Doors and windows are subtracted.</p>
    </>
  );
}
