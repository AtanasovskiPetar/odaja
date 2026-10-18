// Starting a home: the sample flat, one rectangular room, from a floor plan,
// or a blank sheet. The same form is the welcome on a first visit (no home
// yet) and the "New home…" dialog in the home menu. On the website a new home
// replaces the one in the browser, so the dialog asks first.
import { useState, type FormEvent } from "react";
import { readSettings } from "../agent/chat/settings";
import { platform } from "../platform";
import { useOdaja } from "../store";
import { useChat } from "./chat/chatStore";
import { rememberedChatsChoice, saveHome } from "./homeFileActions";
import { PLAN_ACCEPT, savePlanFile } from "./planImage";

// The website keeps one home: another replaces it. When it has changes that
// aren't in a file, they'd be lost, so this asks: save first, go ahead, or not.
export function ConfirmReplace({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const name = useOdaja((s) => s.project?.name ?? "Your home");
  const [saving, setSaving] = useState(false);
  const saveFirst = async () => {
    setSaving(true);
    const saved = await saveHome({ includeChats: await rememberedChatsChoice() });
    setSaving(false);
    if (saved) onConfirm();
  };
  return (
    <div className="confirm-replace" role="alertdialog" aria-label="Save your home first?">
      <p>
        <strong>{name}</strong> has changes that aren't saved to a file. They'll be lost when it's replaced.
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={saveFirst} disabled={saving || busy} autoFocus>
          {saving ? "Saving…" : "Save first"}
        </button>
        <button type="button" onClick={onConfirm} disabled={saving || busy}>
          {busy ? "Setting up…" : "Don’t save"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving || busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// In the "New home…" dialog on the website: what happens to the open home.
function ReplacesNote() {
  const name = useOdaja((s) => s.project?.name ?? "your home");
  const unsaved = useOdaja((s) => s.unsavedToFile);
  return (
    <p className={`replaces-note ${unsaved ? "warn" : ""}`}>
      This replaces <strong>{name}</strong> in this browser.{" "}
      {unsaved ? "It has changes that aren't saved to a file yet." : "It has no unsaved changes, so nothing is lost."}
    </p>
  );
}

// Small drawings for the ways to start.
const GLYPH = { width: 30, height: 30, viewBox: "0 0 30 30", fill: "none", stroke: "currentColor", strokeLinejoin: "round" as const, "aria-hidden": true };

function SampleGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M5 5h20v20H5Z" strokeWidth={2.2} />
      <path d="M15 5v11M15 16h10" strokeWidth={1.2} />
      <path d="M8 8.5h4.5v3H8ZM18 19h4v3h-4Z" strokeWidth={1} fill="currentColor" fillOpacity={0.25} />
    </svg>
  );
}

function RoomGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M5 6h20v18H5Z" strokeWidth={2.4} />
      <path d="M9 3.5h12M3 10v10" strokeWidth={0.8} strokeDasharray="1.5 1.5" />
    </svg>
  );
}

function PlanGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M6 3.5h13l5 5v18H6Z" strokeWidth={1.2} />
      <path d="M19 3.5v5h5" strokeWidth={1.2} />
      <path d="M9.5 12h11v10h-11ZM15 12v4M15 19v3M15 17h5.5" strokeWidth={1.6} />
    </svg>
  );
}

function BlankGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M6 5h18v20H6Z" strokeWidth={1.2} strokeDasharray="2.5 2" />
      <path d="M15 11v8M11 15h8" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

export const PLAN_DRAFT =
  "Here's the floor plan of my flat. Build it in Odaja: walls, doors, windows and rooms. Take the scale from a dimension printed on the plan; if there isn't one, ask me for a measurement.";

// Shortens /Users/name/… to ~/… for display.
export function tildePath(dir: string) {
  return dir.replace(/^\/(Users|home)\/[^/]+/, "~");
}

type Start = "sample" | "room" | "plan" | "empty";

export function NewHomeForm({ initial, onDone, onCancel }: { initial: Start; onDone?: () => void; onCancel?: () => void }) {
  const createProject = useOdaja((s) => s.createProject);
  const openSample = useOdaja((s) => s.openSample);
  const applyProject = useOdaja((s) => s.applyProject);
  const root = useOdaja((s) => s.projectsRoot);
  const sampleCopied = useOdaja((s) => s.sampleCopied);
  // On the website a new home replaces the open one: ask first if that loses changes.
  const replacing = useOdaja((s) => platform.kind === "browser" && s.status === "project");
  const losesChanges = useOdaja((s) => replacing && s.unsavedToFile);
  const startDraft = useChat((s) => s.startDraft);
  const [start, setStart] = useState<Start>(initial);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<File | null>(null);
  const [width, setWidth] = useState("400");
  const [depth, setDepth] = useState("300");
  const [height, setHeight] = useState("260");
  const [freshSample, setFreshSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const web = platform.kind === "browser";

  const check = (): string | null => {
    if (start === "sample") return null;
    if (!name.trim()) return "Give the home a name.";
    if (start === "room" && !(Number(width) > 0 && Number(depth) > 0 && Number(height) > 0)) return "Enter the room's width, depth and ceiling height in cm.";
    if (start === "plan" && !plan) return "Choose the floor plan: an image or a PDF.";
    return null;
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (start === "sample") {
        await openSample(freshSample);
      } else {
        const room = { width: Number(width), depth: Number(depth), height: Number(height) };
        await createProject(name, start === "room" ? room : undefined);
        if (start === "plan" && plan) {
          const { underlay, blob } = await savePlanFile(plan);
          applyProject((doc) => ({ ...doc, underlay }));
          if (Object.keys((await readSettings()).keys).length > 0) {
            // The plan becomes the background, and the chat gets it ready to send.
            startDraft(PLAN_DRAFT, [new File([blob], plan.name, { type: blob.type })]);
          } else {
            // No AI connected: start by setting the plan's scale, then trace.
            useOdaja.getState().setUnderlayPanel(true);
            useOdaja.getState().setUnderlayTool("calibrate");
          }
        }
      }
      await useOdaja.getState().refreshProjects();
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setConfirming(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = check();
    if (problem) return setError(problem);
    if (losesChanges) setConfirming(true);
    else create();
  };

  const option = (value: Start, glyph: React.ReactNode, title: string, text: string) => (
    <label className={start === value ? "active" : ""}>
      <input type="radio" name="start" checked={start === value} onChange={() => (setStart(value), setError(null))} />
      <span className="glyph">{glyph}</span>
      <strong>{title}</strong>
      <span>{text}</span>
    </label>
  );
  const sampleCopy = !web && sampleCopied;
  const action = start === "sample" ? (freshSample ? "Start the sample over" : "Open the sample flat") : "Create home";

  return (
    <form className="new-home" onSubmit={submit}>
      {replacing && <ReplacesNote />}
      <div className="choice">
        {option("sample", <SampleGlyph />, sampleCopy ? "Your sample flat" : "The sample flat", "A furnished two-room flat to look around. Change anything.")}
        {option("room", <RoomGlyph />, "One rectangular room", "Four walls at the inside measurements you give. Grow it from there.")}
        {option("plan", <PlanGlyph />, "From a floor plan", "A photo or PDF of the plan. It sits underneath, for you or the chat to draw the walls over it.")}
        {option("empty", <BlankGlyph />, "A blank sheet", "No walls yet. Draw them yourself, or describe them to the chat.")}
      </div>

      {start !== "sample" && (
        <label className="field">
          <span>Name</span>
          <input value={name} placeholder="The flat on Partizanska" onChange={(e) => setName(e.target.value)} />
        </label>
      )}

      {start === "room" && (
        <div className="grid-3">
          {(
            [
              ["Width", width, setWidth],
              ["Depth", depth, setDepth],
              ["Ceiling", height, setHeight],
            ] as const
          ).map(([label, value, change]) => (
            <label className="field" key={label}>
              <span>{label}</span>
              <span className="input-wrap">
                <input inputMode="decimal" value={value} onChange={(e) => change(e.target.value)} />
                <span className="suffix">cm</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {start === "plan" && (
        <label className="field">
          <span>Floor plan</span>
          <input type="file" accept={PLAN_ACCEPT} onChange={(e) => setPlan(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {start === "sample" && sampleCopy && (
        <label className="check">
          <input type="checkbox" checked={freshSample} onChange={(e) => setFreshSample(e.target.checked)} />
          Start over with a fresh copy (your changes to it are replaced)
        </label>
      )}

      {error && <div className="inline-error">{error}</div>}
      {confirming ? (
        <ConfirmReplace busy={busy} onCancel={() => setConfirming(false)} onConfirm={create} />
      ) : (
        <div className="dialog-buttons">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Setting up…" : action}
          </button>
        </div>
      )}
      {start !== "sample" && (
        <p className="hint">{web ? "Kept in this browser and saved as you work (a private window forgets it when closed). Save it to a file to keep a copy." : `Saved in ${tildePath(root)}/${name.trim() || "…"}`}</p>
      )}
    </form>
  );
}

export function NewHomeDialog() {
  const close = () => useOdaja.getState().openDialog(null);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog new-home-dialog" role="dialog" aria-label="New home">
        <h2>New home</h2>
        <NewHomeForm initial="room" onDone={close} onCancel={close} />
      </div>
    </div>
  );
}
