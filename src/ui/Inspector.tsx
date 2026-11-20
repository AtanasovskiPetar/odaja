import { useEffect, useState } from "react";
import { TEMPLATES_BY_ID } from "../model/library";
import { setObjectProps, setTemplateParams } from "../model/operations";
import { objectLights, type Light, type LightInput, type SceneObject } from "../model/schema";
import { round } from "../model/units";
import { useOdaja } from "../store";
import { useLamps } from "./lampState";
import { LAMP_COLOURS, useLightEdit } from "./lightEdit";
import { saveObjectAsItemFile } from "./libraryFiles";
import { deleteSelected, duplicateSelected } from "./actions";

// Text input that commits on Enter or blur and reverts on Escape, so typing
// doesn't create an undo step per keystroke.
export function Field({
  label,
  value,
  onCommit,
  numeric,
  suffix,
  min,
  max,
}: {
  label: string;
  value: string | number;
  onCommit: (value: string) => void;
  numeric?: boolean;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    if (draft === String(value)) return;
    if (numeric) {
      const n = Number(draft.replace(",", "."));
      if (!Number.isFinite(n)) return setDraft(String(value));
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      setDraft(String(clamped));
      onCommit(String(clamped));
    } else {
      onCommit(draft);
    }
  };

  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-wrap">
        <input
          value={draft}
          inputMode={numeric ? "decimal" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(String(value));
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
    </label>
  );
}

function TemplateFields({ object }: { object: SceneObject }) {
  const apply = useOdaja((s) => s.apply);
  const template = object.template ? TEMPLATES_BY_ID.get(object.template) : undefined;
  if (!template) return null;
  return (
    <div className="field-group">
      <div className="group-title">{template.name}</div>
      <div className="grid-2">
        {template.params.map((p) => (
          <Field
            key={p.key}
            label={p.label}
            numeric
            suffix={p.key === "shelves" ? undefined : "cm"}
            min={p.min}
            max={p.max}
            value={object.params?.[p.key] ?? p.default}
            onCommit={(v) => apply(setTemplateParams(object.id, { [p.key]: Number(v) }))}
          />
        ))}
      </div>
    </div>
  );
}

function GizmoModeBar({ object }: { object: SceneObject }) {
  const viewMode = useOdaja((s) => s.viewMode);
  const gizmo = useOdaja((s) => s.objectGizmo);
  const setGizmo = useOdaja((s) => s.setObjectGizmo);
  const selectedLightIndex = useOdaja((s) => s.selectedLightIndex);
  if (viewMode !== "3d" || object.locked) return null;
  const lights = objectLights(object);
  const activeLight = lights[Math.min(selectedLightIndex, Math.max(0, lights.length - 1))];
  const hasLight = lights.length > 0;
  const hasAim = Boolean(activeLight && activeLight.type !== "point");
  return (
    <div className="field-group">
      <div className="group-title">3D handle</div>
      <div className="gizmo-modes">
        <button className={gizmo === "move" ? "active" : ""} onClick={() => setGizmo("move")} title="Drag horizontally across the floor">
          Move
        </button>
        <button className={gizmo === "lift" ? "active" : ""} onClick={() => setGizmo("lift")} title="Drag in 3D including height off floor">
          Lift
        </button>
        <button className={gizmo === "rotate" ? "active" : ""} onClick={() => setGizmo("rotate")} title="Rotate around vertical axis">
          Rotate
        </button>
        {hasLight && (
          <button className={gizmo === "light" ? "active" : ""} onClick={() => setGizmo("light")} title="Drag the light source position in 3D">
            Bulb
          </button>
        )}
        {hasAim && (
          <button className={gizmo === "target" ? "active" : ""} onClick={() => setGizmo("target")} title="Drag where the light aims in 3D">
            Aim
          </button>
        )}
      </div>
    </div>
  );
}

function LightFields({ object }: { object: SceneObject }) {
  const viewMode = useOdaja((s) => s.viewMode);
  const gizmo = useOdaja((s) => s.objectGizmo);
  const setGizmo = useOdaja((s) => s.setObjectGizmo);
  const setSelectedLightIndex = useOdaja((s) => s.setSelectedLightIndex);
  const lampsOn = useLamps((s) => s.on);
  const { lights, idx, light, written: currentWrittenList, writeList, set } = useLightEdit(object);
  if (!light) return null;

  const addSource = () => {
    const list = currentWrittenList();
    const base = light;
    const nextAt: [number, number, number] = [round(base.at[0] + 25), base.at[1], base.at[2]];
    const added: LightInput = {
      type: base.type,
      at: nextAt,
      lumens: base.lumens,
      kelvin: base.kelvin,
      ...(base.type === "spot" ? { angle: base.angle } : {}),
      ...(base.type === "area" ? { size: [...base.size] } : {}),
      ...(base.penumbra !== undefined ? { penumbra: base.penumbra } : {}),
    };
    list.push(added);
    writeList(list);
    setSelectedLightIndex(list.length - 1);
    if (viewMode === "3d" && !object.locked) setGizmo("light");
  };

  const removeActive = () => {
    if (lights.length <= 1) {
      writeList([]);
      if (gizmo === "light" || gizmo === "target") setGizmo("move");
      return;
    }
    const list = currentWrittenList().filter((_, i) => i !== idx);
    writeList(list);
    setSelectedLightIndex(Math.max(0, idx - 1));
  };

  const defaultPenumbra = Math.round(Math.min(0.92, Math.max(0.6, 0.6 + ((light.angle - 60) / 60) * 0.32)) * 100);
  const penumbraPct = light.penumbra !== undefined ? Math.round(light.penumbra * 100) : defaultPenumbra;
  const hasAim = light.type === "spot" || light.type === "area";

  return (
    <div className="field-group">
      <div className="group-title">
        {lights.length > 1 ? `Lights (${lights.length})` : "Light"}
      </div>
      <div className="kelvin-presets">
        {lights.map((_, i) => (
          <button
            key={i}
            className={i === idx ? "active" : ""}
            onClick={() => setSelectedLightIndex(i)}
            title={`Select light source #${i + 1}`}
          >
            #{i + 1}
          </button>
        ))}
        <button onClick={addSource} title="Add another light source to this fixture (e.g. multi-spot track or chandelier)">
          + Add
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={light.on} onChange={(e) => set({ on: e.target.checked })} />
        On
        {!lampsOn && light.on && <span className="muted"> (shows with the lamps on)</span>}
      </label>
      <label className="field">
        <span>Shines</span>
        <select
          value={light.type}
          onChange={(e) => {
            const nextType = e.target.value as Light["type"];
            set({ type: nextType });
            if (nextType === "point" && gizmo === "target") setGizmo("move");
          }}
        >
          <option value="point">All round (point)</option>
          <option value="spot">Directional spot</option>
          <option value="area">Area panel / ring</option>
        </select>
      </label>
      <div className="grid-2">
        <Field label="Brightness" numeric suffix="lm" min={0} max={20000} value={light.lumens} onCommit={(v) => set({ lumens: Number(v) })} />
        <Field label="Colour" numeric suffix="K" min={1500} max={10000} value={light.kelvin} onCommit={(v) => set({ kelvin: Number(v) })} />
      </div>
      <div className="kelvin-presets">
        {LAMP_COLOURS.map(({ kelvin: k, name }) => (
          <button key={k} className={light.kelvin === k ? "active" : ""} onClick={() => set({ kelvin: k })} title={`${name}, ${k} K`}>
            {k}K
          </button>
        ))}
      </div>
      <div className="grid-3">
        <Field label="Bulb X" numeric suffix="cm" value={light.at[0]} onCommit={(v) => set({ at: [round(Number(v)), light.at[1], light.at[2]] })} />
        <Field label="Bulb Y" numeric suffix="cm" value={light.at[1]} onCommit={(v) => set({ at: [light.at[0], round(Number(v)), light.at[2]] })} />
        <Field label="Bulb Z" numeric suffix="cm" value={light.at[2]} onCommit={(v) => set({ at: [light.at[0], light.at[1], round(Number(v))] })} />
      </div>
      {light.type === "spot" && (
        <div className="grid-2">
          <Field label="Beam" numeric suffix="°" min={10} max={160} value={light.angle} onCommit={(v) => set({ angle: Number(v) })} />
          <Field
            label="Soft edge"
            numeric
            suffix="%"
            min={0}
            max={100}
            value={penumbraPct}
            onCommit={(v) => set({ penumbra: Math.max(0, Math.min(1, Number(v) / 100)) })}
          />
        </div>
      )}
      {light.type === "area" && (
        <div className="grid-2">
          <Field label="Width" numeric suffix="cm" min={5} max={500} value={light.size[0]} onCommit={(v) => set({ size: [round(Number(v)), light.size[1]] })} />
          <Field label="Depth" numeric suffix="cm" min={5} max={500} value={light.size[1]} onCommit={(v) => set({ size: [light.size[0], round(Number(v))] })} />
        </div>
      )}
      {hasAim && (
        <div className="grid-3">
          <Field label="Aim X" numeric suffix="cm" value={light.target[0]} onCommit={(v) => set({ target: [round(Number(v)), light.target[1], light.target[2]] })} />
          <Field label="Aim Y" numeric suffix="cm" value={light.target[1]} onCommit={(v) => set({ target: [light.target[0], round(Number(v)), light.target[2]] })} />
          <Field label="Aim Z" numeric suffix="cm" value={light.target[2]} onCommit={(v) => set({ target: [light.target[0], light.target[1], round(Number(v))] })} />
        </div>
      )}
      {viewMode === "3d" && !object.locked && (
        <div className="actions">
          <button className={gizmo === "light" ? "active" : ""} onClick={() => setGizmo(gizmo === "light" ? "move" : "light")}>
            {gizmo === "light" ? "Done moving bulb" : "Move bulb in 3D"}
          </button>
          {hasAim && (
            <button className={gizmo === "target" ? "active" : ""} onClick={() => setGizmo(gizmo === "target" ? "move" : "target")}>
              {gizmo === "target" ? "Done aiming" : "Aim light in 3D"}
            </button>
          )}
        </div>
      )}
      {hasAim && (light.target[0] !== light.at[0] || light.target[1] !== light.at[1]) && (
        <button onClick={() => set({ target: undefined })} title="Point straight down below the emitter">
          Reset aim straight down
        </button>
      )}
      {(lights.length > 1 || !object.template) && (
        <button onClick={removeActive} title={lights.length > 1 ? `Remove light source #${idx + 1}` : "It stops being a lamp"}>
          {lights.length > 1 ? `Remove light #${idx + 1}` : "Remove light"}
        </button>
      )}
    </div>
  );
}

export function Inspector() {
  const object = useOdaja((s) => s.scene?.objects.find((o) => o.id === s.selectedId));
  const rooms = useOdaja((s) => s.shell?.rooms) ?? [];
  const apply = useOdaja((s) => s.apply);

  if (!object) {
    return (
      <section className="inspector muted">
        Click an object to select it, or add one with <strong>+ Add</strong>.
      </section>
    );
  }

  const set = (patch: Parameters<typeof setObjectProps>[1]) => apply(setObjectProps(object.id, patch));
  const num = (v: string) => round(Number(v));

  return (
    <section className="inspector">
      <Field label="Name" value={object.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} />
      <div className="muted id-line">{object.id}</div>

      <GizmoModeBar object={object} />
      <TemplateFields object={object} />
      <LightFields object={object} />

      <div className="field-group">
        <div className="group-title">Placement</div>
        <div className="grid-2">
          <Field label="X" numeric suffix="cm" value={object.position[0]} onCommit={(v) => set({ position: [num(v), object.position[1]] })} />
          <Field label="Y" numeric suffix="cm" value={object.position[1]} onCommit={(v) => set({ position: [object.position[0], num(v)] })} />
          <Field label="Off floor" numeric suffix="cm" value={object.elevation} onCommit={(v) => set({ elevation: num(v) || undefined })} />
          <Field
            label="Rotation"
            numeric
            suffix="°"
            value={object.rotation}
            onCommit={(v) => set({ rotation: ((((num(v) % 360) + 360) % 360) || undefined) })}
          />
        </div>
        <label className="field">
          <span>Room</span>
          <select value={object.room ?? ""} onChange={(e) => set({ room: e.target.value || undefined })}>
            <option value="">—</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {object.attachedTo && (
          <div className="attached">
            <span>
              Against <strong>{object.attachedTo}</strong> and moves with it
            </span>
            <button onClick={() => set({ attachedTo: undefined })}>Detach</button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={object.locked} onChange={(e) => set({ locked: e.target.checked || undefined })} />
          Locked (can't be moved or deleted)
        </label>
      </div>

      <label className="field">
        <span>Notes</span>
        <NotesField value={object.notes ?? ""} onCommit={(v) => set({ notes: v.trim() || undefined })} />
      </label>

      <div className="actions">
        <button onClick={duplicateSelected} title="Duplicate (⌘D)">
          Duplicate
        </button>
        <button onClick={() => useOdaja.getState().openDialog({ kind: "save", objectId: object.id })} title="Reuse this object in any scene or project">
          Save to library
        </button>
        <button
          onClick={() => {
            const doc = useOdaja.getState().sceneDoc?.objects?.find((o) => o.id === object.id);
            if (doc) saveObjectAsItemFile(doc, object.libraryItem?.category ?? "Other").catch((err) => useOdaja.getState().setNotice(`Couldn't save: ${(err as Error).message}`));
          }}
          title="Save this object as a file (.odaja-item), to send to someone or keep"
        >
          Save as file
        </button>
        {objectLights(object).length === 0 && (
          <button onClick={() => set({ light: {} })} title="Make it a lamp that lights the room when the lamps are on">
            Add light
          </button>
        )}
        {!object.model && (
          <button onClick={() => useOdaja.getState().editShape(object.id)} title="Change the shape part by part (or double-click the object)">
            Edit shape
          </button>
        )}
        <button className="danger" onClick={deleteSelected} disabled={object.locked} title="Delete (⌫)">
          Delete
        </button>
      </div>
    </section>
  );
}

function NotesField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      rows={2}
      value={draft}
      placeholder="Product link, price, reminder…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}
