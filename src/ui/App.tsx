import { useEffect, useState } from "react";
import { rotateObject } from "../model/operations";
import { duplicateParts, mirrorParts, removeParts } from "../model/partOps";
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
import { WalkOverlay, WalkStartPicker } from "./WalkOverlay";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        useChat.getState().toggle();
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
  const project = useOdaja((s) => s.project);
  const projectDir = useOdaja((s) => s.projectDir);
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
          <span className="logo">Odaja</span>
        </button>
        <span className="project-name" title={projectDir ?? undefined}>
          {project?.name ?? "…"}
        </span>
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
            {adding ? "Close" : "+ Add"}
          </button>
        </div>
        {adding ? (
          <AddPanel onClose={() => setAdding(false)} />
        ) : scene?.objects.length === 0 ? (
          <p className="muted empty-hint">No objects yet. Click + Add, or ask an agent to furnish this scene.</p>
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

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "wall", label: "Wall", key: "W" },
  { tool: "room", label: "Room", key: "R" },
  { tool: "door", label: "Door", key: "D" },
  { tool: "window", label: "Window", key: "N" },
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
      {TOOLS.map((t) => (
        <button key={t.tool} className={tool === t.tool ? "active" : ""} onClick={() => setTool(t.tool)} title={`${t.label} (${t.key})`}>
          {t.label}
        </button>
      ))}
      <span className="sep" />
      <label className="inline-field" title="Thickness of new walls">
        Wall
        <select value={thickness} onChange={(e) => setThickness(Number(e.target.value))}>
          {[8, 10, 12, 15, 20, 25, 30].map((t) => (
            <option key={t} value={t}>
              {t} cm
            </option>
          ))}
        </select>
      </label>
      <button className={hideFurniture ? "active" : ""} onClick={toggleHideFurniture} title="Hide furniture (H)">
        Hide furniture
      </button>
      <button onClick={() => useOdaja.getState().openDialog({ kind: "materials" })} title="Colours, paints, tiles">
        Materials
      </button>
    </div>
  );
}

function ChatToggle() {
  const open = useChat((s) => s.open);
  const toggle = useChat((s) => s.toggle);
  return (
    <button className={open ? "active" : ""} onClick={toggle} title="Chat with an AI about your design (⌘J)">
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
  const showChanges = useOdaja((s) => s.showChanges);
  const toggleShowChanges = useOdaja((s) => s.toggleShowChanges);

  return (
    <div className="toolbar">
      <button className={mode === "furnish" ? "active" : ""} onClick={() => setMode("furnish")} title="Arrange furniture (E toggles)">
        Furnish
      </button>
      <button className={mode === "structure" ? "active" : ""} onClick={() => setMode("structure")} title="Edit walls, doors, windows and rooms (E toggles)">
        Structure
      </button>
      <span className="sep" />
      <button className={viewMode === "plan" ? "active" : ""} onClick={() => setViewMode("plan")} title="Floor plan with dimensions (T)">
        Plan
      </button>
      <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")} title="3D view (P)">
        3D
      </button>
      <button
        className={viewMode === "walk" || picking ? "active" : ""}
        onClick={() => (viewMode === "plan" ? setPicking(true) : startWalk(null))}
        title="Walk through the flat at eye height (K). From the plan, click where to stand."
      >
        Walk
      </button>
      {viewMode === "3d" && (
        <button className={wallsCut ? "active" : ""} onClick={toggleWallsCut} title="Cut walls at 110 cm (C)">
          Cut walls
        </button>
      )}
      {hasBase && viewMode === "plan" && (
        <button className={showChanges ? "active" : ""} onClick={toggleShowChanges} title="Show walls removed (red) and added (green) compared with shell.json">
          Changes
        </button>
      )}
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
      <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
      <span className="sep" />
      <ChatToggle />
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
        if (files.length) useOdaja.getState().openDialog({ kind: "import", files });
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
