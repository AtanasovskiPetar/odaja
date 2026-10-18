import { useEffect, useState } from "react";
import { rotateObject } from "../model/operations";
import { duplicateParts, mirrorParts, removeParts } from "../model/partOps";
import { platform } from "../platform";
import { useOdaja, type Tool } from "../store";
import { Viewport } from "../three/Viewport";
import { deleteSelected, deleteStructureSelection, duplicateSelected } from "./actions";
import { AddPanel } from "./AddPanel";
import { Inspector } from "./Inspector";
import { ChatPanel } from "./chat/ChatPanel";
import { useChat } from "./chat/chatStore";
import { ImportDialog } from "./ImportDialog";
import { IssuesPanel } from "./IssuesPanel";
import { MaterialsDialog } from "./MaterialsDialog";
import { SaveToLibraryDialog } from "./SaveToLibraryDialog";
import { QuantitiesSection } from "./FinishesInspector";
import { PartInspector, PartsSection } from "./PartsEditor";
import { PlanOverlay } from "./PlanOverlay";
import { ScenesSection } from "./ScenesSection";
import { StartScreen } from "./StartScreen";
import { StructureInspector } from "./StructureInspector";
import { StructureLayer } from "./StructureLayer";
import { UnderlayPanel, UnderlayToolLayer } from "./UnderlayPanel";
import { ThemeCycleButton } from "./ThemeSwitch";
import { HomeMenu, openHomeFromPicker } from "./HomeMenu";
import { ExportImageDialog, OpenHomeDialog, SaveFileDialog } from "./HomeFileDialogs";
import { isHomeFile, requestOpenHome, saveHome } from "./homeFileActions";
import { WalkOverlay, WalkStartPicker } from "./WalkOverlay";
import {
  IconBack,
  IconChat,
  IconCompare,
  IconCube,
  IconCut,
  IconDoor,
  IconEyeOff,
  IconFurnish,
  IconLayers,
  IconPlan,
  IconPlus,
  IconRedo,
  IconRoom,
  IconSelect,
  IconStructure,
  IconSwatch,
  IconUndo,
  IconWalk,
  IconWall,
  IconWindow,
  LogoMark,
} from "./icons";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // File keys work everywhere, also while typing in a field.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && useOdaja.getState().status === "project") {
        const k = e.key.toLowerCase();
        if (k === "s") {
          e.preventDefault();
          saveHome({ saveAs: e.shiftKey });
          return;
        }
        if (k === "o") {
          e.preventDefault();
          openHomeFromPicker();
          return;
        }
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = useOdaja.getState();
      if (s.status !== "project") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (platform.kind !== "browser") useChat.getState().toggle();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && s.editingObjectId) {
        e.preventDefault();
        if (s.partSelection.length) {
          const count = s.sceneDoc?.objects?.find((o) => o.id === s.editingObjectId)?.parts?.length ?? 0;
          s.apply(duplicateParts(s.editingObjectId, s.partSelection));
          s.selectParts(s.partSelection.map((_, k) => count + k));
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && s.mode === "furnish") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod) return;
      const key = e.key.toLowerCase();

      // While walking, the walk controls own the keyboard (W A S D Q E…);
      // only view switches and undo apply.
      if (s.viewMode === "walk") {
        if (key === "t") s.setViewMode("plan");
        if (key === "p") s.setViewMode("3d");
        return;
      }
      if (key === "escape" && s.pickingWalkStart) return s.setPickingWalkStart(false);
      if (key === "k") return s.viewMode === "plan" ? s.setPickingWalkStart(true) : s.startWalk(null);

      // Shared by both modes.
      if (key === "t") return s.setViewMode("plan");
      if (key === "p") return s.setViewMode("3d");
      if (key === "e") return s.setMode(s.mode === "structure" ? "furnish" : "structure");

      if (s.editingObjectId) {
        const id = s.editingObjectId;
        const sel = s.partSelection;
        const count = s.sceneDoc?.objects?.find((o) => o.id === id)?.parts?.length ?? 0;
        if (key === "g") return s.setPartTool("move");
        if (key === "r") return s.setPartTool("rotate");
        if (key === "s") return s.setPartTool("size");
        if (key === "m" && sel.length) {
          s.apply(mirrorParts(id, sel, "x"));
          return s.selectParts(sel.map((_, k) => count + k));
        }
        if (key === "enter") return s.stopEditingShape();
        if (key === "escape") return sel.length ? s.selectParts([]) : s.stopEditingShape();
        if ((key === "delete" || key === "backspace") && sel.length && sel.length < count) {
          e.preventDefault();
          s.apply(removeParts(id, sel));
          return s.selectParts([]);
        }
        return;
      }

      if (s.mode === "structure") {
        // Escape and Enter belong to the structure layer (drawing).
        const tools: Record<string, Tool> = { v: "select", w: "wall", r: "room", d: "door", n: "window" };
        if (tools[key]) return s.setTool(tools[key]);
        if (key === "h") return s.toggleHideFurniture();
        if ((key === "delete" || key === "backspace") && s.structureSelection) {
          e.preventDefault();
          deleteStructureSelection();
        }
        return;
      }

      const selected = s.scene?.objects.find((o) => o.id === s.selectedId);
      switch (key) {
        case "r":
          if (selected && !selected.locked) s.apply(rotateObject(selected.id, e.shiftKey ? 15 : 90));
          break;
        case "c":
          s.toggleWallsCut();
          break;
        case "escape":
          s.select(null);
          break;
        case "delete":
        case "backspace":
          e.preventDefault();
          deleteSelected();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Sidebar() {
  const closeProject = useOdaja((s) => s.closeProject);
  const scene = useOdaja((s) => s.scene);
  const selectedId = useOdaja((s) => s.selectedId);
  const select = useOdaja((s) => s.select);
  const structure = useOdaja((s) => s.mode === "structure");
  const editingShape = useOdaja((s) => s.editingObjectId !== null);
  const [adding, setAdding] = useState(false);

  return (
    <aside className="sidebar">
      <header className="brand">
        <button className="logo-button" onClick={closeProject} title="Back to projects">
          <IconBack className="back" size={14} />
          <LogoMark />
          <span className="logo">Odaja</span>
        </button>
        <HomeMenu />
        <ThemeCycleButton />
      </header>

      <ScenesSection />

      {editingShape ? (
        <>
          <PartsSection />
          <PartInspector />
        </>
      ) : structure ? (
        <>
          <RoomsSection />
          <StructureInspector />
        </>
      ) : (
        <>
      <section className="grow">
        <div className="section-head">
          <h2>{adding ? "Add object" : "Objects"}</h2>
          <button className={`add-button ${adding ? "active" : ""}`} onClick={() => setAdding(!adding)} disabled={!scene}>
            {adding ? "Done" : (
              <>
                <IconPlus size={13} /> Add
              </>
            )}
          </button>
        </div>
        {adding ? (
          <AddPanel onClose={() => setAdding(false)} />
        ) : scene?.objects.length === 0 ? (
          <p className="muted empty-hint">{platform.kind === "browser" ? "An empty room. Add furniture to start." : "An empty room. Add furniture, or ask the chat to furnish it."}</p>
        ) : (
          <ul className="list">
            {scene?.objects.map((o) => (
              <li key={o.id}>
                <button className={o.id === selectedId ? "active" : ""} onClick={() => select(o.id)}>
                  {o.name}
                  <span className="muted">{o.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Inspector />
        </>
      )}
    </aside>
  );
}

function RoomsSection() {
  const shell = useOdaja((s) => s.shell);
  const selection = useOdaja((s) => s.structureSelection);
  const selectStructure = useOdaja((s) => s.selectStructure);
  if (!shell) return <section className="grow" />;
  const isSelected = (kind: string, id: string) => selection?.kind === kind && "id" in selection && selection.id === id;
  return (
    <section className="grow">
      <h2>Rooms</h2>
      {shell.rooms.length === 0 ? (
        <p className="muted empty-hint">No rooms yet. Draw walls, then click inside an enclosed area and choose Make room.</p>
      ) : (
        <ul className="list">
          {shell.rooms.map((r) => (
            <li key={r.id}>
              <button className={isSelected("room", r.id) ? "active" : ""} onClick={() => selectStructure({ kind: "room", id: r.id })}>
                {r.name}
                <span className="muted">{r.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2 className="spaced">Walls</h2>
      <ul className="list">
        {shell.walls.map((w) => (
          <li key={w.id}>
            <button className={isSelected("wall", w.id) ? "active" : ""} onClick={() => selectStructure({ kind: "wall", id: w.id })}>
              {w.id}
              <span className="muted">
                {w.thickness} cm
                {(() => {
                  const n = shell.openings.filter((o) => o.wall === w.id).length;
                  return n ? ` · ${n} opening${n > 1 ? "s" : ""}` : "";
                })()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <QuantitiesSection />
    </section>
  );
}

const TOOLS: { tool: Tool; label: string; key: string; Icon: typeof IconSelect }[] = [
  { tool: "select", label: "Select", key: "V", Icon: IconSelect },
  { tool: "wall", label: "Wall", key: "W", Icon: IconWall },
  { tool: "room", label: "Room", key: "R", Icon: IconRoom },
  { tool: "door", label: "Door", key: "D", Icon: IconDoor },
  { tool: "window", label: "Window", key: "N", Icon: IconWindow },
];

function StructureToolbar() {
  const tool = useOdaja((s) => s.tool);
  const setTool = useOdaja((s) => s.setTool);
  const thickness = useOdaja((s) => s.wallThickness);
  const setThickness = useOdaja((s) => s.setWallThickness);
  const hideFurniture = useOdaja((s) => s.hideFurniture);
  const toggleHideFurniture = useOdaja((s) => s.toggleHideFurniture);
  return (
    <div className="toolbar secondary">
      <div className="seg">
        {TOOLS.map(({ tool: id, label, key, Icon }) => (
          <button key={id} className={tool === id ? "active" : ""} onClick={() => setTool(id)} title={`${label} (${key})`}>
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <span className="sep" />
      <label className="inline-field" title="Thickness of new walls">
        Thickness
        <select value={thickness} onChange={(e) => setThickness(Number(e.target.value))}>
          {[8, 10, 12, 15, 20, 25, 30].map((t) => (
            <option key={t} value={t}>
              {t} cm
            </option>
          ))}
        </select>
      </label>
      <button className={`icon-only ${hideFurniture ? "active" : ""}`} onClick={toggleHideFurniture} title="Hide furniture (H)">
        <IconEyeOff size={17} />
      </button>
      <button className="icon-only" onClick={() => useOdaja.getState().openDialog({ kind: "materials" })} title="Materials: colours, paints, tiles">
        <IconSwatch size={17} />
      </button>
    </div>
  );
}

function ChatToggle() {
  const open = useChat((s) => s.open);
  const toggle = useChat((s) => s.toggle);
  return (
    <button className={open ? "active" : ""} onClick={toggle} title="Chat with an AI about your design (⌘J)">
      <IconChat size={17} />
      Chat
    </button>
  );
}

function Toolbar() {
  const mode = useOdaja((s) => s.mode);
  const setMode = useOdaja((s) => s.setMode);
  const wallsCut = useOdaja((s) => s.wallsCut);
  const toggleWallsCut = useOdaja((s) => s.toggleWallsCut);
  const viewMode = useOdaja((s) => s.viewMode);
  const setViewMode = useOdaja((s) => s.setViewMode);
  const picking = useOdaja((s) => s.pickingWalkStart);
  const setPicking = useOdaja((s) => s.setPickingWalkStart);
  const startWalk = useOdaja((s) => s.startWalk);
  const undo = useOdaja((s) => s.undo);
  const redo = useOdaja((s) => s.redo);
  const canUndo = useOdaja((s) => s.undoStack.length > 0);
  const canRedo = useOdaja((s) => s.redoStack.length > 0);
  const hasBase = useOdaja((s) => s.baseShell !== null);
  const underlayOpen = useOdaja((s) => s.underlayPanel);
  const setUnderlayPanel = useOdaja((s) => s.setUnderlayPanel);
  const showChanges = useOdaja((s) => s.showChanges);
  const toggleShowChanges = useOdaja((s) => s.toggleShowChanges);

  return (
    <div className="toolbar">
      <div className="seg">
        <button className={mode === "furnish" ? "active" : ""} onClick={() => setMode("furnish")} title="Arrange furniture (E toggles)">
          <IconFurnish size={17} />
          Furnish
        </button>
        <button className={mode === "structure" ? "active" : ""} onClick={() => setMode("structure")} title="Edit walls, doors, windows and rooms (E toggles)">
          <IconStructure size={17} />
          Structure
        </button>
      </div>
      <span className="sep" />
      <div className="seg">
        <button className={viewMode === "plan" ? "active" : ""} onClick={() => setViewMode("plan")} title="Floor plan with dimensions (T)">
          <IconPlan size={17} />
          Plan
        </button>
        <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")} title="3D view (P)">
          <IconCube size={17} />
          3D
        </button>
        <button
          className={viewMode === "walk" || picking ? "active" : ""}
          onClick={() => (viewMode === "plan" ? setPicking(true) : startWalk(null))}
          title="Walk through the flat at eye height (K). From the plan, click where to stand."
        >
          <IconWalk size={17} />
          Walk
        </button>
      </div>
      {viewMode === "3d" && (
        <button className={`icon-only ${wallsCut ? "active" : ""}`} onClick={toggleWallsCut} title="Cut walls at 110 cm (C)">
          <IconCut size={17} />
        </button>
      )}
      {viewMode === "plan" && (
        <button className={`icon-only ${underlayOpen ? "active" : ""}`} onClick={() => setUnderlayPanel(!underlayOpen)} title="Floor plan background: an image under the plan, to check and trace walls">
          <IconLayers size={17} />
        </button>
      )}
      {hasBase && viewMode === "plan" && (
        <button className={`icon-only ${showChanges ? "active" : ""}`} onClick={toggleShowChanges} title="Show walls removed (red) and added (green) compared with shell.json">
          <IconCompare size={17} />
        </button>
      )}
      <span className="sep" />
      <button className="icon-only" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        <IconUndo size={17} />
      </button>
      <button className="icon-only" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        <IconRedo size={17} />
      </button>
      {platform.kind !== "browser" && (
        <>
          <span className="sep" />
          <ChatToggle />
        </>
      )}
    </div>
  );
}

function Notice() {
  const notice = useOdaja((s) => s.notice);
  return notice ? <div className="notice">{notice}</div> : null;
}

function Errors() {
  const errors = useOdaja((s) => s.errors);
  if (errors.length === 0) return null;
  return (
    <div className="errors">
      {errors.map((e) => (
        <div key={e.path}>
          <strong>{e.path}</strong>
          <pre>{e.message}</pre>
        </div>
      ))}
    </div>
  );
}

function Dialogs() {
  const dialog = useOdaja((s) => s.dialog);
  if (dialog?.kind === "import") return <ImportDialog files={dialog.files} />;
  if (dialog?.kind === "save") return <SaveToLibraryDialog objectId={dialog.objectId} />;
  if (dialog?.kind === "materials") return <MaterialsDialog focus={dialog.focus} />;
  if (dialog?.kind === "save-file") return <SaveFileDialog saveAs={dialog.saveAs} />;
  if (dialog?.kind === "open-home") return <OpenHomeDialog file={dialog.file} handle={dialog.handle} />;
  if (dialog?.kind === "export-image") return <ExportImageDialog />;
  return null;
}

// Dropping model files anywhere on the view opens the import dialog.
function useFileDrop() {
  const [over, setOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  return {
    over,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget === e.target) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        // A dropped home file opens the home; anything else is a model to import.
        const home = files.find(isHomeFile);
        if (home) requestOpenHome({ file: home });
        else if (files.length) useOdaja.getState().openDialog({ kind: "import", files });
      },
    },
  };
}

export function App() {
  const load = useOdaja((s) => s.load);
  const drop = useFileDrop();
  const chatOpen = useChat((s) => s.open);
  const status = useOdaja((s) => s.status);
  const editingStructure = useOdaja((s) => s.mode === "structure" && s.viewMode === "plan");
  useEffect(() => {
    load();
  }, [load]);
  useShortcuts();

  if (status === "loading") return null;
  if (status === "start") return <StartScreen />;
  return (
    <div className="app">
      <Sidebar />
      <main className={`viewport ${drop.over ? "drop-over" : ""}`} {...drop.handlers}>
        <Viewport />
        <PlanOverlay />
        {editingStructure && <StructureLayer />}
        <UnderlayToolLayer />
        <UnderlayPanel />
        <WalkStartPicker />
        <WalkOverlay />
        <div className="toolbars">
          <Toolbar />
          {editingStructure && <StructureToolbar />}
        </div>
        <Notice />
        <IssuesPanel />
        <Errors />
      </main>
      {chatOpen && <ChatPanel />}
      <Dialogs />
    </div>
  );
}
