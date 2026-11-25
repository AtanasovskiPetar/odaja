// Manage all homes (Cloud projects or local companion folders):
// search, sort, create, import .odaja, open, rename, or delete.
import { useEffect, useMemo, useState } from "react";
import { platform, type ProjectSummary } from "../platform";
import { useOdaja } from "../store";
import { openHomeFromPicker } from "./HomeMenu";
import { tildePath } from "./NewHome";
import { Button } from "./primitives/Button";
import { RenameInput } from "./ScenesSection";

function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ms).toLocaleDateString();
}

function HomeCard({
  home,
  open,
  onError,
}: {
  home: ProjectSummary;
  open: boolean;
  onError: (message: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const trash = home.inProjectsFolder;

  const remove = async () => {
    setBusy(true);
    onError(null);
    try {
      await (trash ? platform.trashProject!(home.dir) : platform.forgetProject!(home.dir));
      await useOdaja.getState().refreshProjects();
      useOdaja.getState().setNotice(
        trash ? `Moved “${home.name}” to the Trash.` : `Removed “${home.name}” from the list.`,
      );
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
      setConfirming(false);
    }
  };

  const openIt = async () => {
    if (open) {
      useOdaja.getState().openDialog(null);
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await useOdaja.getState().openProject(home.dir);
      useOdaja.getState().openDialog(null);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  };

  const rename = async (next: string | null) => {
    setRenaming(false);
    if (!next || next === home.name) return;
    onError(null);
    try {
      useOdaja.getState().applyProject((doc) => ({ ...doc, name: next }));
      await useOdaja.getState().refreshProjects();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  // Only the open home can be renamed (its name is in its project.json).
  const canRename = open;

  return (
    <li
      className={`list-none rounded-[10px] border p-3 transition-colors ${
        open ? "border-accent-line bg-accent-wash/60" : "border-line bg-sheet hover:border-line-strong"
      }`}
    >
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-ink">
            {trash
              ? `Move “${home.name}” to the Trash? You can restore it from there.`
              : `Remove “${home.name}” from this list? The folder stays on disk.`}
          </p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" className="bg-danger-wash" onClick={remove} disabled={busy} autoFocus>
              {busy ? "Deleting…" : trash ? "Move to Trash" : "Remove"}
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <RenameInput initial={home.name} onDone={rename} />
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={openIt}
                  disabled={busy}
                  className="border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-ink hover:text-accent cursor-pointer truncate"
                >
                  {home.name}
                </button>
                {open && (
                  <span className="shrink-0 rounded-full bg-accent-wash border border-accent-line px-2 py-0.5 text-[10px] font-semibold text-accent-ink">
                    Open
                  </span>
                )}
              </div>
            )}
            <div className="mt-0.5 text-[11px] text-muted truncate" title={tildePath(home.dir)}>
              {`${tildePath(home.dir)} · ${timeAgo(home.modified)}`}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!open && (
              <Button size="sm" variant="primary" onClick={openIt} disabled={busy}>
                {busy ? "Opening…" : "Open"}
              </Button>
            )}
            {canRename && !renaming && (
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
                Rename
              </Button>
            )}
            {!open && (
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {trash ? "Delete" : "Remove"}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function ManageHomesDialog() {
  const projects = useOdaja((s) => s.projects);
  const current = useOdaja((s) => s.projectDir);
  const root = useOdaja((s) => s.projectsRoot);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [error, setError] = useState<string | null>(null);
  const close = () => useOdaja.getState().openDialog(null);

  useEffect(() => {
    useOdaja.getState().refreshProjects().catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.dir.toLowerCase().includes(q)) : [...projects];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => b.modified - a.modified);
    return list;
  }, [projects, query, sort]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label="Your homes"
        className="w-full max-w-[560px] max-h-[82vh] flex flex-col rounded-[14px] bg-card shadow-dialog border border-line text-ink overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line">
          <div>
            <h2 className="font-serif text-2xl font-normal leading-none m-0 text-ink">Your homes</h2>
            <p className="mt-1.5 mb-0 text-xs text-muted">
              {`Stored in ${tildePath(root)}. Deleting moves a home to the Trash.`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              onClick={() => {
                close();
                openHomeFromPicker();
              }}
            >
              Import .odaja
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => useOdaja.getState().openDialog({ kind: "new-home" })}
            >
              + New home
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-sheet/60">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search homes…"
            aria-label="Search homes"
            autoFocus
            className="flex-1 h-8 rounded-[7px] border border-line-strong bg-card px-2.5 text-xs text-ink placeholder:text-faint outline-none focus:border-accent"
          />
          <div className="flex items-center gap-0.5 rounded-[7px] bg-well p-0.5">
            {(["recent", "name"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSort(mode)}
                className={`h-7 px-2.5 rounded-[5px] border-0 text-[11px] font-medium cursor-pointer transition-colors ${
                  sort === mode ? "bg-card text-ink shadow-card" : "bg-transparent text-muted hover:text-ink"
                }`}
              >
                {mode === "recent" ? "Recent" : "Name"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {visible.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted">
              {query ? "No homes match your search." : "No homes yet — create one or import a .odaja file."}
            </div>
          ) : (
            <ul className="m-0 p-0 flex flex-col gap-2">
              {visible.map((p) => (
                <HomeCard key={p.dir} home={p} open={p.dir === current} onError={setError} />
              ))}
            </ul>
          )}
          {error && (
            <div className="mt-3 rounded-[6px] bg-danger-wash px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-line bg-sheet/60">
          <span className="text-[11px] text-muted">
            {projects.length} {projects.length === 1 ? "home" : "homes"}
          </span>
          <Button size="sm" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
