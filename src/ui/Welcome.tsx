// The welcome, shown when there's no home yet (a first visit to the website,
// or the companion with no homes opened before). After that Odaja always
// opens straight into the home; new homes, files and other folders are in the
// home menu (HomeMenu.tsx).
import { useEffect, useState } from "react";
import { storageNotice, type StorageNotice } from "../browser/keeping";
import { platform } from "../platform";
import { useOdaja } from "../store";
import { openHome, pickHomeFile } from "./homeFileActions";
import { LogoMark } from "./icons";
import { NewHomeForm } from "./NewHome";
import { ThemeSwitch } from "./ThemeSwitch";

// The companion: open a home's folder anywhere on disk by its path (the home
// menu's "Open a folder…").
export function OpenFolderDialog() {
  const close = () => useOdaja.getState().openDialog(null);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-label="Open a folder">
        <h2>Open a folder</h2>
        <p className="muted">A home's folder anywhere on this computer: the one with project.json in it.</p>
        <OpenFolderForm onDone={close} />
        <div className="dialog-buttons">
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// The companion: open a project folder anywhere on disk by its path.
export function OpenFolderForm({ onDone }: { onDone?: () => void }) {
  const openProject = useOdaja((s) => s.openProject);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <form
        className="open-path"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          openProject(path.trim()).then(
            () => onDone?.(),
            (err) => setError((err as Error).message),
          );
        }}
      >
        <input value={path} placeholder="A folder path, e.g. ~/Desktop/flat" onChange={(e) => setPath(e.target.value)} autoFocus={!!onDone} />
        <button type="submit" disabled={!path.trim()}>
          Open
        </button>
      </form>
      {error && <div className="inline-error">{error}</div>}
    </>
  );
}

const SAFARI_NOTE_KEY = "odaja:safari-note-dismissed";

// Where the browser may not keep the home: a private window, or Safari
// (which clears a site's data after 7 days without a visit, unless it's in the Dock).
function StorageNote() {
  const [notice, setNotice] = useState<StorageNotice>(null);
  useEffect(() => {
    storageNotice().then((n) => {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(SAFARI_NOTE_KEY) === "1";
      } catch {
        // No storage: show it.
      }
      setNotice(n === "safari" && dismissed ? null : n);
    });
  }, []);
  if (notice === "private")
    return (
      <p className="storage-note warn">
        <strong>This looks like a private window.</strong> Nothing is kept after you close it: save your home to a file (⌘S) before you go.
      </p>
    );
  if (notice === "safari")
    return (
      <p className="storage-note">
        Safari clears a site's data after 7 days without a visit. To keep your home, add Odaja to the Dock (File → Add to Dock), and save it to a file now and then.{" "}
        <button
          className="link"
          onClick={() => {
            try {
              localStorage.setItem(SAFARI_NOTE_KEY, "1");
            } catch {
              // Not remembered: it shows again next time.
            }
            setNotice(null);
          }}
        >
          Got it
        </button>
      </p>
    );
  return null;
}

export function Welcome() {
  const [error, setError] = useState<string | null>(null);
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
      <div className="card welcome-card">
        <h2>Where shall we start?</h2>
        <NewHomeForm initial="sample" />
        <div className="welcome-more">
          <button
            className="open-file"
            onClick={async () => {
              setError(null);
              const picked = await pickHomeFile().catch((err) => (setError((err as Error).message), null));
              if (picked) openHome(picked).catch((err) => setError((err as Error).message));
            }}
          >
            Open a home file (.odaja)…
          </button>
          {platform.kind === "server" && <OpenFolderForm />}
          {error && <div className="inline-error">{error}</div>}
        </div>
        <StorageNote />
      </div>
    </div>
  );
}
