import { useEffect, useState } from "react";
import { moveObject, rotateObject, setObjectProps } from "../model/operations";
import { roomAt } from "../model/geometry";
import { round } from "../model/units";
import { objectLights, type SceneObject } from "../model/schema";
import { duplicateParts, mirrorParts, removeParts } from "../model/partOps";
import { useOdaja, type Tool } from "../store";
import { platform } from "../platform";
import { CloudAccountFooter, SignInWindow } from "./cloud/AuthGate";
import { AdminDialog } from "./cloud/AdminDialog";
import { HistoryDialog } from "./cloud/HistoryDialog";
import { UsageDialog } from "./cloud/UsageDialog";
import { Viewport } from "../three/Viewport";
import { PreparingIndicator } from "../three/render/ShaderGate";
import { deleteSelected, deleteStructureSelection, duplicateSelected } from "./actions";
import { AddPanel } from "./AddPanel";
import { Inspector } from "./Inspector";
import { BuildProgress } from "./chat/BuildProgress";
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
import { STAIR_NAMES } from "./StructureInspector";
import { useDrawTools } from "./drawTools";
import { AREA_LOOK, FENCE_LOOK } from "../model/site";
import { AREA_KINDS, FENCE_STYLES, ROOF_TYPES } from "../model/schema";
import { ROOF_LOOK } from "../model/roofs";
import { LevelsSection } from "./LevelsSection";
import { levelsTopDown } from "../model/levels";
import { Welcome, OpenFolderDialog } from "./Welcome";
import { NewHomeDialog } from "./NewHome";
import { TraceGuide } from "./TraceGuide";
import { PlanNorthArrow, SunPanel } from "./SunPanel";
import { useSun } from "./sunState";
import { useLamps } from "./lampState";
import { LAMP_COLOURS, useLightEdit } from "./lightEdit";
import { kelvinColor } from "../three/LampLight";
import { ManageHomesDialog } from "./ManageHomes";
import { StructureInspector } from "./StructureInspector";
import { StructureLayer } from "./StructureLayer";
import { UnderlayPanel, UnderlayToolLayer } from "./UnderlayPanel";
import { MeasureLayer } from "./MeasureLayer";
import { ThemeCycleButton } from "./ThemeSwitch";
import { toggleUnitSystem, useUnitSystem } from "./unitPref";
import { HomeMenu, openHomeFromPicker } from "./HomeMenu";
import { AddToLibraryDialog, ExportImageDialog, OpenHomeDialog, SaveFileDialog } from "./HomeFileDialogs";
import { InstallDialog } from "./InstallDialog";
import { isHomeFile, requestOpenHome, saveHome } from "./homeFileActions";
import { isLibraryFile, openLibraryFileWithNotice } from "./libraryFiles";
import { WalkOverlay, WalkStartPicker } from "./WalkOverlay";
import {
  IconChat,
  IconClose,
  IconCompare,
  IconCube,
  IconCut,
  IconDoor,
  IconEyeOff,
  IconFurnish,
  IconLayers,
  IconSun,
  IconLamp,
  IconPlan,
  IconPlus,
  IconRedo,
  IconRoom,
  IconSelect,
  IconStairs,
  IconArea,
  IconFence,
  IconPlot,
  IconRoof,
  IconRuler,
  IconStructure,
  IconSwatch,
  IconUndo,
  IconWalk,
  IconWall,
  IconWindow,
  LogoMark,
} from "./icons";

function focusObject(object: SceneObject) {
  const s = useOdaja.getState();
  if (s.viewMode !== "3d") s.setViewMode("3d");
  const xs = object.parts.map((p) => p.at[0]);
  const ys = object.parts.map((p) => p.at[1]);
  const top = Math.max(0, ...object.parts.map((p) => p.at[2])) + object.elevation;
  const cx = object.position[0] + (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = object.position[1] + (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(80, Math.max(...xs) - Math.min(...xs) + 120, Math.max(...ys) - Math.min(...ys) + 120, top - object.elevation + 80);
  s.focusOn([cx / 100, (object.elevation + Math.max(40, top - object.elevation) / 2) / 100, cy / 100], span / 100);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = useOdaja.getState();
      if (e.key === "Escape" && state.presenting) {
        e.preventDefault();
        state.setPresenting(false);
        return;
      }
      const inputEl = e.target instanceof HTMLElement ? e.target.closest("input, textarea") : null;
      const nonTextInput = inputEl instanceof HTMLInputElement && /^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(inputEl.type);
      const typingText = e.target instanceof HTMLElement && (e.target.isContentEditable || (Boolean(inputEl) && !nonTextInput));
      const typing = typingText || (e.target instanceof HTMLElement && Boolean(e.target.closest("select")));
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "p" && state.status === "project") {
        e.preventDefault();
        if (!e.repeat) state.togglePresenting();
        return;
      }
      // Presentation is for inspection, not hidden editor shortcuts.
      if (state.presenting) return;
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
      if (typingText) return;
      const s = useOdaja.getState();
      if (s.status !== "project") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key.toLowerCase() === "z" || e.code === "KeyZ")) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && !e.shiftKey && (e.key.toLowerCase() === "y" || e.code === "KeyY")) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (typing) return;
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

      // PageUp / PageDown: the level above / below.
      if ((key === "pageup" || key === "pagedown") && s.wholeShell && !s.editingObjectId) {
        e.preventDefault();
        const levels = levelsTopDown(s.wholeShell);
        const i = levels.findIndex((l) => l.id === s.level);
        const next = levels[key === "pageup" ? i - 1 : i + 1];
        if (next) s.setLevel(next.id);
        return;
      }

      // While walking, the walk controls own the keyboard (W A S D Q E…);
      // only view switches, undo and Esc (letting go of the selection) apply.
      if (s.viewMode === "walk") {
        if (key === "t") s.setViewMode("plan");
        if (key === "escape" && s.selectedId && !document.pointerLockElement) s.select(null);
        return;
      }
      if (key === "escape" && s.pickingWalkStart) return s.setPickingWalkStart(false);
      if (key === "k") return s.viewMode === "plan" ? s.setPickingWalkStart(true) : s.startWalk(null);

      // Shared by both modes.
      if (key === "t") return s.setViewMode("plan");
      if (key === "e") return s.setMode(s.mode === "structure" ? "furnish" : "structure");
      if (key === "m" && !s.editingObjectId) return s.toggleMeasuring();

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
        const tools: Record<string, Tool> = { v: "select", w: "wall", r: "room", d: "door", n: "window", s: "stairs", o: "roof", a: "garden", f: "fence", b: "plot" };
        if (tools[key]) return s.setTool(tools[key]);
        if (key === "h") return s.toggleHideFurniture();
        if ((key === "delete" || key === "backspace") && s.structureSelection) {
          e.preventDefault();
          deleteStructureSelection();
        }
        return;
      }

      const selected = s.scene?.objects.find((o) => o.id === s.selectedId);
      const selectedLights = objectLights(selected);
      const activeLightIdx = Math.min(s.selectedLightIndex, Math.max(0, selectedLights.length - 1));
      const activeLight = selectedLights[activeLightIdx];
      if (selected && !selected.locked && (key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright")) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : e.altKey ? 20 : 5;
        const dx = key === "arrowright" ? step : key === "arrowleft" ? -step : 0;
        const dy = key === "arrowdown" ? step : key === "arrowup" ? -step : 0;
        if (s.objectGizmo === "light" && activeLight) {
          const writtenObj = s.sceneDoc?.objects?.find((o) => o.id === selected.id);
          const [lx, ly, lz] = activeLight.at;
          const nextAt: [number, number, number] = [round(lx + dx), ly, round(lz - dy)];
          if (writtenObj?.lights?.length) {
            const nextLights = writtenObj.lights.map((l, i) => (i === activeLightIdx ? { ...l, at: nextAt } : l));
            s.apply(setObjectProps(selected.id, { lights: nextLights }));
          } else {
            s.apply(setObjectProps(selected.id, { light: { ...writtenObj?.light, at: nextAt } }));
          }
          return;
        }
        if (s.objectGizmo === "target" && activeLight && activeLight.type !== "point") {
          const writtenObj = s.sceneDoc?.objects?.find((o) => o.id === selected.id);
          const [tx, ty, tz] = activeLight.target;
          const nextTarget: [number, number, number] = [round(tx + dx), round(ty + dy), tz];
          if (writtenObj?.lights?.length) {
            const nextLights = writtenObj.lights.map((l, i) => (i === activeLightIdx ? { ...l, target: nextTarget } : l));
            s.apply(setObjectProps(selected.id, { lights: nextLights }));
          } else {
            s.apply(setObjectProps(selected.id, { light: { ...writtenObj?.light, target: nextTarget } }));
          }
          return;
        }
        if (s.objectGizmo === "lift") {
          const nextElev = Math.max(0, round(selected.elevation - dy));
          const nextPos: [number, number] = [round(selected.position[0] + dx), selected.position[1]];
          s.apply(setObjectProps(selected.id, { position: nextPos, elevation: nextElev || undefined }));
          return;
        }
        const nextPos: [number, number] = [round(selected.position[0] + dx), round(selected.position[1] + dy)];
        s.apply(moveObject(selected.id, nextPos, { room: s.shell ? roomAt(s.shell, nextPos) : undefined }));
        return;
      }
      switch (key) {
        case "g":
          if (selected && !selected.locked && s.viewMode === "3d") s.setObjectGizmo(s.objectGizmo === "move" ? "lift" : "move");
          break;
        case "y":
          if (selected && !selected.locked && s.viewMode === "3d") s.setObjectGizmo("lift");
          break;
        case "l":
          if (selected && !selected.locked && activeLight && s.viewMode === "3d") {
            const next =
              s.objectGizmo === "light"
                ? activeLight.type !== "point"
                  ? "target"
                  : "move"
                : s.objectGizmo === "target"
                  ? "move"
                  : "light";
            s.setObjectGizmo(next);
          }
          break;
        case "f":
          if (selected) focusObject(selected);
          break;
        case "r":
          if (selected && !selected.locked) s.apply(rotateObject(selected.id, e.shiftKey ? 15 : 90));
          break;
        case "c":
          s.toggleWallsCut();
          break;
        case "escape":
          if (s.objectGizmo !== "move") s.setObjectGizmo("move");
          else s.select(null);
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

function UnitToggleButton() {
  const units = useUnitSystem();
  return (
    <button
      className="unit-toggle"
      onClick={toggleUnitSystem}
      title={units === "metric" ? "Units: Metric (cm / m²) — click for Imperial (ft / in)" : "Units: Imperial (ft / in) — click for Metric (cm / m²)"}
    >
      {units === "metric" ? "cm" : "ft"}
    </button>
  );
}

function Sidebar() {
  const scene = useOdaja((s) => s.scene);
  const shell = useOdaja((s) => s.shell);
  const selectedId = useOdaja((s) => s.selectedId);
  const select = useOdaja((s) => s.select);
  const structure = useOdaja((s) => s.mode === "structure");
  const editingShape = useOdaja((s) => s.editingObjectId !== null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyLamps, setOnlyLamps] = useState(false);
  const noWalls = useOdaja((s) => s.shell !== null && s.shell.walls.length === 0);

  const roomNames = new Map((shell?.rooms ?? []).map((r) => [r.id, r.name.toLowerCase()]));
  const q = query.trim().toLowerCase();
  const filteredObjects = (scene?.objects ?? []).filter((o) => {
    const hasLight = objectLights(o).length > 0;
    if (onlyLamps && !hasLight) return false;
    if (!q) return true;
    const roomName = o.room ? roomNames.get(o.room) ?? o.room.toLowerCase() : "";
    return (
      o.name.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      roomName.includes(q) ||
      (o.template?.toLowerCase().includes(q) ?? false) ||
      (hasLight && ("light".includes(q) || "lamp".includes(q)))
    );
  });

  return (
    <aside className="sidebar">
      <header className="brand">
        <span className="brand-logo mr-auto">
          <LogoMark />
          <span className="logo">Odaja</span>
        </span>
        <UnitToggleButton />
        <ThemeCycleButton />
      </header>

      <div className="shrink-0 border-b border-line bg-sheet px-3 py-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted shrink-0">Home</span>
        <HomeMenu />
      </div>

      <ScenesSection />
      {!editingShape && <LevelsSection />}

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
        ) : noWalls ? (
          <TraceGuide />
        ) : scene?.objects.length === 0 ? (
          <p className="muted empty-hint">An empty room. Add furniture, or ask the chat to furnish it.</p>
        ) : (
          <>
            <div className="list-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search objects, rooms, lamps…"
                aria-label="Search objects"
              />
              {query && (
                <button onClick={() => setQuery("")} title="Clear search">
                  ×
                </button>
              )}
              <button className={onlyLamps ? "active" : ""} onClick={() => setOnlyLamps(!onlyLamps)} title="Show only lamps">
                Lamps
              </button>
            </div>
            {filteredObjects.length === 0 ? (
              <p className="muted empty-hint">No matching objects.</p>
            ) : (
              <ul className="list">
                {filteredObjects.map((o) => (
                  <li key={o.id}>
                    <button
                      className={o.id === selectedId ? "active" : ""}
                      onClick={() => select(o.id)}
                      onDoubleClick={() => {
                        select(o.id);
                        focusObject(o);
                      }}
                      title="Click to select · Double-click to focus in 3D"
                    >
                      <span>
                        {objectLights(o).length > 0 && <span className="lamp-dot" />}
                        {o.name}
                      </span>
                      <span className="muted">{o.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <Inspector />
        </>
      )}

      {platform.cloud && <CloudAccountFooter />}
    </aside>
  );
}

function RoomsSection() {
  const shell = useOdaja((s) => s.shell);
  const selection = useOdaja((s) => s.structureSelection);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const [query, setQuery] = useState("");
  if (!shell) return <section className="grow" />;
  const isSelected = (kind: string, id: string) => selection?.kind === kind && "id" in selection && selection.id === id;
  const q = query.trim().toLowerCase();
  const matches = (...fields: (string | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q));
  const rooms = shell.rooms.filter((r) => matches(r.name, r.id));
  const walls = shell.walls.filter((w) => matches(w.id, `${w.thickness} cm`));
  const areas = shell.areas.filter((a) => matches(a.name, a.id, AREA_LOOK[a.kind].label));
  const fences = shell.fences.filter((f) => matches(f.id, FENCE_LOOK[f.style].label));
  const roofs = shell.roofs.filter((r) => matches(r.id, ROOF_LOOK[r.type].label));
  const stairs = shell.stairs.filter((s) => matches(s.id, STAIR_NAMES[s.type]));
  return (
    <section className="grow">
      <div className="list-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rooms, walls, stairs…" aria-label="Search structure elements" />
        {query && (
          <button onClick={() => setQuery("")} title="Clear search">
            ×
          </button>
        )}
      </div>
      <h2>Rooms</h2>
      {shell.rooms.length === 0 ? (
        <p className="muted empty-hint">No rooms yet. Draw walls, then click inside an enclosed area and choose Make room.</p>
      ) : (
        <ul className="list">
          {rooms.map((r) => (
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
        {walls.map((w) => (
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
      {(shell.plot || areas.length > 0 || fences.length > 0) && (
        <>
          <h2 className="spaced">Garden</h2>
          <ul className="list">
            {shell.plot && matches("plot") && (
              <li>
                <button className={isSelected("plot", "plot") ? "active" : ""} onClick={() => selectStructure({ kind: "plot", id: "plot" })}>
                  Plot
                </button>
              </li>
            )}
            {areas.map((a) => (
              <li key={a.id}>
                <button className={isSelected("garden", a.id) ? "active" : ""} onClick={() => selectStructure({ kind: "garden", id: a.id })}>
                  {a.name}
                  <span className="muted">{AREA_LOOK[a.kind].label}</span>
                </button>
              </li>
            ))}
            {fences.map((f) => (
              <li key={f.id}>
                <button className={isSelected("fence", f.id) ? "active" : ""} onClick={() => selectStructure({ kind: "fence", id: f.id })}>
                  {f.id}
                  <span className="muted">{FENCE_LOOK[f.style].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {roofs.length > 0 && (
        <>
          <h2 className="spaced">Roofs</h2>
          <ul className="list">
            {roofs.map((r) => (
              <li key={r.id}>
                <button className={isSelected("roof", r.id) ? "active" : ""} onClick={() => selectStructure({ kind: "roof", id: r.id })}>
                  {r.id}
                  <span className="muted">{ROOF_LOOK[r.type].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {stairs.length > 0 && (
        <>
          <h2 className="spaced">Stairs</h2>
          <ul className="list">
            {stairs.map((s) => (
              <li key={s.id}>
                <button className={isSelected("stair", s.id) ? "active" : ""} onClick={() => selectStructure({ kind: "stair", id: s.id })}>
                  {s.id}
                  <span className="muted">{STAIR_NAMES[s.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
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
  { tool: "stairs", label: "Stairs", key: "S", Icon: IconStairs },
  { tool: "roof", label: "Roof", key: "O", Icon: IconRoof },
  { tool: "garden", label: "Area", key: "A", Icon: IconArea },
  { tool: "fence", label: "Fence", key: "F", Icon: IconFence },
  { tool: "plot", label: "Plot", key: "B", Icon: IconPlot },
];

function StructureToolbar() {
  const tool = useOdaja((s) => s.tool);
  const setTool = useOdaja((s) => s.setTool);
  const thickness = useOdaja((s) => s.wallThickness);
  const setThickness = useOdaja((s) => s.setWallThickness);
  const hideFurniture = useOdaja((s) => s.hideFurniture);
  const toggleHideFurniture = useOdaja((s) => s.toggleHideFurniture);
  const { kind: gardenKind, style: fenceStyle, roof: roofType, setKind: setGardenKind, setStyle: setFenceStyle, setRoof: setRoofType } = useDrawTools();
  return (
    <div className="toolbar secondary">
      <div className="seg">
        {/* Only the active tool is labelled, so all of them fit. */}
        {TOOLS.map(({ tool: id, label, key, Icon }) => (
          <button key={id} className={tool === id ? "active" : ""} onClick={() => setTool(id)} title={`${label} (${key})`} aria-label={label}>
            <Icon size={16} />
            {tool === id && label}
          </button>
        ))}
      </div>
      <span className="sep" />
      {tool === "roof" ? (
        <label className="inline-field" title="What new roofs are">
          Type
          <select value={roofType} onChange={(e) => setRoofType(e.target.value as typeof roofType)}>
            {ROOF_TYPES.map((k) => (
              <option key={k} value={k}>
                {ROOF_LOOK[k].label}
              </option>
            ))}
          </select>
        </label>
      ) : tool === "garden" ? (
        <label className="inline-field" title="What new areas are">
          Kind
          <select value={gardenKind} onChange={(e) => setGardenKind(e.target.value as typeof gardenKind)}>
            {AREA_KINDS.map((k) => (
              <option key={k} value={k}>
                {AREA_LOOK[k].label}
              </option>
            ))}
          </select>
        </label>
      ) : tool === "fence" ? (
        <label className="inline-field" title="What new fences are">
          Style
          <select value={fenceStyle} onChange={(e) => setFenceStyle(e.target.value as typeof fenceStyle)}>
            {FENCE_STYLES.map((k) => (
              <option key={k} value={k}>
                {FENCE_LOOK[k].label}
              </option>
            ))}
          </select>
        </label>
      ) : (
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
      )}
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
  const measuring = useOdaja((s) => s.measuring);
  const toggleMeasuring = useOdaja((s) => s.toggleMeasuring);
  const showChanges = useOdaja((s) => s.showChanges);
  const sunOn = useSun((s) => s.on);
  const setSunOn = useSun((s) => s.setOn);
  const lampsOn = useLamps((s) => s.on);
  const setLampsOn = useLamps((s) => s.setOn);
  const toggleShowChanges = useOdaja((s) => s.toggleShowChanges);
  const hasRoofs = useOdaja((s) => (s.wholeShell?.roofs.length ?? 0) > 0);
  const showRoofs = useOdaja((s) => s.showRoofs);
  const toggleRoofs = useOdaja((s) => s.toggleRoofs);

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
        <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")} title="3D view">
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
      {viewMode === "3d" && hasRoofs && (
        <button className={`icon-only ${showRoofs ? "active" : ""}`} onClick={toggleRoofs} title="Show the roof (hide it to look inside)">
          <IconRoof size={17} />
        </button>
      )}
      {viewMode === "plan" && (
        <button className={`icon-only ${underlayOpen ? "active" : ""}`} onClick={() => setUnderlayPanel(!underlayOpen)} title="Floor plan background: an image under the plan, to check and trace walls">
          <IconLayers size={17} />
        </button>
      )}
      {viewMode !== "walk" && (
        <button className={`icon-only ${measuring ? "active" : ""}`} onClick={toggleMeasuring} title="Tape measure: click two points to measure distance (M)">
          <IconRuler size={17} />
        </button>
      )}
      <button
        className={`icon-only ${sunOn ? "active" : ""}`}
        onClick={() => {
          setSunOn(!sunOn);
          if (!sunOn) useOdaja.getState().setUnderlayPanel(false);
        }}
        title="Sunlight: the real sun and moon for a day and time, through your windows"
      >
        <IconSun size={17} />
      </button>
      {viewMode !== "plan" && (
        <button
          className={`icon-only ${lampsOn ? "active" : ""}`}
          onClick={() => {
            setLampsOn(!lampsOn);
            if (!lampsOn) {
              useOdaja.getState().setUnderlayPanel(false);
              useOdaja.getState().setNotice(
                sunOn
                  ? "Lamps on. In daylight they're faint, as they are; pick an evening time in Sunlight to see them light the room. With many lamps the view can get slow."
                  : "Lamps on. With many lamps the view can get slow; turn them off if it lags.",
              );
            }
          }}
          title="Lamps: light the room with the lamps that are on"
        >
          <IconLamp size={17} />
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
      <span className="sep" />
      <ChatToggle />
      <button onClick={() => useOdaja.getState().setPresenting(true)} title="Present the home without editor panels (P)" aria-keyshortcuts="P">
        Present
      </button>
    </div>
  );
}

// The selected object, at the bottom of the 3D view: its handles (3D only;
// in Walk dragging looks around) and, for a lamp, on/off, colour and brightness.
function SelectionGizmoBar() {
  const viewMode = useOdaja((s) => s.viewMode);
  const mode = useOdaja((s) => s.mode);
  const measuring = useOdaja((s) => s.measuring);
  const editingObjectId = useOdaja((s) => s.editingObjectId);
  const gizmo = useOdaja((s) => s.objectGizmo);
  const setGizmo = useOdaja((s) => s.setObjectGizmo);
  const object = useOdaja((s) => s.scene?.objects.find((o) => o.id === s.selectedId));
  // Every hook before the early return: React needs the same hooks each render.
  const selectedLightIndex = useOdaja((s) => s.selectedLightIndex);
  if ((viewMode !== "3d" && viewMode !== "walk") || mode !== "furnish" || measuring || editingObjectId || !object) return null;
  const lights = objectLights(object);
  const activeLight = lights[Math.min(selectedLightIndex, Math.max(0, lights.length - 1))];
  const hasLight = lights.length > 0;
  const hasAim = Boolean(activeLight && activeLight.type !== "point");
  const handles = viewMode === "3d" && !object.locked;
  return (
    <div className={`gizmo-pill ${viewMode === "walk" ? "walking" : ""}`} role="toolbar" aria-label={`${object.name}: handles and lamp`}>
      <span className="gizmo-pill-name">{object.name}</span>
      {handles && (
        <>
          <button className={gizmo === "move" ? "active" : ""} onClick={() => setGizmo("move")} title="Move horizontally (G)">
            Move
          </button>
          <button className={gizmo === "lift" ? "active" : ""} onClick={() => setGizmo("lift")} title="Move in 3D + height (Y)">
            Lift
          </button>
          <button className={gizmo === "rotate" ? "active" : ""} onClick={() => setGizmo("rotate")} title="Rotate handle (R turns 90°)">
            Rotate
          </button>
          {hasLight && (
            <button className={gizmo === "light" ? "active" : ""} onClick={() => setGizmo("light")} title="Position light emitter in 3D (L)">
              {lights.length > 1 ? `Bulb #${Math.min(selectedLightIndex, lights.length - 1) + 1}` : "Bulb"}
            </button>
          )}
          {hasAim && (
            <button className={gizmo === "target" ? "active" : ""} onClick={() => setGizmo("target")} title="Aim light direction in 3D (L)">
              Aim
            </button>
          )}
        </>
      )}
      {viewMode === "3d" && (
        <button onClick={() => focusObject(object)} title="Focus camera on selected object (F)">
          Focus
        </button>
      )}
      {hasLight && <LampControls object={object} />}
    </div>
  );
}

const LAMP_DOTS = LAMP_COLOURS.map(({ kelvin, name }) => ({ kelvin, label: `${name}, ${kelvin} K`, css: kelvinColor(kelvin).getStyle() }));

// A lamp's switch, colour and brightness. Switching a lamp on also turns the
// lamps on in the view, so you see it.
function LampControls({ object }: { object: SceneObject }) {
  const { light, set } = useLightEdit(object);
  const lampsOn = useLamps((s) => s.on);
  const setLampsOn = useLamps((s) => s.setOn);
  // The slider moves freely and saves once, when let go (one undo step).
  const [lumens, setLumens] = useState(light?.lumens ?? 0);
  useEffect(() => setLumens(light?.lumens ?? 0), [light?.lumens]);
  if (!light) return null;
  const commit = () => {
    if (lumens !== light.lumens) set({ lumens });
  };
  return (
    <>
      <span className="gizmo-sep" />
      <button
        className={light.on ? "active" : ""}
        onClick={() => {
          set({ on: !light.on });
          if (!light.on && !lampsOn) setLampsOn(true);
        }}
        title={light.on ? "Switch this lamp off" : "Switch this lamp on"}
      >
        <IconLamp size={15} /> {light.on ? "On" : "Off"}
      </button>
      <span className="lamp-colours">
        {LAMP_DOTS.map(({ kelvin, label, css }) => (
          <button
            key={kelvin}
            className={`lamp-colour ${light.kelvin === kelvin ? "active" : ""}`}
            style={{ background: css }}
            onClick={() => set({ kelvin })}
            title={label}
            aria-label={label}
          />
        ))}
      </span>
      <label className="lamp-brightness" title="Brightness, in lumens (a 60 W bulb is about 800)">
        <input
          type="range"
          min={50}
          max={Math.max(5000, light.lumens)}
          step={50}
          value={lumens}
          onChange={(e) => setLumens(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span>{lumens} lm</span>
      </label>
    </>
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
  if (dialog?.kind === "install") return <InstallDialog />;
  if (dialog?.kind === "new-home") return <NewHomeDialog />;
  if (dialog?.kind === "open-folder") return <OpenFolderDialog />;
  if (dialog?.kind === "manage-homes") return <ManageHomesDialog />;
  if (dialog?.kind === "history") return <HistoryDialog />;
  if (dialog?.kind === "usage") return <UsageDialog />;
  if (dialog?.kind === "admin") return <AdminDialog />;
  if (dialog?.kind === "add-to-library") return <AddToLibraryDialog items={dialog.items} />;
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
        const libraryFiles = files.filter(isLibraryFile);
        if (home) requestOpenHome({ file: home });
        else if (libraryFiles.length) libraryFiles.forEach((f) => openLibraryFileWithNotice(f));
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
  const presenting = useOdaja((s) => s.presenting);
  const editingStructure = useOdaja((s) => s.mode === "structure" && s.viewMode === "plan");
  const measuring3D = useOdaja((s) => s.measuring && s.viewMode === "3d");
  useEffect(() => {
    load();
  }, [load]);
  useShortcuts();

  if (status === "loading") return null;
  if (status === "start") return (
    <>
      <Welcome />
      <SignInWindow />
    </>
  );
  return (
    <>
    <SignInWindow />
    <div className={`app${presenting ? " presenting" : ""}`}>
      {!presenting && <Sidebar />}
      <main className={`viewport ${drop.over ? "drop-over" : ""}`} {...drop.handlers}>
        <Viewport />
        <PreparingIndicator />
        {presenting ? (
          <button className="presentation-exit" onClick={() => useOdaja.getState().setPresenting(false)} title="Exit presentation (Esc)" aria-keyshortcuts="Escape">
            <IconClose size={15} />
            Exit presentation
            <kbd>Esc</kbd>
          </button>
        ) : (
          <>
        <PlanOverlay />
        {editingStructure && <StructureLayer />}
        <UnderlayToolLayer />
        <MeasureLayer />
        {measuring3D && <div className="measure-hint">Click two surfaces to measure · Drag to orbit · Shift locks vertical/horizontal · Esc clears</div>}
        <SelectionGizmoBar />
        <UnderlayPanel />
        <SunPanel />
        <PlanNorthArrow />
        <WalkStartPicker />
        <WalkOverlay />
        <div className="toolbars">
          <Toolbar />
          {editingStructure && <StructureToolbar />}
        </div>
        <Notice />
        <BuildProgress />
        <IssuesPanel />
        <Errors />
          </>
        )}
      </main>
      {!presenting && chatOpen && <ChatPanel />}
      {!presenting && <Dialogs />}
    </div>
    </>
  );
}
