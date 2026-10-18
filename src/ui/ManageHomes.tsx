// The companion's list of homes (the home menu's "Manage homes…"): open one,
// move one in Documents/Odaja to the Trash (restorable from there), or remove
// a folder opened from elsewhere from the list. The open home stays put.
import { useEffect, useState } from "react";
import { platform, type ProjectSummary } from "../platform";
import { useOdaja } from "../store";
import { tildePath } from "./NewHome";

function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : new Date(ms).toLocaleDateString();
}

function HomeRow({ home, open, onError }: { home: ProjectSummary; open: boolean; onError: (message: string | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const trash = home.inProjectsFolder;

  const remove = async () => {
    setBusy(true);
    onError(null);
    try {
      await (trash ? platform.trashProject!(home.dir) : platform.forgetProject!(home.dir));
      await useOdaja.getState().refreshProjects();
      useOdaja.getState().setNotice(trash ? `Moved “${home.name}” to the Trash.` : `Removed “${home.name}” from the list.`);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
      setConfirming(false);
    }
  };

  const openIt = async () => {
    onError(null);
    try {
      await useOdaja.getState().openProject(home.dir);
      useOdaja.getState().openDialog(null);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <li className={confirming ? "confirming" : ""}>
      <div className="home-info">
        <strong>{home.name}</strong>
        <span className="muted" title={home.dir}>
          {tildePath(home.dir)} · {timeAgo(home.modified)}
        </span>
      </div>
      {open ? (
        <span className="muted home-open">Open now</span>
      ) : confirming ? (
        <div className="home-confirm">
          <span>{trash ? "Move it to the Trash? You can restore it from there." : "Remove it from this list? The folder stays where it is."}</span>
          <div className="actions">
            <button className="danger" onClick={remove} disabled={busy} autoFocus>
              {busy ? "Moving…" : trash ? "Move to Trash" : "Remove"}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button onClick={openIt}>Open</button>
          <button onClick={() => setConfirming(true)} title={trash ? "Move this home's folder to the Trash" : "Remove from the list (the folder stays)"}>
            {trash ? "Delete…" : "Remove…"}
          </button>
        </div>
      )}
    </li>
  );
}

export function ManageHomesDialog() {
  const projects = useOdaja((s) => s.projects);
  const current = useOdaja((s) => s.projectDir);
  const root = useOdaja((s) => s.projectsRoot);
  const [error, setError] = useState<string | null>(null);
  const close = () => useOdaja.getState().openDialog(null);
  useEffect(() => {
    useOdaja.getState().refreshProjects().catch(() => {});
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog manage-homes" role="dialog" aria-label="Your homes">
        <h2>Your homes</h2>
        <p className="muted">Homes are folders in {tildePath(root)}. Deleting one moves it to the Trash, so you can still restore it.</p>
        <ul className="homes-list">
          {projects.map((p) => (
            <HomeRow key={p.dir} home={p} open={p.dir === current} onError={setError} />
          ))}
        </ul>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-buttons">
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
