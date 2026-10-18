// The home's name in the sidebar opens the home menu: a new home, open a
// .odaja file, save to one, export an image. On the website a dot marks
// changes not yet saved to a file; in the companion the menu lists the other
// homes (folders) and opens any folder.
import { useEffect, useRef, useState } from "react";
import { platform } from "../platform";
import { useOdaja } from "../store";
import { pickHomeFile, requestOpenHome, saveHome } from "./homeFileActions";
import { IconChevron } from "./icons";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k: string, shift = false) => `${shift ? (MAC ? "⇧" : "Shift+") : ""}${MAC ? "⌘" : "Ctrl+"}${k}`;

export async function openHomeFromPicker() {
  const picked = await pickHomeFile().catch((err) => {
    useOdaja.getState().setNotice(`Couldn't open the file: ${(err as Error).message}`);
    return null;
  });
  if (picked) await requestOpenHome(picked);
}

// The companion: open another home's folder.
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
  const others = projects.filter((p) => p.dir !== dir).slice(0, 6);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The other homes (companion) may have changed.
    useOdaja.getState().refreshProjects().catch(() => {});
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (action: () => unknown) => () => {
    setOpen(false);
    action();
  };
  const web = platform.kind === "browser";

  return (
    <div className="home-menu" ref={ref}>
      <button
        className={`project-name ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        title={web ? (unsaved ? "Changes not saved to a file yet" : "Kept in this browser") : (dir ?? undefined)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="label">{name}</span>
        {web && unsaved && <span className="unsaved-dot" aria-label="not saved to a file" />}
        <IconChevron size={13} className="chevron" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={run(() => useOdaja.getState().openDialog({ kind: "new-home" }))}>
            New home…
          </button>
          <button role="menuitem" onClick={run(openHomeFromPicker)}>
            Open a home file…<kbd>{key("O")}</kbd>
          </button>
          {!web && (
            <>
              {others.length > 0 && <div className="menu-heading">Other homes</div>}
              {others.map((p) => (
                <button role="menuitem" key={p.dir} onClick={run(() => openOther(p.dir))} title={p.dir}>
                  <span className="menu-label">{p.name}</span>
                </button>
              ))}
              <button role="menuitem" onClick={run(() => useOdaja.getState().openDialog({ kind: "open-folder" }))}>
                Open a folder…
              </button>
            </>
          )}
          <div className="menu-sep" />
          <button role="menuitem" onClick={run(() => saveHome())}>
            Save to file<kbd>{key("S")}</kbd>
          </button>
          <button role="menuitem" onClick={run(() => saveHome({ saveAs: true }))}>
            Save a copy…<kbd>{key("S", true)}</kbd>
          </button>
          <button role="menuitem" onClick={run(() => useOdaja.getState().openDialog({ kind: "export-image" }))}>
            Export image…
          </button>
          {web && <p className="menu-note">{unsaved ? "Changes are kept in this browser, but not in a file yet." : "Kept in this browser and saved to a file."}</p>}
        </div>
      )}
    </div>
  );
}
