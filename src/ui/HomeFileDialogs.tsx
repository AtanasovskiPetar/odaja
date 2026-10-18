// Dialogs for home files: saving (with the chat history choice), opening a
// file over the home kept in the browser, and exporting an image.
import { useEffect, useState } from "react";
import { homeFileName } from "../model/homeFile";
import { useOdaja, type ViewMode } from "../store";
import { exportViewImage } from "../three/capture";
import { openHome, rememberedChatsChoice, saveHome } from "./homeFileActions";
import { addMissingToLibrary, type MissingItem } from "./libraryFiles";

const close = () => useOdaja.getState().openDialog(null);

function Backdrop({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      {children}
    </div>
  );
}

export function SaveFileDialog({ saveAs }: { saveAs?: boolean }) {
  const name = useOdaja((s) => s.project?.name ?? s.homes?.current?.name ?? "Home");
  const [includeChats, setIncludeChats] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rememberedChatsChoice().then(setIncludeChats);
  }, []);

  const submit = async () => {
    setBusy(true);
    close();
    await saveHome({ saveAs, includeChats });
  };

  return (
    <Backdrop busy={busy}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>{saveAs ? "Save a copy" : "Save to a file"}</h2>
        <p className="muted">
          Everything about <strong>{name}</strong> goes into one file, {homeFileName(name)}: walls, scenes, materials, photos and models. Open it later on any computer, or send it to someone.
        </p>
        <label className="check">
          <input type="checkbox" checked={includeChats} onChange={(e) => setIncludeChats(e.target.checked)} />
          Include chat history
        </label>
        <p className="hint">Conversations and the photos shared in them. Leave this off when sending the home to someone.</p>
        <div className="dialog-buttons">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy} autoFocus>
            Save
          </button>
        </div>
      </form>
    </Backdrop>
  );
}

// Opening a file replaces the home kept in the browser (it's kept as the
// previous home), so this asks first, and offers to save unsaved changes.
export function OpenHomeDialog({ file, handle }: { file: File; handle?: FileSystemFileHandle }) {
  const name = useOdaja((s) => s.project?.name ?? "your home");
  const unsaved = useOdaja((s) => s.unsavedToFile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (saveFirst: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (saveFirst && !(await saveHome({ includeChats: await rememberedChatsChoice() }))) {
        setBusy(false);
        return;
      }
      await openHome({ file, handle });
      // Opening may have shown another dialog (adding its items to your
      // library); close only this one.
      if (useOdaja.getState().dialog?.kind === "open-home") close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Backdrop busy={busy}>
      <div className="dialog" role="alertdialog" aria-label={`Open ${file.name}?`}>
        <h2>Open {file.name.replace(/\.odaja$/i, "")}?</h2>
        <p className="muted">
          It replaces <strong>{name}</strong> in this browser. {name} is kept as your previous home, so you can bring it back from the start screen.
          {unsaved && <> It has changes that aren't saved to a file yet.</>}
        </p>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-buttons">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          {unsaved && (
            <button type="button" onClick={() => open(true)} disabled={busy}>
              Save {name} first
            </button>
          )}
          <button type="button" className="primary" onClick={() => open(false)} disabled={busy} autoFocus>
            {busy ? "Opening…" : "Open"}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

export function ExportImageDialog() {
  const name = useOdaja((s) => s.project?.name ?? "Home");
  const current = useOdaja((s) => s.viewMode);
  const [view, setView] = useState<ViewMode>(current === "plan" ? "plan" : "3d");
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportViewImage(view, format);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${homeFileName(name).replace(/\.odaja$/, "")} – ${view === "plan" ? "plan" : "3D"}.${format === "png" ? "png" : "jpg"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Backdrop busy={busy}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>Export an image</h2>
        <p className="muted">A picture to look at or share. To keep working on the home elsewhere, save it to a file instead.</p>
        <div className="grid-2">
          <label className="field">
            <span>View</span>
            <select value={view} onChange={(e) => setView(e.target.value as ViewMode)}>
              <option value="plan">Plan, with dimensions</option>
              <option value="3d">3D, as you see it now</option>
            </select>
          </label>
          <label className="field">
            <span>Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as "png" | "jpeg")}>
              <option value="png">PNG (sharp, larger)</option>
              <option value="jpeg">JPG (smaller)</option>
            </select>
          </label>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-buttons">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy} autoFocus>
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}

// After opening a home: the library items it uses that you don't have.
export function AddToLibraryDialog({ items }: { items: MissingItem[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await addMissingToLibrary(items);
      useOdaja.getState().setNotice(items.length === 1 ? `Added “${items[0].name}” to your library.` : `Added ${items.length} items to your library.`);
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Backdrop busy={busy}>
      <div className="dialog" role="dialog" aria-label="Add to your library?">
        <h2>Add to your library?</h2>
        <p className="muted">
          This home uses {items.length === 1 ? "an item" : `${items.length} items`} that {items.length === 1 ? "isn't" : "aren't"} in your library. {items.length === 1 ? "It's" : "They're"} in this home either way; add {items.length === 1 ? "it" : "them"} to use in other homes too.
        </p>
        <ul className="missing-items">
          {items.map((i) => (
            <li key={i.id}>
              <span>{i.name}</span>
              <span className="muted">{i.kind === "material" ? "material" : i.category}</span>
            </li>
          ))}
        </ul>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-buttons">
          <button type="button" onClick={close} disabled={busy}>
            Not now
          </button>
          <button type="button" className="primary" onClick={add} disabled={busy} autoFocus>
            {busy ? "Adding…" : items.length === 1 ? "Add to my library" : "Add all to my library"}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
