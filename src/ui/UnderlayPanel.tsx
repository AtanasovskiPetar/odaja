// The floor plan background: add an image or PDF, set its scale from one
// known measurement, move and turn it into place, fade or hide it. It only
// helps you check and trace; it never changes the design.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Vec } from "../model/geometry";
import { calibrate } from "../model/underlay";
import { useOdaja, type PlanView } from "../store";
import { IconClose } from "./icons";
import { PLAN_ACCEPT, savePlanFile } from "./planImage";

function screenToPlan(view: PlanView, sx: number, sy: number): Vec {
  return [((sx - view.width / 2) / view.zoom + view.centerX) * 100, ((sy - view.height / 2) / view.zoom + view.centerZ) * 100];
}

function planToScreen(view: PlanView, [x, y]: Vec): Vec {
  return [(x / 100 - view.centerX) * view.zoom + view.width / 2, (y / 100 - view.centerZ) * view.zoom + view.height / 2];
}

export function UnderlayPanel() {
  const open = useOdaja((s) => s.underlayPanel && s.viewMode === "plan");
  const underlay = useOdaja((s) => s.projectDoc?.underlay);
  const tool = useOdaja((s) => s.underlayTool);
  const setTool = useOdaja((s) => s.setUnderlayTool);
  const setPanel = useOdaja((s) => s.setUnderlayPanel);
  const applyProject = useOdaja((s) => s.applyProject);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const set = (patch: Partial<NonNullable<typeof underlay>>) => underlay && applyProject((doc) => ({ ...doc, underlay: { ...doc.underlay!, ...patch } }));

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { underlay: next } = await savePlanFile(file);
      applyProject((doc) => ({ ...doc, underlay: next }));
      setTool("calibrate");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="underlay-panel">
      <div className="underlay-head">
        <strong>Floor plan background</strong>
        <button className="icon" onClick={() => setPanel(false)} title="Close">
          <IconClose size={15} />
        </button>
      </div>
      <input ref={fileInput} type="file" accept={PLAN_ACCEPT} hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      {!underlay ? (
        <>
          <p className="hint">Add a photo, scan or PDF of your floor plan. Then set its scale from one measurement you know, and trace the walls over it.</p>
          <button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? "Loading…" : "Add floor plan…"}
          </button>
        </>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={underlay.visible ?? true} onChange={(e) => set({ visible: e.target.checked })} />
            Show
          </label>
          <label className="field">
            <span>Opacity</span>
            <input type="range" min={0.1} max={1} step={0.05} value={underlay.opacity ?? 0.5} onChange={(e) => set({ opacity: Number(e.target.value) })} />
          </label>
          <div className="actions">
            <button className={tool === "calibrate" ? "active" : ""} onClick={() => setTool(tool === "calibrate" ? null : "calibrate")} title="Click both ends of something you know the length of">
              Set scale
            </button>
            <button className={tool === "move" ? "active" : ""} onClick={() => setTool(tool === "move" ? null : "move")} title="Drag the plan into place">
              Move
            </button>
          </div>
          <div className="actions">
            <button onClick={() => set({ rotation: (((underlay.rotation ?? 0) - 90) % 360 + 360) % 360 })}>↺ 90°</button>
            <button onClick={() => set({ rotation: (((underlay.rotation ?? 0) - 0.5) % 360 + 360) % 360 })} title="Straighten a slightly tilted scan">
              ↺ ½°
            </button>
            <button onClick={() => set({ rotation: ((underlay.rotation ?? 0) + 0.5) % 360 })}>↻ ½°</button>
            <button onClick={() => set({ rotation: ((underlay.rotation ?? 0) + 90) % 360 })}>↻ 90°</button>
          </div>
          <p className="hint">1 px = {underlay.scale.toFixed(3)} cm · turned {(underlay.rotation ?? 0).toFixed(1)}°</p>
          <div className="actions">
            <button onClick={() => fileInput.current?.click()} disabled={busy}>
              Replace…
            </button>
            <button className="danger" onClick={() => applyProject((doc) => ({ ...doc, underlay: undefined }))}>
              Remove
            </button>
          </div>
        </>
      )}
      {error && <div className="inline-error">{error}</div>}
      {tool === "calibrate" && <p className="hint strong">Click the two ends of a wall or dimension line whose length you know.</p>}
      {tool === "move" && <p className="hint strong">Drag on the plan to move the background.</p>}
    </div>
  );
}

// The interactive layer for setting the scale (two clicks + a length) and
// moving the background (drag).
export function UnderlayToolLayer() {
  const tool = useOdaja((s) => (s.viewMode === "plan" ? s.underlayTool : null));
  const view = useOdaja((s) => s.planView);
  const underlay = useOdaja((s) => s.projectDoc?.underlay);
  const applyProject = useOdaja((s) => s.applyProject);
  const setTool = useOdaja((s) => s.setUnderlayTool);
  const [points, setPoints] = useState<Vec[]>([]);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [length, setLength] = useState("");
  const drag = useRef<{ start: Vec; center: [number, number] } | null>(null);
  const [offset, setOffset] = useState<Vec | null>(null);
  if (!tool || !view || !underlay) return null;

  const local = (e: ReactPointerEvent): Vec => {
    const r = e.currentTarget.getBoundingClientRect();
    return screenToPlan(view, e.clientX - r.left, e.clientY - r.top);
  };

  const finishCalibration = () => {
    const cm = Number(length.replace(",", "."));
    if (points.length === 2 && cm > 0) applyProject((doc) => ({ ...doc, underlay: calibrate(doc.underlay!, points[0], points[1], cm) }));
    setPoints([]);
    setLength("");
    setTool(null);
  };

  const line = points.length >= 1 ? [points[0], points[1] ?? cursor].filter(Boolean) as Vec[] : [];
  const measured = line.length === 2 ? Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) : 0;

  return (
    <div
      className={`underlay-tool tool-${tool}`}
      onPointerDown={(e) => {
        const p = local(e);
        if (tool === "move") {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { start: p, center: [...underlay.center] as [number, number] };
        } else if (points.length < 2) {
          setPoints([...points, p]);
        }
      }}
      onPointerMove={(e) => {
        const p = local(e);
        setCursor(p);
        if (tool === "move" && drag.current) setOffset([p[0] - drag.current.start[0], p[1] - drag.current.start[1]]);
      }}
      onPointerUp={() => {
        if (tool === "move" && drag.current && offset) {
          const c = drag.current.center;
          applyProject((doc) => ({ ...doc, underlay: { ...doc.underlay!, center: [Math.round(c[0] + offset[0]), Math.round(c[1] + offset[1])] } }));
        }
        drag.current = null;
        setOffset(null);
      }}
    >
      {tool === "calibrate" && line.length > 0 && (
        <svg className="underlay-line" width={view.width} height={view.height}>
          {line.map((p, i) => {
            const [x, y] = planToScreen(view, p);
            return <circle key={i} cx={x} cy={y} r={5} />;
          })}
          {line.length === 2 && (
            <line x1={planToScreen(view, line[0])[0]} y1={planToScreen(view, line[0])[1]} x2={planToScreen(view, line[1])[0]} y2={planToScreen(view, line[1])[1]} />
          )}
        </svg>
      )}
      {tool === "move" && offset && (
        <div className="move-readout">
          Moving {Math.round(offset[0])}, {Math.round(offset[1])} cm
        </div>
      )}
      {tool === "calibrate" && points.length === 2 && (
        <form
          className="calibrate-form"
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            finishCalibration();
          }}
        >
          <span>Real length of this line (now {Math.round(measured)} cm):</span>
          <input autoFocus value={length} onChange={(e) => setLength(e.target.value)} placeholder="e.g. 420" inputMode="decimal" />
          <span>cm</span>
          <button type="submit" disabled={!(Number(length.replace(",", ".")) > 0)}>
            Set scale
          </button>
          <button type="button" onClick={() => setPoints([])}>
            Redo
          </button>
        </form>
      )}
    </div>
  );
}
