import { useState, type FormEvent } from "react";
import { useOdaja } from "../store";
import { useChat } from "./chat/chatStore";
import { PLAN_ACCEPT, savePlanFile } from "./planImage";

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
    setBusy(true);
    try {
      await createProject(name, start === "room" ? room : undefined);
      if (start === "plan" && plan) {
        // The plan becomes the background, and the chat gets it ready to send.
        const { underlay, blob } = await savePlanFile(plan);
        applyProject((doc) => ({ ...doc, underlay }));
        startDraft(PLAN_DRAFT, [new File([blob], plan.name, { type: blob.type })]);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>New project</h2>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} placeholder="My flat" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="choice">
        <label className={start === "room" ? "active" : ""}>
          <input type="radio" checked={start === "room"} onChange={() => setStart("room")} />
          <strong>One rectangular room</strong>
          <span>Four walls with these inside measurements. Add more walls later.</span>
        </label>
        <label className={start === "plan" ? "active" : ""}>
          <input type="radio" checked={start === "plan"} onChange={() => setStart("plan")} />
          <strong>From a floor plan</strong>
          <span>An image or PDF of the plan. It goes in the background and the chat builds the walls from it.</span>
        </label>
        <label className={start === "empty" ? "active" : ""}>
          <input type="radio" checked={start === "empty"} onChange={() => setStart("empty")} />
          <strong>Empty</strong>
          <span>No walls yet. Draw them yourself or ask the chat.</span>
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
      <button className="primary" type="submit" disabled={busy || !name.trim()}>
        Create project
      </button>
      <p className="hint">Saved in {tildePath(root)}/{name.trim() || "…"}</p>
    </form>
  );
}

function ProjectList() {
  const projects = useOdaja((s) => s.projects);
  const openProject = useOdaja((s) => s.openProject);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = (dir: string) => {
    setError(null);
    openProject(dir).catch((err) => setError((err as Error).message));
  };

  return (
    <div className="card">
      <h2>Open a project</h2>
      {projects.length === 0 ? (
        <p className="muted">No projects yet.</p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.dir}>
              <button onClick={() => open(p.dir)}>
                <strong>{p.name}</strong>
                <span className="muted">{tildePath(p.dir)}</span>
                <span className="muted when">{timeAgo(p.modified)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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

export function StartScreen() {
  return (
    <div className="start">
      <header>
        <span className="logo big">Odaja</span>
        <p className="muted">Plan your home in 3D, together with your AI agents.</p>
      </header>
      <div className="start-grid">
        <NewProject />
        <ProjectList />
      </div>
    </div>
  );
}
