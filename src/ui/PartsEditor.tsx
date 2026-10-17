// Sidebar of the shape editor: the parts list with add buttons and actions,
// and an inspector for the selected part (sizes, position, cut-outs,
// outline points, repeat, material).
import { useEffect, useState } from "react";
import { addPart, duplicateParts, mirrorParts, partBounds, removeParts, sitOnTop, updatePart } from "../model/partOps";
import type { PartInput } from "../model/schema";
import { useOdaja } from "../store";
import { MaterialSelect } from "./FinishesInspector";
import { Field } from "./Inspector";

const r1 = (n: number) => Math.round(n * 10) / 10;

// Ready-made outlines for extrusions.
function arch(width: number, height: number, steps = 16): [number, number][] {
  const r = width / 2;
  const pts: [number, number][] = [[-r, 0], [r, 0], [r, height - r]];
  for (let i = 1; i < steps; i++) {
    const a = (Math.PI * i) / steps;
    pts.push([r1(r * Math.cos(a)), r1(height - r + r * Math.sin(a))]);
  }
  pts.push([-r, height - r]);
  return pts;
}

function circle(radius: number, steps = 32): [number, number][] {
  return Array.from({ length: steps }, (_, i) => [r1(radius * Math.cos((2 * Math.PI * i) / steps)), r1(radius * Math.sin((2 * Math.PI * i) / steps))] as [number, number]);
}

const NEW_PARTS: { label: string; part: PartInput; title: string }[] = [
  { label: "Box", part: { shape: "box", size: [40, 40, 40] }, title: "Panels, tops, cabinets, cushions" },
  { label: "Cylinder", part: { shape: "cylinder", radius: 10, height: 40 }, title: "Legs, rails, pipes, round tops" },
  { label: "Sphere", part: { shape: "sphere", radius: 15 }, title: "Knobs, lamps, decoration" },
  { label: "Wedge", part: { shape: "wedge", size: [40, 40, 20] }, title: "Sloped backs, ramps" },
  {
    label: "L-shape",
    part: { shape: "extrusion", profile: [[-60, -30], [60, -30], [60, 30], [0, 30], [0, 90], [-60, 90]], depth: 4 },
    title: "An outline on the plan raised up: L-shaped worktops, custom tops",
  },
  { label: "Arch", part: { shape: "extrusion", axis: "y", profile: arch(160, 120), depth: 6 }, title: "Front outline pushed back: headboards, arches" },
  { label: "Round top", part: { shape: "extrusion", profile: circle(50), depth: 4 }, title: "Round or oval tables" },
];

function placed(part: PartInput, on: PartInput | undefined): PartInput {
  if (!on) return part;
  // New parts go on top of the selected one.
  const b = partBounds(on);
  return { ...part, at: [r1((b.minX + b.maxX) / 2), r1((b.minY + b.maxY) / 2), r1(b.maxZ)] };
}

export function PartsSection() {
  const id = useOdaja((s) => s.editingObjectId);
  const object = useOdaja((s) => s.sceneDoc?.objects?.find((o) => o.id === s.editingObjectId));
  const selection = useOdaja((s) => s.partSelection);
  const tool = useOdaja((s) => s.partTool);
  const selectParts = useOdaja((s) => s.selectParts);
  const setTool = useOdaja((s) => s.setPartTool);
  const apply = useOdaja((s) => s.apply);
  const stop = useOdaja((s) => s.stopEditingShape);
  const openDialog = useOdaja((s) => s.openDialog);
  if (!id || !object?.parts) return null;
  const parts = object.parts;

  const add = (part: PartInput) => {
    apply(addPart(id, placed(part, selection.length === 1 ? parts[selection[0]] : undefined)));
    selectParts([parts.length]);
  };
  const act = (op: (doc: Parameters<ReturnType<typeof addPart>>[0]) => ReturnType<ReturnType<typeof addPart>>, select?: number[]) => {
    apply(op);
    if (select) selectParts(select);
  };

  return (
    <section className="grow">
      <div className="section-head">
        <h2>Shape · {object.name}</h2>
        <button className="add-button active" onClick={stop} title="Finish editing (Enter)">
          Done
        </button>
      </div>
      <div className="part-tools">
        {(
          [
            ["move", "Move", "G"],
            ["rotate", "Rotate", "R"],
            ["size", "Size", "S"],
          ] as const
        ).map(([t, label, key]) => (
          <button key={t} className={tool === t ? "active" : ""} onClick={() => setTool(t)} title={`${label} with the handles (${key})`}>
            {label}
          </button>
        ))}
      </div>
      <div className="add-grid parts-add">
        {NEW_PARTS.map((p) => (
          <button key={p.label} onClick={() => add(p.part)} title={p.title}>
            + {p.label}
          </button>
        ))}
      </div>
      <ul className="list parts-list">
        {parts.map((p, i) => (
          <li key={i}>
            <button
              className={selection.includes(i) ? "active" : ""}
              onClick={(e) => selectParts(e.shiftKey ? (selection.includes(i) ? selection.filter((j) => j !== i) : [...selection, i]) : [i])}
            >
              {p.name ?? `${p.shape} ${i + 1}`}
              <span className="muted">
                {p.shape}
                {p.repeat && p.repeat.count > 1 ? ` ×${p.repeat.count}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selection.length > 0 && (
        <div className="actions">
          <button onClick={() => act(duplicateParts(id, selection), selection.map((_, k) => parts.length + k))} title="Duplicate (⌘D)">
            Duplicate
          </button>
          <button onClick={() => act(mirrorParts(id, selection, "x"), selection.map((_, k) => parts.length + k))} title="Mirrored copy, left ↔ right (M)">
            Mirror ↔
          </button>
          <button onClick={() => act(mirrorParts(id, selection, "y"), selection.map((_, k) => parts.length + k))} title="Mirrored copy, front ↔ back">
            Mirror ↕
          </button>
          {selection.length === 1 && (
            <button onClick={() => act(sitOnTop(id, selection[0]))} title="Rest it on the part below (or the floor)">
              Sit on top
            </button>
          )}
          <button className="danger" disabled={selection.length >= parts.length} onClick={() => act(removeParts(id, selection), [])} title="Delete (⌫)">
            Delete
          </button>
        </div>
      )}
      <p className="hint">
        Click parts in the view (Shift adds). Drag the handles; moving snaps to other parts. Ask the chat for help too.{" "}
        <button className="link" onClick={() => openDialog({ kind: "save", objectId: id })}>
          Save to library
        </button>
      </p>
    </section>
  );
}

function Num({ label, value, onCommit, suffix = "cm", min, max }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string; min?: number; max?: number }) {
  return <Field label={label} numeric suffix={suffix} min={min} max={max} value={value} onCommit={(v) => onCommit(Number(v))} />;
}

function HolesEditor({ part, set }: { part: Extract<PartInput, { shape: "box" | "extrusion" }>; set: (patch: Record<string, unknown>) => void }) {
  const holes = part.holes ?? [];
  const update = (i: number, h: (typeof holes)[number] | null) => {
    const next = holes.flatMap((x, j) => (j === i ? (h ? [h] : []) : [x]));
    set({ holes: next.length ? next : undefined });
  };
  return (
    <div className="field-group">
      <div className="group-title">Cut-outs (go all the way through)</div>
      {holes.map((h, i) => (
        <div key={i} className="grid-2 hole-row">
          <Num label="Centre x" value={h.at[0]} onCommit={(v) => update(i, { ...h, at: [v, h.at[1]] })} />
          <Num label="Centre y" value={h.at[1]} onCommit={(v) => update(i, { ...h, at: [h.at[0], v] })} />
          {"radius" in h ? (
            <Num label="Radius" value={h.radius} min={0.5} onCommit={(v) => update(i, { ...h, radius: v })} />
          ) : (
            <>
              <Num label="Width" value={h.size[0]} min={0.5} onCommit={(v) => update(i, { ...h, size: [v, h.size[1]] })} />
              <Num label="Depth" value={h.size[1]} min={0.5} onCommit={(v) => update(i, { ...h, size: [h.size[0], v] })} />
            </>
          )}
          <button className="link danger" onClick={() => update(i, null)}>
            Remove
          </button>
        </div>
      ))}
      <div className="actions">
        <button onClick={() => set({ holes: [...holes, { at: [0, 0], size: [40, 30] }] })} title="e.g. a sink cut-out">
          + Rectangle
        </button>
        <button onClick={() => set({ holes: [...holes, { at: [0, 0], radius: 5 }] })} title="e.g. a tap or cable hole">
          + Circle
        </button>
      </div>
    </div>
  );
}

function ProfileEditor({ part, set }: { part: Extract<PartInput, { shape: "extrusion" }>; set: (patch: Record<string, unknown>) => void }) {
  const text = part.profile.map(([a, b]) => `${a}, ${b}`).join("\n");
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  // Show changes made elsewhere (handles, undo, the chat).
  useEffect(() => setDraft(text), [text]);
  const axis = part.axis ?? "z";
  const commit = () => {
    const pts = draft
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/[,\s;]+/).map(Number));
    if (pts.length < 3 || pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) {
      setError("One point per line as 'a, b'; at least 3 points.");
      return;
    }
    setError(null);
    set({ profile: pts as [number, number][] });
  };
  return (
    <label className="field">
      <span>Outline points ({axis === "z" ? "x, y on the plan" : axis === "y" ? "x, height (front view)" : "y, height (side view)"}, cm)</span>
      <textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      {error && <span className="inline-error">{error}</span>}
    </label>
  );
}

export function PartInspector() {
  const id = useOdaja((s) => s.editingObjectId);
  const selection = useOdaja((s) => s.partSelection);
  const part = useOdaja((s) => (s.partSelection.length === 1 ? s.sceneDoc?.objects?.find((o) => o.id === s.editingObjectId)?.parts?.[s.partSelection[0]] : undefined));
  const apply = useOdaja((s) => s.apply);
  if (!id) return null;
  if (!part) {
    return <section className="inspector muted">{selection.length > 1 ? `${selection.length} parts selected.` : "Select a part to edit it, or add one above."}</section>;
  }
  const index = selection[0];
  const set = (patch: Record<string, unknown>) => apply(updatePart(id, index, patch));
  const at = (part.at ?? [0, 0, 0]) as [number, number, number];
  const repeat = part.repeat;

  return (
    <section className="inspector">
      <Field label="Name" value={part.name ?? ""} onCommit={(v) => set({ name: v.trim() || undefined })} />
      <div className="field-group">
        <div className="group-title">Size</div>
        <div className="grid-2">
          {(part.shape === "box" || part.shape === "wedge") && (
            <>
              <Num label="Width" min={0.1} value={part.size[0]} onCommit={(v) => set({ size: [v, part.size[1], part.size[2]] })} />
              <Num label="Depth" min={0.1} value={part.size[1]} onCommit={(v) => set({ size: [part.size[0], v, part.size[2]] })} />
              <Num label="Height" min={0.1} value={part.size[2]} onCommit={(v) => set({ size: [part.size[0], part.size[1], v] })} />
              {part.shape === "box" && <Num label="Round corners" min={0} value={part.radius ?? 0} onCommit={(v) => set({ radius: v || undefined })} />}
            </>
          )}
          {part.shape === "cylinder" && (
            <>
              <Num label="Radius" min={0.1} value={part.radius} onCommit={(v) => set({ radius: v })} />
              <Num label={(part.axis ?? "z") === "z" ? "Height" : "Length"} min={0.1} value={part.height} onCommit={(v) => set({ height: v })} />
            </>
          )}
          {part.shape === "sphere" && <Num label="Radius" min={0.1} value={part.radius} onCommit={(v) => set({ radius: v })} />}
          {part.shape === "extrusion" && <Num label={(part.axis ?? "z") === "z" ? "Thickness (up)" : "Depth"} min={0.1} value={part.depth} onCommit={(v) => set({ depth: v })} />}
          {(part.shape === "cylinder" || part.shape === "extrusion") && (
            <label className="field">
              <span>Direction</span>
              <select value={part.axis ?? "z"} onChange={(e) => set({ axis: e.target.value === "z" ? undefined : e.target.value })}>
                <option value="z">{part.shape === "cylinder" ? "Upright" : "Outline on the plan"}</option>
                <option value="x">{part.shape === "cylinder" ? "Lying left–right" : "Side outline"}</option>
                <option value="y">{part.shape === "cylinder" ? "Lying front–back" : "Front outline"}</option>
              </select>
            </label>
          )}
        </div>
      </div>
      {part.shape === "extrusion" && <ProfileEditor part={part} set={set} />}
      <div className="field-group">
        <div className="group-title">Position in the object</div>
        <div className="grid-2">
          <Num label="Across (x)" value={at[0]} onCommit={(v) => set({ at: [v, at[1], at[2]] })} />
          <Num label="Front–back (y)" value={at[1]} onCommit={(v) => set({ at: [at[0], v, at[2]] })} />
          <Num label="Bottom height" min={0} value={at[2]} onCommit={(v) => set({ at: [at[0], at[1], v] })} />
          <Num label="Rotation" suffix="°" value={part.rotation ?? 0} onCommit={(v) => set({ rotation: ((v % 360) + 360) % 360 || undefined })} />
        </div>
      </div>
      <MaterialSelect label="Material" value={part.material ?? null} allowNone="Default grey" onChange={(m) => set({ material: m ?? undefined, color: undefined })} />
      <div className="field-group">
        <div className="group-title">Repeat</div>
        <div className="grid-2">
          <Num label="Copies in total" suffix="" min={1} max={50} value={repeat?.count ?? 1} onCommit={(v) => set({ repeat: v > 1 ? { count: Math.round(v), step: repeat?.step ?? [0, 0, 30] } : undefined })} />
          {repeat && repeat.count > 1 && (
            <>
              <Num label="Step across" value={repeat.step[0]} onCommit={(v) => set({ repeat: { ...repeat, step: [v, repeat.step[1], repeat.step[2]] } })} />
              <Num label="Step front–back" value={repeat.step[1]} onCommit={(v) => set({ repeat: { ...repeat, step: [repeat.step[0], v, repeat.step[2]] } })} />
              <Num label="Step up" value={repeat.step[2]} onCommit={(v) => set({ repeat: { ...repeat, step: [repeat.step[0], repeat.step[1], v] } })} />
            </>
          )}
        </div>
        <p className="hint">e.g. 5 shelves 40 cm apart: 5 copies, step up 40.</p>
      </div>
      {(part.shape === "box" || part.shape === "extrusion") && <HolesEditor part={part} set={set} />}
    </section>
  );
}
