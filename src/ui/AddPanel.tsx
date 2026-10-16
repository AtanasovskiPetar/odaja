import { useEffect, useRef, useState } from "react";
import { TEMPLATES, type Template } from "../model/library";
import { platform, type LibraryEntry } from "../platform";
import { useOdaja } from "../store";
import { ACCEPT } from "../three/modelImport";
import { addTemplateObject } from "./actions";
import { placeLibraryEntry } from "./libraryActions";

const CATEGORIES: Template["category"][] = ["Kitchen", "Living", "Bedroom", "Bathroom", "Basic"];

// Your own furniture, saved from scenes or imported, shared by all projects.
function MyLibrary({ onPlaced }: { onPlaced: () => void }) {
  const version = useOdaja((s) => s.libraryVersion);
  const libraryChanged = useOdaja((s) => s.libraryChanged);
  const openDialog = useOdaja((s) => s.openDialog);
  const [items, setItems] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    platform
      .listLibrary()
      .then((l) => setItems(l.items))
      .catch((err) => setError((err as Error).message));
  }, [version]);

  const place = (entry: LibraryEntry) => {
    setError(null);
    placeLibraryEntry(entry)
      .then(onPlaced)
      .catch((err) => setError((err as Error).message));
  };

  const remove = async (entry: LibraryEntry) => {
    if (!window.confirm(`Remove "${entry.item.name}" from your library? Objects already placed in scenes stay.`)) return;
    await platform.deleteLibraryItem(entry.id);
    libraryChanged();
  };

  return (
    <div>
      <div className="library-head">
        <h3>My library</h3>
        <button className="add-button" onClick={() => fileInput.current?.click()} title="GLB, glTF, FBX, OBJ, DAE, 3DS, USDZ, 3MF, STL, PLY, WRL">
          Import model…
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) openDialog({ kind: "import", files });
          }}
        />
      </div>
      {error && <div className="inline-error">{error}</div>}
      {items === null ? null : items.length === 0 ? (
        <p className="muted empty-hint">
          Empty so far. Select an object and choose <strong>Save to library</strong>, or import a model file. You can also drop
          model files onto the view.
        </p>
      ) : (
        <div className="library-grid">
          {items.map((entry) => (
            <div key={entry.id} className="library-card">
              <button onClick={() => place(entry)} title={[entry.item.name, entry.item.notes].filter(Boolean).join("\n")}>
                {entry.preview ? (
                  <img src={`${platform.libraryFileUrl(`${entry.id}/preview.png`)}&v=${entry.modified}`} alt="" />
                ) : (
                  <span className="no-preview" />
                )}
                <span className="card-name">{entry.item.name}</span>
                <span className="card-category">{entry.item.category}</span>
              </button>
              <button className="card-remove" onClick={() => remove(entry)} title="Remove from library">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Your library first, then the built-in templates. Clicking one drops it in
// the middle of the view, selected, ready to drag into place.
export function AddPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="add-panel">
      <MyLibrary onPlaced={onClose} />
      <h3 className="builtin-title">Built-in</h3>
      {CATEGORIES.map((category) => (
        <div key={category}>
          <h3>{category}</h3>
          <div className="add-grid">
            {TEMPLATES.filter((t) => t.category === category).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  addTemplateObject(t.id);
                  onClose();
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
