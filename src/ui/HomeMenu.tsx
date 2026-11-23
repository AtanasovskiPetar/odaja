// The home's name in the sidebar opens the home menu: switch homes, manage all
// homes, create a new home, import/export .odaja files, or export an image.
import { useEffect, useRef, useState } from "react";
import { useCloudAuth, useCloudSignedIn } from "../cloud/auth";
import { platform } from "../platform";
import { useOdaja } from "../store";
import { pickHomeFile, requestOpenHome, saveHome } from "./homeFileActions";
import { IconChevron } from "./icons";
import { Popover } from "./primitives/Popover";
import { RenameInput } from "./ScenesSection";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k: string, shift = false) => `${shift ? (MAC ? "⇧" : "Shift+") : ""}${MAC ? "⌘" : "Ctrl+"}${k}`;

export async function openHomeFromPicker() {
  const picked = await pickHomeFile().catch((err) => {
    useOdaja.getState().setNotice(`Couldn't open the file: ${(err as Error).message}`);
    return null;
  });
  if (picked) await requestOpenHome(picked);
}

async function openOther(dir: string) {
  await useOdaja
    .getState()
    .openProject(dir)
    .catch((err) => useOdaja.getState().setNotice(`Couldn't open it: ${(err as Error).message}`));
}

export function HomeMenu() {
  const name = useOdaja((s) => s.project?.name ?? "…");
  const dir = useOdaja((s) => s.projectDir);
  const unsaved = useOdaja((s) => s.unsavedToFile);
  const projects = useOdaja((s) => s.projects);
  const browserHome = useOdaja((s) => s.homes?.current ?? null);
  const signedIn = useCloudSignedIn();
  const others = projects.filter((p) => p.dir !== dir).slice(0, 5);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    useOdaja.getState().refreshProjects().catch(() => {});
  }, [open]);

  const run = (action: () => unknown) => () => {
    setOpen(false);
    action();
  };
  const web = platform.kind === "browser";
  const cloud = platform.kind === "cloud";
  // The website keeps one home; with an account there are others to list.
  const listsHomes = !web || signedIn;
  const copyToAccount = async () => {
    if (!platform.cloud?.signedIn()) return useCloudAuth.getState().openSignIn({ mode: "sign-in" });
    await useOdaja
      .getState()
      .copyHomeToCloud()
      .then(() => useOdaja.getState().setNotice("The home is in your account now. The copy you had stays where it was."))
      .catch((err) => useOdaja.getState().setNotice(`Couldn't copy it: ${(err as Error).message}`));
  };

  if (renaming) {
    return (
      <div className="flex-1 min-w-0">
        <RenameInput
          initial={name}
          onDone={(next) => {
            setRenaming(false);
            if (next && next !== name) useOdaja.getState().applyProject((doc) => ({ ...doc, name: next }));
          }}
        />
      </div>
    );
  }

  const itemClass =
    "w-full flex items-center justify-between gap-2 text-left border-0 bg-transparent text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well cursor-pointer";

  return (
    <div className="flex-1 min-w-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onDoubleClick={() => {
          setOpen(false);
          setRenaming(true);
        }}
        title={`${web ? (unsaved ? "Changes not saved to a file yet" : "Kept in this browser") : cloud ? "In your account" : (dir ?? "")} · double-click to rename`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-1.5 rounded-[7px] border px-2 py-1 text-left text-xs font-medium text-ink cursor-pointer transition-colors ${
          open ? "bg-well border-line-strong" : "bg-card border-line hover:bg-well hover:border-line-strong"
        }`}
      >
        <span className="truncate">{name}</span>
        <span className="flex items-center gap-1 shrink-0 text-muted">
          {web && unsaved && <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-label="not saved to a file" />}
          <IconChevron size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} align="start" width={248}>
        <div className="flex flex-col gap-0.5">
          {listsHomes && (
            <button
              type="button"
              role="menuitem"
              onClick={run(() => useOdaja.getState().openDialog({ kind: "manage-homes" }))}
              className={`${itemClass} font-medium`}
            >
              <span>All homes{projects.length > 0 ? ` (${projects.length})` : ""}</span>
              <span className="text-[11px] text-muted">Manage →</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={run(() => useOdaja.getState().openDialog({ kind: "new-home" }))}
            className={itemClass}
          >
            <span>+ New home…</span>
          </button>
          <button type="button" role="menuitem" onClick={run(openHomeFromPicker)} className={itemClass}>
            <span>Import .odaja file…</span>
            <kbd className="text-[10px] text-muted font-sans">{key("O")}</kbd>
          </button>

          {listsHomes && (others.length > 0 || (cloud && browserHome)) && (
            <>
              <div className="mt-1.5 mb-0.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Recent homes
              </div>
              {others.map((p) => (
                <button
                  type="button"
                  role="menuitem"
                  key={p.dir}
                  onClick={run(() => openOther(p.dir))}
                  title={p.cloud ? `${p.name} (in your account)` : p.dir}
                  className={itemClass}
                >
                  <span className="truncate">{p.name}</span>
                  {p.cloud && <span className="text-[10px] text-muted">account</span>}
                </button>
              ))}
              {cloud && browserHome && (
                <button type="button" role="menuitem" onClick={run(() => openOther("current"))} className={itemClass}>
                  <span className="truncate">{browserHome.name}</span>
                  <span className="text-[10px] text-muted">this browser</span>
                </button>
              )}
            </>
          )}

          {platform.kind === "server" && (
            <button
              type="button"
              role="menuitem"
              onClick={run(() => useOdaja.getState().openDialog({ kind: "open-folder" }))}
              className={itemClass}
            >
              <span>Open local folder…</span>
            </button>
          )}

          <div className="my-1 border-t border-line" />

          <button type="button" role="menuitem" onClick={run(() => setRenaming(true))} className={itemClass}>
            <span>Rename home…</span>
          </button>
          {platform.versions && (
            <button type="button" role="menuitem" onClick={run(() => useOdaja.getState().openDialog({ kind: "history" }))} className={itemClass}>
              <span>History…</span>
            </button>
          )}
          {platform.cloud && !cloud && (
            <button type="button" role="menuitem" onClick={run(copyToAccount)} className={itemClass}>
              <span>Copy to your account</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={run(() => saveHome())} className={itemClass}>
            <span>Export .odaja file</span>
            <kbd className="text-[10px] text-muted font-sans">{key("S")}</kbd>
          </button>
          <button type="button" role="menuitem" onClick={run(() => saveHome({ saveAs: true }))} className={itemClass}>
            <span>Save a copy…</span>
            <kbd className="text-[10px] text-muted font-sans">{key("S", true)}</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => useOdaja.getState().openDialog({ kind: "export-image" }))}
            className={itemClass}
          >
            <span>Export image…</span>
          </button>

          {web && (
            <p className="m-0 mt-1 border-t border-line pt-1.5 px-2 text-[11px] text-muted">
              {unsaved ? "Changes are kept in this browser, not in a file yet." : "Kept in this browser and saved to a file."}
            </p>
          )}
        </div>
      </Popover>
    </div>
  );
}
