// Interactive layer over the plan in Structure mode: drawing walls and rooms,
// placing doors, windows and stairs, drawing the garden (outdoor areas, the
// plot, fences), selecting and dragging walls, corners, openings, stairs,
// areas and fences. It also handles pan and zoom while it's active (scroll to zoom,
// right-drag, middle-drag or space+drag to pan).
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  dist,
  doorSwing,
  fitOpening,
  freeSpans,
  formatCm,
  pointInPolygon,
  pointOnWall,
  projectOnWall,
  wallLength,
  wallOutline,
  type Vec,
} from "../model/geometry";
import { riseFrom } from "../model/levels";
import { enclosedArea } from "../model/rooms";
import { addStair, defaultStairSize, stairOutline, updateStair } from "../model/stairs";
import { addArea, addFences, AREA_LOOK, fenceOutlines, fenceThickness, moveArea, moveFence, setPlot, updateArea, updateFence } from "../model/site";
import { useDrawTools } from "./drawTools";
import { addRoof, roofOutline, updateRoof } from "../model/roofs";
import { ShellSchema, type Opening, type Shell, type ShellDoc, type Wall } from "../model/schema";
import { addOpening, addRectRoom, addWalls, moveCorner, moveWall, OPENING_DEFAULTS, updateOpening } from "../model/shellOps";
import { snapPoint, type Snap } from "../model/snap";
import { M } from "../model/units";
import { useOdaja, type PlanView } from "../store";
import { panBy, zoomAt } from "../three/planCamera";

const SNAP_PX = 10;
const HIT_PX = 6;
const DRAG_PX = 3;

type Drag =
  | { kind: "pan"; x: number; y: number }
  | { kind: "corner"; point: Vec; startX: number; startY: number; moved: boolean; preview: ShellDoc | null }
  | { kind: "wall"; id: string; start: Vec; startX: number; startY: number; moved: boolean; preview: ShellDoc | null }
  | { kind: "opening"; id: string; grab: number; startX: number; startY: number; moved: boolean; preview: ShellDoc | null }
  | { kind: "stair"; id: string; start: Vec; origin: Vec; startX: number; startY: number; moved: boolean; preview: ShellDoc | null }
  | { kind: "shift"; target: "garden" | "fence"; id: string; start: Vec; startX: number; startY: number; moved: boolean; preview: ShellDoc | null }
  | { kind: "vertex"; target: Shaped; index: number; startX: number; startY: number; moved: boolean; preview: ShellDoc | null }
  | { kind: "click"; startX: number; startY: number };

type Hit = { kind: "wall" | "opening" | "room" | "stair" | "roof" | "garden" | "fence" | "plot"; id: string } | { kind: "area"; polygon: Vec[] } | null;

// The selected thing whose corners can be dragged: an area, the plot, a
// roof (its outline), or a fence (its two ends).
type Shaped = { kind: "garden" | "plot" | "roof" | "fence"; id: string };

function cornersOf(shell: Shell, t: Shaped): Vec[] | null {
  if (t.kind === "garden") return shell.areas.find((a) => a.id === t.id)?.polygon ?? null;
  if (t.kind === "roof") return shell.roofs.find((r) => r.id === t.id)?.polygon ?? null;
  if (t.kind === "plot") return shell.plot?.polygon ?? null;
  const f = shell.fences.find((x) => x.id === t.id);
  return f ? [f.from, f.to] : null;
}

// The same thing with new corners.
function withCorners(t: Shaped, corners: Vec[]) {
  if (t.kind === "garden") return updateArea(t.id, { polygon: corners });
  if (t.kind === "roof") return updateRoof(t.id, { polygon: corners });
  if (t.kind === "plot") return setPlot(corners);
  return updateFence(t.id, { from: corners[0], to: corners[1] });
}

const round1 = (p: Vec): Vec => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];

// Distance from a point to a segment.
function toSegment(p: Vec, a: Vec, b: Vec): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

const nearOutline = (p: Vec, poly: Vec[], tol: number) => poly.some((a, i) => toSegment(p, a, poly[(i + 1) % poly.length]) <= tol);

function useProjection(view: PlanView | null) {
  return useMemo(() => {
    if (!view) return null;
    const pxPerCm = view.zoom / 100;
    return {
      pxPerCm,
      toScreen: ([x, y]: Vec): Vec => [(M(x) - view.centerX) * view.zoom + view.width / 2, (M(y) - view.centerZ) * view.zoom + view.height / 2],
      toPlan: (sx: number, sy: number): Vec => [
        ((sx - view.width / 2) / view.zoom + view.centerX) * 100,
        ((sy - view.height / 2) / view.zoom + view.centerZ) * 100,
      ],
    };
  }, [view]);
}

function hitTest(shell: Shell, p: Vec, tol: number): Hit {
  for (const o of shell.openings) {
    const wall = shell.walls.find((w) => w.id === o.wall);
    if (!wall) continue;
    const proj = projectOnWall(wall, p);
    if (proj.along >= o.offset && proj.along <= o.offset + o.width && proj.across <= wall.thickness / 2 + tol) {
      return { kind: "opening", id: o.id };
    }
  }
  let best: { id: string; d: number } | null = null;
  for (const wall of shell.walls) {
    const proj = projectOnWall(wall, p);
    if (proj.across <= wall.thickness / 2 + tol && (!best || proj.across < best.d)) best = { id: wall.id, d: proj.across };
  }
  if (best) return { kind: "wall", id: best.id };
  const stair = [...shell.stairs].reverse().find((s) => pointInPolygon(p, stairOutline(s)));
  if (stair) return { kind: "stair", id: stair.id };
  const fence = shell.fences.find((f) => toSegment(p, f.from, f.to) <= fenceThickness(f) / 2 + tol);
  if (fence) return { kind: "fence", id: fence.id };
  // A roof by its eaves (dashed on the plan).
  const roof = shell.roofs.find((r) => nearOutline(p, roofOutline(r), tol));
  if (roof) return { kind: "roof", id: roof.id };
  if (shell.plot && nearOutline(p, shell.plot.polygon, tol)) return { kind: "plot", id: "plot" };
  const room = [...shell.rooms].reverse().find((r) => pointInPolygon(p, r.polygon));
  if (room) return { kind: "room", id: room.id };
  const garden = [...shell.areas].reverse().find((a) => pointInPolygon(p, a.polygon));
  if (garden) return { kind: "garden", id: garden.id };
  const area = enclosedArea(shell, p);
  if (area) return { kind: "area", polygon: area };
  return shell.plot && pointInPolygon(p, shell.plot.polygon) ? { kind: "plot", id: "plot" } : null;
}

const pts = (points: Vec[]) => points.map((p) => p.join(",")).join(" ");

export function StructureLayer() {
  const view = useOdaja((s) => s.planView);
  const shell = useOdaja((s) => s.shell);
  const shellDoc = useOdaja((s) => s.shellDoc);
  const tool = useOdaja((s) => s.tool);
  const thickness = useOdaja((s) => s.wallThickness);
  const selection = useOdaja((s) => s.structureSelection);
  const applyShell = useOdaja((s) => s.applyShell);
  const selectStructure = useOdaja((s) => s.selectStructure);
  const setTool = useOdaja((s) => s.setTool);
  // How high a new stair on this level climbs, for its size.
  const rise = useOdaja((s) => (s.wholeShell ? riseFrom(s.wholeShell, s.level) : 280));
  const proj = useProjection(view);

  const [cursor, setCursor] = useState<Vec | null>(null); // raw plan position
  const [chain, setChain] = useState<Vec[]>([]); // wall tool: points placed so far
  const [rectStart, setRectStart] = useState<Vec | null>(null);
  const [typed, setTyped] = useState("");
  const [drag, setDragState] = useState<Drag | null>(null);
  // Handlers read the drag from a ref: pointer events can arrive before React
  // re-renders with the latest state.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [hover, setHover] = useState<Hit>(null);
  const space = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Reset drawing state when the tool changes.
  useEffect(() => {
    setChain([]);
    setRectStart(null);
    setTyped("");
  }, [tool]);

  const radius = proj ? SNAP_PX / proj.pxPerCm : 10;
  const snap: Snap | null = useMemo(() => {
    if (!cursor || !shell) return null;
    if (tool === "wall" || tool === "fence" || tool === "garden" || tool === "plot" || tool === "roof") return snapPoint(cursor, shell, radius, chain.at(-1));
    if (tool === "room") return snapPoint(cursor, shell, radius, undefined);
    return null;
  }, [cursor, shell, tool, chain, radius]);

  // Wall the door/window tool would place on.
  const openingPreview = useMemo(() => {
    if (!cursor || !shell || (tool !== "door" && tool !== "window")) return null;
    let best: { wall: Wall; along: number; across: number } | null = null;
    for (const wall of shell.walls) {
      const p = projectOnWall(wall, cursor);
      if (p.across <= wall.thickness / 2 + radius * 2 && (!best || p.across < best.across)) best = { wall, along: p.along, across: p.across };
    }
    if (!best) return null;
    const width = OPENING_DEFAULTS[tool].width;
    const offset = fitOpening(best.wall, shell, best.along - width / 2, width);
    if (offset === null) return { wall: best.wall, offset: null, width };
    const span = freeSpans(best.wall, shell).find(([a, b]) => offset >= a - 0.01 && offset + width <= b + 0.01);
    return { wall: best.wall, offset, width, span };
  }, [cursor, shell, tool, radius]);

  const commitWall = (from: Vec, to: Vec) => applyShell(tool === "fence" ? addFences([from, to], { style: useDrawTools.getState().style }) : addWalls([from, to], thickness));
  const chainTool = tool === "wall" || tool === "fence";
  const polygonTool = tool === "garden" || tool === "plot" || tool === "roof";

  // Close the polygon being drawn into an outdoor area, the plot or a roof.
  const closePolygon = (points: Vec[]) => {
    setChain([]);
    setTyped("");
    if (points.length < 3) return;
    const before = new Set([...(shell?.areas ?? []), ...(shell?.roofs ?? [])].map((a) => a.id));
    const { kind, roof } = useDrawTools.getState();
    const change = tool === "plot" ? setPlot(points) : tool === "roof" ? addRoof({ type: roof, polygon: points }) : addArea({ name: AREA_LOOK[kind].label, kind, polygon: points });
    applyShell(change).then(() => {
      setTool("select");
      if (tool === "plot") return selectStructure({ kind: "plot", id: "plot" });
      const s = useOdaja.getState().shell;
      const added = tool === "roof" ? s?.roofs.find((r) => !before.has(r.id)) : s?.areas.find((a) => !before.has(a.id));
      if (added) selectStructure({ kind: tool === "roof" ? "roof" : "garden", id: added.id });
    });
  };

  // Next point along the current wall direction at a typed length.
  const typedPoint = (from: Vec): Vec | null => {
    const len = parseFloat(typed.replace(",", "."));
    const target = snap?.point ?? cursor;
    if (!(len > 0) || !target || dist(from, target) < 0.01) return null;
    const d = dist(from, target);
    return [from[0] + ((target[0] - from[0]) / d) * len, from[1] + ((target[1] - from[1]) / d) * len];
  };

  // Rectangle corner from typed inside sizes ("420x330"), towards the cursor.
  const typedRect = (from: Vec): Vec | null => {
    const m = typed.replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*[x× ]\s*(\d+(?:\.\d+)?)$/i);
    if (!m || !cursor) return null;
    const sx = Math.sign(cursor[0] - from[0]) || 1;
    const sy = Math.sign(cursor[1] - from[1]) || 1;
    return [from[0] + sx * (Number(m[1]) + thickness), from[1] + sy * (Number(m[2]) + thickness)];
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " ") {
        space.current = e.type === "keydown";
        return;
      }
      if (e.type !== "keydown") return;
      const drawing = ((chainTool || polygonTool) && chain.length > 0) || (tool === "room" && rectStart);
      if (drawing && /^[0-9.,x× ]$/i.test(e.key)) {
        setTyped((t) => t + e.key);
        e.preventDefault();
        e.stopPropagation();
      } else if (drawing && e.key === "Backspace" && typed) {
        setTyped((t) => t.slice(0, -1));
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Enter") {
        if (polygonTool && chain.length > 0) {
          const p = typed ? typedPoint(chain.at(-1)!) : null;
          if (p) {
            setChain([...chain, p]);
            setTyped("");
          } else closePolygon(chain);
        } else if (chainTool && chain.length > 0) {
          const p = typed ? typedPoint(chain.at(-1)!) : null;
          if (p) {
            commitWall(chain.at(-1)!, p);
            setChain([...chain, p]);
          } else {
            setChain([]);
          }
          setTyped("");
        } else if (tool === "room" && rectStart) {
          const b = typedRect(rectStart);
          if (b) {
            applyShell(addRectRoom(rectStart, b, thickness));
            setRectStart(null);
          }
          setTyped("");
        }
      } else if (e.key === "Escape") {
        if (typed) setTyped("");
        else if (chain.length > 0) setChain([]);
        else if (rectStart) setRectStart(null);
        else if (drag) setDrag(null);
        else if (tool !== "select") setTool("select");
        else selectStructure(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  });

  // Scroll to zoom. Attached natively so preventDefault works (React's
  // wheel listener is passive).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top, view.width, view.height);
      } else {
        panBy(-e.deltaX, -e.deltaY);
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [view]);

  if (!proj || !view || !shell || !shellDoc) return null;
  const { toScreen, toPlan } = proj;
  const tol = HIT_PX / proj.pxPerCm;

  const local = (e: ReactPointerEvent): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const selectedWall = selection?.kind === "wall" ? shell.walls.find((w) => w.id === selection.id) : undefined;
  const shaped: Shaped | null = selection && (selection.kind === "garden" || selection.kind === "plot" || selection.kind === "roof" || selection.kind === "fence") ? { kind: selection.kind, id: selection.id } : null;
  const corners = shaped ? cornersOf(shell, shaped) : null;
  const cornerAt = (sx: number, sy: number) => (corners ? corners.findIndex((c) => dist(toScreen(c), [sx, sy]) <= 8) : -1);

  const onPointerDown = (e: ReactPointerEvent) => {
    const [sx, sy] = local(e);
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone; dragging still works while over the layer.
    }
    if (e.button === 1 || e.button === 2 || space.current) {
      setDrag({ kind: "pan", x: sx, y: sy });
      return;
    }
    if (e.button !== 0) return;
    const p = toPlan(sx, sy);
    if (tool === "select") {
      // Corner handles of the selected wall.
      if (selectedWall) {
        for (const end of [selectedWall.from, selectedWall.to]) {
          if (dist(toScreen(end), [sx, sy]) <= 8) {
            setDrag({ kind: "corner", point: end, startX: sx, startY: sy, moved: false, preview: null });
            return;
          }
        }
      }
      // Corner handles of the selected area, plot, roof or fence.
      const corner = cornerAt(sx, sy);
      if (shaped && corner >= 0) {
        setDrag({ kind: "vertex", target: shaped, index: corner, startX: sx, startY: sy, moved: false, preview: null });
        return;
      }
      const hit = hitTest(shell, p, tol);
      if (hit?.kind === "wall") {
        selectStructure(hit);
        setDrag({ kind: "wall", id: hit.id, start: p, startX: sx, startY: sy, moved: false, preview: null });
        return;
      }
      if (hit?.kind === "garden" || hit?.kind === "fence") {
        selectStructure(hit);
        setDrag({ kind: "shift", target: hit.kind, id: hit.id, start: p, startX: sx, startY: sy, moved: false, preview: null });
        return;
      }
      if (hit?.kind === "stair") {
        selectStructure(hit);
        const stair = shell.stairs.find((x) => x.id === hit.id)!;
        setDrag({ kind: "stair", id: hit.id, start: p, origin: stair.position, startX: sx, startY: sy, moved: false, preview: null });
        return;
      }
      if (hit?.kind === "opening") {
        selectStructure(hit);
        const o = shell.openings.find((x) => x.id === hit.id)!;
        const wall = shell.walls.find((w) => w.id === o.wall)!;
        setDrag({ kind: "opening", id: hit.id, grab: projectOnWall(wall, p).along - o.offset, startX: sx, startY: sy, moved: false, preview: null });
        return;
      }
    }
    setDrag({ kind: "click", startX: sx, startY: sy });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const [sx, sy] = local(e);
    const p = toPlan(sx, sy);
    setCursor(p);
    const drag = dragRef.current;
    if (!drag) {
      if (tool === "select") setHover(hitTest(shell, p, tol));
      return;
    }
    if (drag.kind === "pan") {
      panBy(sx - drag.x, sy - drag.y);
      setDrag({ ...drag, x: sx, y: sy });
      return;
    }
    if (drag.kind === "click") return;
    const moved = drag.moved || Math.hypot(sx - drag.startX, sy - drag.startY) > DRAG_PX;
    if (!moved) return;
    if (drag.kind === "corner") {
      const others = { ...shell, walls: shell.walls.filter((w) => dist(w.from, drag.point) > 0.5 && dist(w.to, drag.point) > 0.5) };
      const target = snapPoint(p, others, SNAP_PX / proj.pxPerCm).point;
      const preview = moveCorner(drag.point, target)(shellDoc);
      setDrag({ ...drag, moved, preview: preview === shellDoc ? drag.preview : preview });
    } else if (drag.kind === "wall") {
      const wall = shell.walls.find((w) => w.id === drag.id)!;
      const len = wallLength(wall);
      const n: Vec = [-(wall.to[1] - wall.from[1]) / len, (wall.to[0] - wall.from[0]) / len];
      const along = Math.round((p[0] - drag.start[0]) * n[0] + (p[1] - drag.start[1]) * n[1]);
      const preview = moveWall(drag.id, [n[0] * along, n[1] * along])(shellDoc);
      setDrag({ ...drag, moved, preview: preview === shellDoc ? drag.preview : preview });
    } else if (drag.kind === "vertex") {
      const now = cornersOf(shell, drag.target);
      if (!now) return;
      const target = round1(snapPoint(p, shell, SNAP_PX / proj.pxPerCm).point);
      const preview = withCorners(drag.target, now.map((c, i) => (i === drag.index ? target : c)))(shellDoc);
      setDrag({ ...drag, moved, preview: preview === shellDoc ? drag.preview : preview });
    } else if (drag.kind === "shift") {
      const by: Vec = [Math.round(p[0] - drag.start[0]), Math.round(p[1] - drag.start[1])];
      const preview = (drag.target === "garden" ? moveArea(drag.id, by) : moveFence(drag.id, by))(shellDoc);
      setDrag({ ...drag, moved, preview: preview === shellDoc ? drag.preview : preview });
    } else if (drag.kind === "stair") {
      const position: Vec = [Math.round(drag.origin[0] + p[0] - drag.start[0]), Math.round(drag.origin[1] + p[1] - drag.start[1])];
      const preview = updateStair(drag.id, { position })(shellDoc);
      setDrag({ ...drag, moved, preview: preview === shellDoc ? drag.preview : preview });
    } else if (drag.kind === "opening") {
      const o = shell.openings.find((x) => x.id === drag.id)!;
      const wall = shell.walls.find((w) => w.id === o.wall)!;
      const offset = Math.round(projectOnWall(wall, p).along - drag.grab);
      const preview = updateOpening(drag.id, { offset })(shellDoc);
      setDrag({ ...drag, moved, preview: preview === shellDoc ? drag.preview : preview });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const [sx, sy] = local(e);
    const d = dragRef.current;
    setDrag(null);
    if (!d || d.kind === "pan") return;
    if (d.kind !== "click" && d.moved) {
      if (d.preview) {
        const preview = d.preview;
        applyShell(() => preview);
      }
      return;
    }
    if (Math.hypot(sx - d.startX, sy - d.startY) > DRAG_PX) return;
    onClick(toPlan(sx, sy));
  };

  const onClick = (p: Vec) => {
    if (tool === "select") {
      const hit = hitTest(shell, p, tol);
      selectStructure(hit);
    } else if (polygonTool) {
      const point = snap?.point ?? p;
      const target = typed && chain.length ? (typedPoint(chain.at(-1)!) ?? point) : point;
      setTyped("");
      // Clicking the first point again closes the shape.
      if (chain.length >= 3 && dist(target, chain[0]) <= radius) return closePolygon(chain);
      if (chain.length && dist(target, chain.at(-1)!) < 1) return;
      setChain([...chain, target]);
    } else if (chainTool) {
      const point = snap?.point ?? p;
      if (chain.length === 0) {
        setChain([point]);
      } else {
        const last = chain.at(-1)!;
        const target = typed ? (typedPoint(last) ?? point) : point;
        if (dist(last, target) < 1) return;
        commitWall(last, target);
        setTyped("");
        // Closing the loop on the first point ends the chain.
        if (chain.length >= 2 && dist(target, chain[0]) < 0.5) setChain([]);
        else setChain([...chain, target]);
      }
    } else if (tool === "room") {
      const point = snap?.point ?? p;
      if (!rectStart) {
        setRectStart(point);
      } else {
        applyShell(addRectRoom(rectStart, typed ? (typedRect(rectStart) ?? point) : point, thickness));
        setRectStart(null);
        setTyped("");
      }
    } else if ((tool === "door" || tool === "window") && openingPreview?.offset != null) {
      applyShell(addOpening(openingPreview.wall.id, tool, openingPreview.offset));
    } else if (tool === "stairs") {
      // A straight stair centred on the click, then selected to adjust.
      const before = new Set(shell.stairs.map((s) => s.id));
      applyShell(addStair({ position: [Math.round(p[0]), Math.round(p[1])], size: defaultStairSize("straight", rise) })).then(() => {
        const added = useOdaja.getState().shell?.stairs.find((s) => !before.has(s.id));
        setTool("select");
        if (added) selectStructure({ kind: "stair", id: added.id });
      });
    }
  };

  // --- drawing ---------------------------------------------------------

  const outline = (wall: Wall) => pts(wallOutline(wall).map(toScreen));
  const previewShell = drag && "preview" in drag && drag.preview ? ShellSchema.parse(drag.preview) : null;
  const highlight = (h: Hit, className: string) => {
    if (!h) return null;
    if (h.kind === "wall") {
      const wall = shell.walls.find((w) => w.id === h.id);
      return wall && <polygon points={outline(wall)} className={className} />;
    }
    if (h.kind === "opening") {
      const o = shell.openings.find((x) => x.id === h.id);
      const wall = o && shell.walls.find((w) => w.id === o.wall);
      return o && wall && <polygon points={pts(openingRect(wall, o).map(toScreen))} className={className} />;
    }
    if (h.kind === "stair") {
      const stair = shell.stairs.find((x) => x.id === h.id);
      return stair && <polygon points={pts(stairOutline(stair).map(toScreen))} className={`${className} area`} />;
    }
    if (h.kind === "fence") {
      const fence = shell.fences.find((x) => x.id === h.id);
      return fence && <g>{[[fence.from, fence.to]].map(([a, b], i) => <line key={i} x1={toScreen(a)[0]} y1={toScreen(a)[1]} x2={toScreen(b)[0]} y2={toScreen(b)[1]} className={`${className} fence-line`} />)}</g>;
    }
    if (h.kind === "garden" || h.kind === "plot" || h.kind === "roof") {
      const roof = h.kind === "roof" ? shell.roofs.find((r) => r.id === h.id) : undefined;
      const polygon = h.kind === "plot" ? shell.plot?.polygon : roof ? roofOutline(roof) : shell.areas.find((a) => a.id === h.id)?.polygon;
      return polygon && <polygon points={pts(polygon.map(toScreen))} className={`${className} area`} />;
    }
    const polygon = h.kind === "area" ? h.polygon : shell.rooms.find((r) => r.id === h.id)?.polygon;
    return polygon && <polygon points={pts(polygon.map(toScreen))} className={`${className} area`} />;
  };

  const last = chain.at(-1);
  const wallEnd = chainTool && last ? (typed ? typedPoint(last) : null) ?? snap?.point : null;
  const polyEnd = polygonTool && last ? (typed ? typedPoint(last) : null) ?? snap?.point ?? cursor : null;
  const rectEnd = tool === "room" && rectStart ? (typed ? typedRect(rectStart) : null) ?? snap?.point : null;

  return (
    <svg
      ref={svgRef}
      className={`structure-layer tool-${tool} ${hover && tool === "select" ? "hovering" : ""} ${drag?.kind === "pan" ? "panning" : ""}`}
      width={view.width}
      height={view.height}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      // Double-click ends a wall chain (its second click added nothing new).
      onDoubleClick={(e) => {
        if (chainTool) setChain([]);
        if (polygonTool && chain.length >= 3) closePolygon(chain);
        // On a selected shape: a corner goes (keeping three), or an edge gets one.
        if (tool !== "select" || !shaped || !corners || shaped.kind === "fence") return;
        const [sx, sy] = local(e as unknown as ReactPointerEvent);
        const at = cornerAt(sx, sy);
        if (at >= 0) {
          if (corners.length > 3) applyShell(withCorners(shaped, corners.filter((_, i) => i !== at)));
          return;
        }
        const p = toPlan(sx, sy);
        const edge = corners.findIndex((c, i) => {
          const d = corners[(i + 1) % corners.length];
          const [ex, ey] = [d[0] - c[0], d[1] - c[1]];
          const l2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((p[0] - c[0]) * ex + (p[1] - c[1]) * ey) / l2));
          return Math.hypot(p[0] - c[0] - ex * t, p[1] - c[1] - ey * t) <= tol * 1.5;
        });
        if (edge >= 0) applyShell(withCorners(shaped, [...corners.slice(0, edge + 1), round1(p), ...corners.slice(edge + 1)]));
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {tool === "select" && !drag && highlight(hover, "hover")}
      {highlight(selection, "selected")}

      {/* Live preview of a drag. */}
      {previewShell?.walls.map((w) => <polygon key={w.id} points={outline(w)} className="preview" />)}
      {previewShell?.stairs.map((s) => drag?.kind === "stair" && s.id === drag.id && <polygon key={s.id} points={pts(stairOutline(s).map(toScreen))} className="preview" />)}
      {drag?.kind === "shift" && previewShell?.areas.map((a) => a.id === drag.id && <polygon key={a.id} points={pts(a.polygon.map(toScreen))} className="preview" />)}
      {drag?.kind === "shift" && previewShell?.fences.map((f) => f.id === drag.id && fenceOutlines(f).map((o, i) => <polygon key={`${f.id}-${i}`} points={pts(o.map(toScreen))} className="preview" />))}
      {previewShell?.openings.map((o) => {
        const wall = previewShell.walls.find((w) => w.id === o.wall);
        return wall && <polygon key={o.id} points={pts(openingRect(wall, o).map(toScreen))} className="preview-opening" />;
      })}

      {/* Corner handles on the selected wall, area, plot, roof or fence. */}
      {tool === "select" &&
        selectedWall &&
        [selectedWall.from, selectedWall.to].map((p, i) => {
          const [x, y] = toScreen(p);
          return <circle key={i} cx={x} cy={y} r={5} className="handle" />;
        })}
      {tool === "select" &&
        (drag?.kind === "vertex" && drag.preview ? cornersOf(ShellSchema.parse(drag.preview), drag.target) : corners)?.map((p, i) => {
          const [x, y] = toScreen(p);
          return <circle key={`c${i}`} cx={x} cy={y} r={5} className="handle" />;
        })}
      {drag?.kind === "vertex" && previewShell && (() => {
        const moved = cornersOf(previewShell, drag.target);
        if (!moved) return null;
        return drag.target.kind === "fence" ? (
          <line x1={toScreen(moved[0])[0]} y1={toScreen(moved[0])[1]} x2={toScreen(moved[1])[0]} y2={toScreen(moved[1])[1]} className="preview fence-line" />
        ) : (
          <polygon points={pts(moved.map(toScreen))} className="preview" />
        );
      })()}

      {/* Wall and fence tools: placed points and the wall or fence being drawn. */}
      {chainTool && last && wallEnd && <RubberBand from={last} to={wallEnd} thickness={tool === "fence" ? 6 : thickness} toScreen={toScreen} typed={typed} />}
      {(chainTool || polygonTool) && chain.map((p, i) => <circle key={i} cx={toScreen(p)[0]} cy={toScreen(p)[1]} r={3.5} className="placed" />)}

      {/* Area and plot tools: the outline so far, closing back to the start. */}
      {polygonTool && chain.length > 0 && (
        <g className="rubber">
          <polyline points={pts([...chain, ...(polyEnd ? [polyEnd] : [])].map(toScreen))} className="outline-draft" />
          {chain.length >= 2 && polyEnd && <line x1={toScreen(polyEnd)[0]} y1={toScreen(polyEnd)[1]} x2={toScreen(chain[0])[0]} y2={toScreen(chain[0])[1]} className="outline-close" />}
        </g>
      )}

      {/* Room tool: rectangle with its inside size. */}
      {tool === "room" && rectStart && rectEnd && <RectPreview a={rectStart} b={rectEnd} thickness={thickness} toScreen={toScreen} typed={typed} />}

      {/* Door / window tool. */}
      {openingPreview && (
        <OpeningPreview wall={openingPreview.wall} offset={openingPreview.offset} width={openingPreview.width} span={openingPreview.span} type={tool as "door" | "window"} toScreen={toScreen} />
      )}

      {/* Stairs tool: the stair that a click places. */}
      {tool === "stairs" && cursor && (
        <polygon
          points={pts(stairOutline({ id: "preview", type: "straight", position: cursor, rotation: 0, size: defaultStairSize("straight", rise), turn: "left" }).map(toScreen))}
          className="preview"
        />
      )}

      {/* Snap marker and guides. */}
      {snap && (chainTool || polygonTool || tool === "room") && (
        <g className={`snap snap-${snap.kind}`}>
          {snap.guides.map(([a, b], i) => {
            const [sa, sb] = [toScreen(a), toScreen(b)];
            return <line key={i} x1={sa[0]} y1={sa[1]} x2={sb[0]} y2={sb[1]} className="guide" />;
          })}
          <SnapMarker at={toScreen(snap.point)} kind={snap.kind} />
        </g>
      )}
    </svg>
  );
}

function openingRect(wall: Wall, o: Opening): Vec[] {
  const half = wall.thickness / 2 + 1;
  return [
    pointOnWall(wall, o.offset, -half),
    pointOnWall(wall, o.offset + o.width, -half),
    pointOnWall(wall, o.offset + o.width, half),
    pointOnWall(wall, o.offset, half),
  ];
}

function SnapMarker({ at: [x, y], kind }: { at: Vec; kind: Snap["kind"] }) {
  if (kind === "end") return <rect x={x - 5} y={y - 5} width={10} height={10} className="marker" />;
  if (kind === "wall") return <path d={`M${x - 6},${y + 5} L${x},${y - 6} L${x + 6},${y + 5} Z`} className="marker" />;
  return <circle cx={x} cy={y} r={4} className="marker" />;
}

function RubberBand({ from, to, thickness, toScreen, typed }: { from: Vec; to: Vec; thickness: number; toScreen: (p: Vec) => Vec; typed: string }) {
  const wall: Wall = { id: "preview", from, to, thickness };
  const len = dist(from, to);
  if (len < 0.5) return null;
  const [a, b] = [toScreen(from), toScreen(to)];
  const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const angle = Math.round((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
  return (
    <g className="rubber">
      <polygon points={pts(wallOutline(wall).map(toScreen))} />
      <text x={mid[0]} y={mid[1] - 14} textAnchor="middle" className="draw-label">
        {typed ? `${typed}▌ cm` : `${formatCm(len)} cm · ${((angle % 360) + 360) % 360}°`}
      </text>
    </g>
  );
}

function RectPreview({ a, b, thickness, toScreen, typed }: { a: Vec; b: Vec; thickness: number; toScreen: (p: Vec) => Vec; typed: string }) {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const corners: Vec[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const walls = corners.map((p, i): Wall => ({ id: `p${i}`, from: p, to: corners[(i + 1) % 4], thickness }));
  const c = toScreen([(x0 + x1) / 2, (y0 + y1) / 2]);
  const inside = `${formatCm(Math.max(0, x1 - x0 - thickness))} × ${formatCm(Math.max(0, y1 - y0 - thickness))}`;
  return (
    <g className="rubber">
      {walls.map((w) => (
        <polygon key={w.id} points={pts(wallOutline(w).map(toScreen))} />
      ))}
      <text x={c[0]} y={c[1]} textAnchor="middle" className="draw-label">
        {typed ? `${typed}▌ (inside, cm)` : `${inside} inside`}
      </text>
    </g>
  );
}

function OpeningPreview({
  wall,
  offset,
  width,
  span,
  type,
  toScreen,
}: {
  wall: Wall;
  offset: number | null;
  width: number;
  span?: [number, number];
  type: "door" | "window";
  toScreen: (p: Vec) => Vec;
}) {
  if (offset === null) {
    const [x, y] = toScreen(pointOnWall(wall, wallLength(wall) / 2));
    return (
      <text x={x} y={y - 12} textAnchor="middle" className="draw-label error">
        No room for a {width} cm {type} here
      </text>
    );
  }
  const o: Opening = { id: "preview", wall: wall.id, type, offset, width, height: 0, sill: 0, hinge: "start", swing: "left" };
  const label = (s0: number, s1: number) => {
    if (s1 - s0 < 1) return null;
    const [x, y] = toScreen(pointOnWall(wall, (s0 + s1) / 2, -(wall.thickness / 2 + 18)));
    return (
      <text x={x} y={y} textAnchor="middle" className="draw-label small">
        {formatCm(s1 - s0)}
      </text>
    );
  };
  const swing = type === "door" ? doorSwing(wall, o) : null;
  return (
    <g className="rubber">
      <polygon points={pts(openingRect(wall, o).map(toScreen))} className="opening-preview" />
      {swing && <polygon points={pts(swing.sector.map(toScreen))} className="swing-preview" />}
      {span && label(span[0], offset)}
      {span && label(offset + width, span[1])}
    </g>
  );
}
