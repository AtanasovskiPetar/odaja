import { useEffect, useState } from "react";
import { TEMPLATES_BY_ID } from "../model/library";
import { detachTemplate, setObjectProps, setTemplateParams } from "../model/operations";
import type { Part, PartInput, SceneObject } from "../model/schema";
import { round } from "../model/units";
import { useOdaja } from "../store";
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

      <TemplateFields object={object} />

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
            Against <strong>{object.attachedTo}</strong>, moves with it
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
        {object.template && (
          <button
            onClick={() => apply(detachTemplate(object.id, object.parts.map(compactPart)))}
            title="Keep the shape but store it as individual parts you (or an agent) can edit"
          >
            Edit as parts
          </button>
        )}
        <button className="danger" onClick={deleteSelected} disabled={object.locked} title="Delete (⌫)">
          Delete
        </button>
      </div>
    </section>
  );
}

// Leave out default values so detached parts read like hand-written ones.
function compactPart(part: Part): PartInput {
  const { rotation, at, ...rest } = part;
  const out: PartInput = { ...rest };
  if (rotation) out.rotation = rotation;
  if (at.some((v) => v !== 0)) out.at = at;
  if (out.shape === "box" && out.radius === 0) delete out.radius;
  if (!out.name) delete out.name;
  return out;
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
