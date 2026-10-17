import { useState, type FormEvent } from "react";
import { useOdaja } from "../store";
import { useChat } from "./chat/chatStore";
import { PLAN_ACCEPT, savePlanFile } from "./planImage";
import { LogoMark } from "./icons";
import { ThemeSwitch } from "./ThemeSwitch";
import { platform } from "../platform";

// On the website, starting something new replaces the home kept in the
// browser; it is set aside as the previous home, so this asks first.
function ConfirmReplace({ name, action, onCancel, onConfirm }: { name: string; action: string; onCancel: () => void; onConfirm?: () => void }) {
  return (
    <div className="confirm-replace" role="alertdialog" aria-label="Replace your home?">
      <p>
        This replaces <strong>{name}</strong> in this browser. It's kept as your previous home, so you can bring it back.
      </p>
      <div className="actions">
        <button type={onConfirm ? "button" : "submit"} className="primary" onClick={onConfirm} autoFocus>
          {action}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Small drawings for the three ways to start: a room, a plan sheet, a blank sheet.
const GLYPH = { width: 30, height: 30, viewBox: "0 0 30 30", fill: "none", stroke: "currentColor", strokeLinejoin: "round" as const, "aria-hidden": true };

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

function ProjectGlyph() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4 4h16v16H4Z" strokeWidth={1.8} />
      <path d="M12 4v7M12 14v6M12 12.5h8" strokeWidth={1.1} />
    </svg>
  );
}

const PLAN_DRAFT =
  "Here's the floor plan of my flat. Build it in Odaja: walls, doors, windows and rooms. Take the scale from a dimension printed on the plan; if there isn't one, ask me for a measurement.";

// Shortens /Users/name/… to ~/… for display.
function tildePath(dir: string) {
  return dir.replace(/^\/(Users|home)\/[^/]+/, "~");
}

function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString();
}

function NewProject() {
  const createProject = useOdaja((s) => s.createProject);
  const root = useOdaja((s) => s.projectsRoot);
  const [name, setName] = useState("");
  const [start, setStart] = useState<"room" | "plan" | "empty">("room");
  const [plan, setPlan] = useState<File | null>(null);
  const applyProject = useOdaja((s) => s.applyProject);
  const startDraft = useChat((s) => s.startDraft);
  const [width, setWidth] = useState("400");
  const [depth, setDepth] = useState("300");
  const [height, setHeight] = useState("260");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const web = platform.kind === "browser";
  const keptHome = useOdaja((s) => s.homes?.current);
  const [confirming, setConfirming] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const room = { width: Number(width), depth: Number(depth), height: Number(height) };
    if (start === "room" && !(room.width > 0 && room.depth > 0 && room.height > 0)) {
      setError("Enter the room's width, depth and ceiling height in cm.");
      return;
    }
    if (start === "plan" && !plan) {
      setError("Choose the floor plan: an image or a PDF.");
      return;
    }
    if (web && keptHome && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await createProject(name, start === "room" ? room : undefined);
      if (start === "plan" && plan) {
        const { underlay, blob } = await savePlanFile(plan);
        applyProject((doc) => ({ ...doc, underlay }));
        if (web) {
          // No chat on the website yet: start by setting the plan's scale, then trace.
          useOdaja.getState().setUnderlayPanel(true);
          useOdaja.getState().setUnderlayTool("calibrate");
        } else {
          // The plan becomes the background, and the chat gets it ready to send.
          startDraft(PLAN_DRAFT, [new File([blob], plan.name, { type: blob.type })]);
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>Start a new home</h2>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} placeholder="The flat on Partizanska" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="choice">
        <label className={start === "room" ? "active" : ""}>
          <input type="radio" checked={start === "room"} onChange={() => setStart("room")} />
          <span className="glyph">
            <RoomGlyph />
          </span>
          <strong>One rectangular room</strong>
          <span>Four walls at these inside measurements. Grow it from there.</span>
        </label>
        <label className={start === "plan" ? "active" : ""}>
          <input type="radio" checked={start === "plan"} onChange={() => setStart("plan")} />
          <span className="glyph">
            <PlanGlyph />
          </span>
          <strong>From a floor plan</strong>
          <span>{web ? "A photo or PDF of the plan. It sits underneath for you to trace the walls." : "A photo or PDF of the plan. It sits underneath, and the chat draws the walls over it."}</span>
        </label>
        <label className={start === "empty" ? "active" : ""}>
          <input type="radio" checked={start === "empty"} onChange={() => setStart("empty")} />
          <span className="glyph">
            <BlankGlyph />
          </span>
          <strong>A blank sheet</strong>
          <span>{web ? "No walls yet. Draw them yourself." : "No walls yet. Draw them yourself, or describe them to the chat."}</span>
        </label>
      </div>

      {start === "room" && (
        <div className="grid-3">
          <label className="field">
            <span>Width</span>
            <span className="input-wrap">
              <input inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
              <span className="suffix">cm</span>
            </span>
          </label>
          <label className="field">
            <span>Depth</span>
            <span className="input-wrap">
              <input inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} />
              <span className="suffix">cm</span>
            </span>
          </label>
          <label className="field">
            <span>Ceiling</span>
            <span className="input-wrap">
              <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
              <span className="suffix">cm</span>
            </span>
          </label>
        </div>
      )}

      {start === "plan" && (
        <label className="field">
          <span>Floor plan</span>
          <input type="file" accept={PLAN_ACCEPT} onChange={(e) => setPlan(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {error && <div className="inline-error">{error}</div>}
      {confirming && keptHome ? (
        <ConfirmReplace name={keptHome.name} action={busy ? "Setting up…" : "Replace and create"} onCancel={() => setConfirming(false)} />
      ) : (
        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Setting up…" : "Create project"}
        </button>
      )}
      <p className="hint">{web ? "Kept in this browser, saved as you work." : `Saved in ${tildePath(root)}/${name.trim() || "…"}`}</p>
    </form>
  );
}

function SampleGlyph() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4 4h16v16H4Z" strokeWidth={1.8} />
      <path d="M12 4v9M12 13h8" strokeWidth={1.1} />
      <path d="M6.5 7h3.5v2.5H6.5ZM14.5 15.5h3v2.5h-3Z" strokeWidth={1} fill="currentColor" fillOpacity={0.25} />
    </svg>
  );
}

function SampleRow({ onError }: { onError: (message: string) => void }) {
  const copied = useOdaja((s) => s.sampleCopied);
  const openSample = useOdaja((s) => s.openSample);
  const open = (fresh: boolean) => openSample(fresh).catch((err) => onError((err as Error).message));
  return (
    <div className="sample-row">
      <button className="sample-open" onClick={() => open(false)}>
        <span className="thumb">
          <SampleGlyph />
        </span>
        <strong>{copied ? "Your sample flat" : "Try the sample flat"}</strong>
        <span className="muted">{copied ? "Pick up where you left off." : "A furnished two-room flat to explore. Change anything."}</span>
      </button>
      {copied && (
        <button
          className="link"
          onClick={() => window.confirm("Start the sample flat over? Your changes to it will be replaced with a fresh copy.") && open(true)}
          title="Replace your copy with a fresh one"
        >
          Start over
        </button>
      )}
    </div>
  );
}

function ProjectList() {
  const all = useOdaja((s) => s.projects);
  const sampleDir = useOdaja((s) => s.sampleDir);
  // The sample's copy has its own row below.
  const projects = all.filter((p) => p.dir !== sampleDir);
  const openProject = useOdaja((s) => s.openProject);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = (dir: string) => {
    setError(null);
    openProject(dir).catch((err) => setError((err as Error).message));
  };

  return (
    <div className="card">
      <h2>Carry on</h2>
      {projects.length === 0 ? (
        <p className="muted empty-hint">Nothing here yet. Your homes will appear here.</p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.dir}>
              <button onClick={() => open(p.dir)}>
                <span className="thumb">
                  <ProjectGlyph />
                </span>
                <strong>{p.name}</strong>
                <span className="muted">{tildePath(p.dir)}</span>
                <span className="muted when">{timeAgo(p.modified)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SampleRow onError={setError} />
      <form
        className="open-path"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) open(path.trim());
        }}
      >
        <input value={path} placeholder="Or type a folder path, e.g. ~/Desktop/flat" onChange={(e) => setPath(e.target.value)} />
        <button type="submit" disabled={!path.trim()}>
          Open
        </button>
      </form>
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}

// The website's "Carry on": the home kept in this browser, the sample, and
// the previous home (the one last replaced), which can be brought back.
function BrowserHomes() {
  const homes = useOdaja((s) => s.homes);
  const openProject = useOdaja((s) => s.openProject);
  const openSample = useOdaja((s) => s.openSample);
  const [confirmSample, setConfirmSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = homes?.current ?? null;
  const previous = homes?.previous ?? null;

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Carry on</h2>
      {kept ? (
        <ul className="project-list">
          <li>
            <button onClick={() => run(() => openProject("current"))} disabled={busy}>
              <span className="thumb">
                <ProjectGlyph />
              </span>
              <strong>{kept.name}</strong>
              <span className="muted">Kept in this browser</span>
              <span className="muted when">{timeAgo(kept.modified)}</span>
            </button>
          </li>
        </ul>
      ) : (
        <p className="muted empty-hint">Nothing here yet. Start a new home, or look around the sample flat first.</p>
      )}
      {confirmSample && kept ? (
        <ConfirmReplace name={kept.name} action="Open the sample" onCancel={() => setConfirmSample(false)} onConfirm={() => run(() => openSample(false))} />
      ) : (
        <div className="sample-row">
          <button className="sample-open" disabled={busy} onClick={() => (kept ? setConfirmSample(true) : run(() => openSample(false)))}>
            <span className="thumb">
              <SampleGlyph />
            </span>
            <strong>Try the sample flat</strong>
            <span className="muted">A furnished two-room flat to explore. Change anything.</span>
          </button>
        </div>
      )}
      {previous && (
        <div className="previous-home">
          <span>
            Previous home: <strong>{previous.name}</strong>
          </span>
          <button className="link" disabled={busy} onClick={() => run(() => openProject("previous"))} title="Swap it back in; the current home becomes the previous one">
            Bring it back
          </button>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}

export function StartScreen() {
  return (
    <div className="start">
      <div className="start-corner">
        <ThemeSwitch />
      </div>
      <header>
        <div className="start-mark">
          <LogoMark size={44} />
          <span className="logo big">Odaja</span>
        </div>
        <p>
          A drafting table for your home. Measure it, furnish it, walk through it, <em>and talk it over</em> before anything is built.
        </p>
      </header>
      <div className="start-grid">
        <NewProject />
        {platform.kind === "browser" ? <BrowserHomes /> : <ProjectList />}
      </div>
    </div>
  );
}
