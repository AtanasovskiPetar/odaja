// A cloud home's history: versions kept every few minutes of editing, before
// each AI reply and before a restore, plus the ones you name. Restoring one
// keeps the current state as a version first, so nothing is lost.
import { useEffect, useState, type FormEvent } from "react";
import { platform, type VersionSummary } from "../../platform";
import { useOdaja } from "../../store";
import { Button } from "../primitives/Button";

const REASON: Record<VersionSummary["reason"], string> = {
  autosave: "Saved while editing",
  named: "Named",
  "before-ai": "Before an AI reply",
  "before-restore": "Before a restore",
};

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HistoryDialog() {
  const close = () => useOdaja.getState().openDialog(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    platform.versions
      ?.list()
      .then(setVersions)
      .catch((err) => setError((err as Error).message));
  useEffect(() => {
    void refresh();
  }, []);

  const name = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy("name");
    try {
      await platform.versions!.create(label.trim());
      setLabel("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (v: VersionSummary) => {
    setBusy(v.id);
    try {
      await platform.versions!.restore(v.id);
      useOdaja.getState().setNotice(`Restored ${v.label ?? when(v.createdAt)}. The state before it is in the history.`);
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="History" className="w-full max-w-[480px] max-h-[82vh] flex flex-col rounded-[14px] bg-card shadow-dialog border border-line text-ink overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line">
          <div>
            <h2 className="font-serif text-2xl font-normal leading-none m-0">History</h2>
            <p className="mt-1.5 mb-0 text-xs text-muted">Kept every few minutes while you edit and before each AI reply.</p>
          </div>
          <Button size="sm" onClick={close}>Close</Button>
        </div>

        <form onSubmit={name} className="flex gap-2 px-5 py-3 border-b border-line">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name this version, e.g. Option A"
            maxLength={120}
            className="flex-1 min-w-0 h-8 rounded-[7px] border border-line bg-paper px-2.5 text-xs text-ink"
          />
          <Button size="sm" type="submit" disabled={!label.trim() || busy !== null}>
            {busy === "name" ? "Keeping…" : "Keep"}
          </Button>
        </form>

        {error && <div role="alert" className="mx-5 mt-3 rounded-[6px] bg-danger-wash px-2.5 py-2 text-xs text-danger">{error}</div>}

        <ul className="m-0 p-0 list-none overflow-y-auto px-3 py-2">
          {versions === null && <li className="px-2 py-4 text-xs text-muted">Loading…</li>}
          {versions?.length === 0 && <li className="px-2 py-4 text-xs text-muted">No versions yet. One is kept after a few minutes of editing.</li>}
          {versions?.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 hover:bg-well">
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{v.label ?? when(v.createdAt)}</div>
                <div className="text-[11px] text-muted">
                  {REASON[v.reason]}
                  {v.label ? ` · ${when(v.createdAt)}` : ""}
                </div>
              </div>
              <Button size="sm" disabled={busy !== null} onClick={() => restore(v)}>
                {busy === v.id ? "Restoring…" : "Restore"}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
