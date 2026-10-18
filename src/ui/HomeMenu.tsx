// The home's name in the sidebar opens the file menu: save to a .odaja file,
// save a copy, open a file, export an image. On the website a dot marks
// changes not yet saved to a file.
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

export function HomeMenu() {
  const name = useOdaja((s) => s.project?.name ?? "…");
  const dir = useOdaja((s) => s.projectDir);
  const unsaved = useOdaja((s) => s.unsavedToFile);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
          <button role="menuitem" onClick={run(() => saveHome())}>
            Save to file<kbd>{key("S")}</kbd>
          </button>
          <button role="menuitem" onClick={run(() => saveHome({ saveAs: true }))}>
            Save a copy…<kbd>{key("S", true)}</kbd>
          </button>
          <button role="menuitem" onClick={run(openHomeFromPicker)}>
            Open a home file…<kbd>{key("O")}</kbd>
          </button>
          <div className="menu-sep" />
          <button role="menuitem" onClick={run(() => useOdaja.getState().openDialog({ kind: "export-image" }))}>
            Export image…
          </button>
          {web && <p className="menu-note">{unsaved ? "Changes are kept in this browser, but not in a file yet." : "Kept in this browser and saved to a file."}</p>}
        </div>
      )}
    </div>
  );
}
