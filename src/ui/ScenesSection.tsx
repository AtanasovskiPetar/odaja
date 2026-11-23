import { useRef, useState } from "react";
import type { SceneSummary } from "../platform";
import { useOdaja } from "../store";
import { IconChevron } from "./icons";
import { Button } from "./primitives/Button";
import { Popover } from "./primitives/Popover";

function SceneRow({
  scene,
  active,
  canDelete,
  renaming,
  onOpen,
  onStartRename,
  onFinishRename,
  onDuplicate,
  onDelete,
}: {
  scene: SceneSummary;
  active: boolean;
  canDelete: boolean;
  renaming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onFinishRename: (name: string | null) => void;
  onDuplicate: (withWalls: boolean) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  if (renaming) {
    return (
      <li className="list-none">
        <RenameInput initial={scene.name} onDone={onFinishRename} />
      </li>
    );
  }

  return (
    <li className="list-none group">
      <div
        className={`flex items-center gap-1 rounded-[7px] px-2 py-1 transition-colors ${
          active ? "bg-accent-wash text-ink" : "hover:bg-well text-ink-2"
        }`}
      >
        <button
          type="button"
          onClick={() => !active && onOpen()}
          onDoubleClick={onStartRename}
          title={`${scene.path} · double-click to rename`}
          className="flex-1 min-w-0 flex items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs cursor-pointer"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-accent" : "bg-transparent"}`}
          />
          <span className={`truncate ${active ? "font-semibold text-ink" : "font-normal text-ink"}`}>
            {scene.name}
          </span>
          {scene.shell !== "shell.json" && (
            <span
              title={`Uses ${scene.shell}`}
              className="shrink-0 rounded bg-well px-1.5 py-0.5 text-[10px] font-medium text-muted"
            >
              own walls
            </span>
          )}
        </button>

        <button
          ref={moreRef}
          type="button"
          onClick={() => {
            setConfirmDelete(false);
            setMenuOpen((v) => !v);
          }}
          aria-label={`Scene options for ${scene.name}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={`w-6 h-6 rounded-[5px] border-0 bg-transparent text-muted hover:text-ink hover:bg-well-2 inline-flex items-center justify-center shrink-0 cursor-pointer text-xs leading-none transition-opacity ${
            active || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          ···
        </button>
      </div>

      <Popover
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
          setConfirmDelete(false);
        }}
        anchorRef={moreRef}
        align="end"
        width={208}
      >
        {confirmDelete ? (
          <div className="flex flex-col gap-2 p-1">
            <p className="m-0 text-xs text-ink">
              Delete <strong>{scene.name}</strong>?
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="danger"
                size="sm"
                className="flex-1 bg-danger-wash"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(false);
                  onDelete();
                }}
              >
                Delete
              </Button>
              <Button size="sm" className="flex-1" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onStartRename();
              }}
              className="w-full text-left border-0 bg-transparent text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well cursor-pointer"
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDuplicate(false);
              }}
              title="Copy this scene's furniture; walls stay shared"
              className="w-full text-left border-0 bg-transparent text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well cursor-pointer"
            >
              Duplicate (shared walls)
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDuplicate(true);
              }}
              title="Copy this scene with its own walls to test layout changes"
              className="w-full text-left border-0 bg-transparent text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well cursor-pointer"
            >
              Duplicate with own walls
            </button>
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              disabled={!canDelete}
              title={!canDelete ? "A project needs at least one scene" : undefined}
              onClick={() => setConfirmDelete(true)}
              className="w-full text-left border-0 bg-transparent text-danger text-xs px-2 py-1.5 rounded-[6px] hover:bg-danger-wash cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete scene…
            </button>
          </div>
        )}
      </Popover>
    </li>
  );
}

// Scene list with new / duplicate / rename / delete. Double-click a scene to
// rename it, or use the ··· menu on any row.
export function ScenesSection() {
  const scenes = useOdaja((s) => s.scenes);
  const scenePath = useOdaja((s) => s.scenePath);
  const openScene = useOdaja((s) => s.openScene);
  const newScene = useOdaja((s) => s.newScene);
  const duplicateScene = useOdaja((s) => s.duplicateScene);
  const renameScene = useOdaja((s) => s.renameScene);
  const deleteScene = useOdaja((s) => s.deleteScene);
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((err) => setError((err as Error).message));
  };
  const current = scenes.find((s) => s.path === scenePath);

  return (
    <section className="shrink-0 border-b border-line px-3 py-2.5">
      <div className={`flex items-center justify-between gap-2 ${collapsed ? "" : "mb-1.5"}`}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 min-w-0 border-0 bg-transparent p-0 text-left cursor-pointer group"
        >
          <IconChevron
            size={12}
            className={`text-muted group-hover:text-ink shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted group-hover:text-ink shrink-0">
            Scenes{scenes.length > 1 ? ` (${scenes.length})` : ""}
          </span>
          {collapsed && current && (
            <span className="text-xs font-medium text-ink truncate">· {current.name}</span>
          )}
        </button>
        <Button
          size="sm"
          onClick={() => {
            setCollapsed(false);
            run(async () => setRenaming(await newScene()));
          }}
          className="h-6 px-2 text-[11px] shrink-0"
        >
          + New
        </Button>
      </div>

      {!collapsed && (
        <ul className="m-0 p-0 flex flex-col gap-0.5 max-h-36 overflow-y-auto">
          {scenes.map((scene) => (
            <SceneRow
              key={scene.path}
              scene={scene}
              active={scene.path === scenePath}
              canDelete={scenes.length > 1}
              renaming={renaming === scene.path}
              onOpen={() => run(() => openScene(scene.path))}
              onStartRename={() => setRenaming(scene.path)}
              onFinishRename={(name) => {
                setRenaming(null);
                if (name && name !== scene.name) run(() => renameScene(scene.path, name));
              }}
              onDuplicate={(withWalls) =>
                run(async () => {
                  if (scene.path !== scenePath) await openScene(scene.path);
                  await duplicateScene(withWalls);
                })
              }
              onDelete={() => run(() => deleteScene(scene.path))}
            />
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-1.5 rounded-[6px] bg-danger-wash px-2 py-1 text-[11px] text-danger">
          {error}
        </div>
      )}
    </section>
  );
}

export function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  // Escape and blur can both fire; only report once.
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") finish(null);
      }}
      className="w-full h-7 rounded-[6px] border border-accent bg-card px-2 text-xs text-ink outline-none"
    />
  );
}
