// Save the selected object to the furniture library, so it can be placed in
// any scene or project later.
import { useState } from "react";
import { useOdaja } from "../store";
import { CATEGORIES, saveObjectToLibrary } from "./libraryActions";

export function SaveToLibraryDialog({ objectId }: { objectId: string }) {
  const object = useOdaja((s) => s.scene?.objects.find((o) => o.id === objectId));
  const close = () => useOdaja.getState().openDialog(null);
  const [name, setName] = useState(object?.name ?? "");
  const [category, setCategory] = useState(guessCategory(object?.room, object?.template));
  const [notes, setNotes] = useState(object?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!object) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveObjectToLibrary(objectId, name.trim() || object.name, category, notes.trim() || undefined);
      setSaved(true);
      setTimeout(close, 700);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>Save to my library</h2>
        <p className="muted">Available in every project, from + Add → My library.</p>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. IKEA METOD sink cabinet 80" />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Product link, price, colour…" />
        </label>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-buttons">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {saved ? "Saved ✓" : busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function guessCategory(room?: string, template?: string): string {
  const text = `${room ?? ""} ${template ?? ""}`.toLowerCase();
  if (/kitchen|cabinet|fridge/.test(text)) return "Kitchen";
  if (/bath|toilet|vanity|shower|washing/.test(text)) return "Bathroom";
  if (/bed|wardrobe|nightstand/.test(text)) return "Bedroom";
  if (/living|sofa|table|chair|bookcase/.test(text)) return "Living";
  return "Other";
}
