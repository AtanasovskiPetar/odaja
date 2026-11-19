// Interactive click-to-click tape measure over the Plan view.
// Snaps to wall corners, wall faces, and furniture footprints; Shift locks to
// 45° increments; displays total distance plus Δx / Δy for diagonal spans.
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { objectFootprint, wallEdges, wallOutline, type Vec } from "../model/geometry";
import { formatLength } from "../model/units";
import { useOdaja, type PlanView } from "../store";
import { useUnitSystem } from "./unitPref";

type Edge = [Vec, Vec];

function screenToPlan(view: PlanView, sx: number, sy: number): Vec {
  return [((sx - view.width / 2) / view.zoom + view.centerX) * 100, ((sy - view.height / 2) / view.zoom + view.centerZ) * 100];
}

function planToScreen(view: PlanView, [x, y]: Vec): Vec {
  return [(x / 100 - view.centerX) * view.zoom + view.width / 2, (y / 100 - view.centerZ) * view.zoom + view.height / 2];
}

function projectToEdge(p: Vec, [a, b]: Edge): Vec {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return a;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + dx * t, a[1] + dy * t];
}

function lockAngle(from: Vec, to: Vec): Vec {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return to;
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
}

export function MeasureLayer() {
  const active = useOdaja((s) => s.measuring && s.viewMode === "plan");
  const setMeasuring = useOdaja((s) => s.setMeasuring);
  const view = useOdaja((s) => s.planView);
  const shell = useOdaja((s) => s.shell);
  const objects = useOdaja((s) => s.scene?.objects);
  const units = useUnitSystem();

  const [a, setA] = useState<Vec | null>(null);
  const [b, setB] = useState<Vec | null>(null);
  const [cursor, setCursor] = useState<{ point: Vec; snapped: boolean } | null>(null);

  // Reset points whenever measure mode turns off.
  useEffect(() => {
    if (!active) {
      setA(null);
      setB(null);
      setCursor(null);
    }
  }, [active]);

  // Escape clears the active span first, then exits measure mode.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (a || b) {
        setA(null);
        setB(null);
      } else {
        setMeasuring(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, a, b, setMeasuring]);

  const snapTargets = useMemo(() => {
    const points: Vec[] = [];
    const edges: Edge[] = shell ? wallEdges(shell) : [];
    if (shell) {
      for (const w of shell.walls) {
        points.push(w.from, w.to, ...wallOutline(w));
      }
    }
    if (objects) {
      for (const o of objects) {
        const r = objectFootprint(o);
        points.push([r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]);
      }
    }
    return { points, edges };
  }, [shell, objects]);

  if (!active || !view) return null;

  const snapRadiusCm = (11 / Math.max(1, view.zoom)) * 100;

  const resolvePoint = (e: ReactPointerEvent): { point: Vec; snapped: boolean } => {
    const r = e.currentTarget.getBoundingClientRect();
    let p = screenToPlan(view, e.clientX - r.left, e.clientY - r.top);
    if (e.shiftKey && a && !b) p = lockAngle(a, p);

    // Prefer exact vertex snap (wall corners, furniture corners), then wall faces.
    let bestPoint: Vec | null = null;
    let bestDist = snapRadiusCm;
    for (const pt of snapTargets.points) {
      const d = Math.hypot(pt[0] - p[0], pt[1] - p[1]);
      if (d < bestDist) {
        bestDist = d;
        bestPoint = pt;
      }
    }
    if (bestPoint) return { point: bestPoint, snapped: true };

    for (const edge of snapTargets.edges) {
      const proj = projectToEdge(p, edge);
      const d = Math.hypot(proj[0] - p[0], proj[1] - p[1]);
      if (d < bestDist) {
        bestDist = d;
        bestPoint = proj;
      }
    }
    if (bestPoint) return { point: bestPoint, snapped: true };

    return { point: p, snapped: false };
  };

  const end = b ?? cursor?.point ?? null;
  const hasSpan = Boolean(a && end);
  const dx = hasSpan ? Math.abs(end![0] - a![0]) : 0;
  const dy = hasSpan ? Math.abs(end![1] - a![1]) : 0;
  const dist = hasSpan ? Math.hypot(dx, dy) : 0;
  const diagonal = hasSpan && dx > 5 && dy > 5;

  const sa = a ? planToScreen(view, a) : null;
  const sb = end ? planToScreen(view, end) : null;
  const sCorner = diagonal ? planToScreen(view, [end![0], a![1]]) : null;
  const mid: Vec | null = sa && sb ? [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2] : null;

  return (
    <div
      className="measure-layer"
      onPointerMove={(e) => setCursor(resolvePoint(e))}
      onPointerDown={(e) => {
        if (e.button === 2) {
          setA(null);
          setB(null);
          return;
        }
        if (e.button !== 0) return;
        const hit = resolvePoint(e);
        if (!a || b) {
          setA(hit.point);
          setB(null);
        } else {
          setB(hit.point);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="measure-svg" width={view.width} height={view.height}>
        {diagonal && sa && sb && sCorner && (
          <g className="measure-legs">
            <line x1={sa[0]} y1={sa[1]} x2={sCorner[0]} y2={sCorner[1]} />
            <line x1={sCorner[0]} y1={sCorner[1]} x2={sb[0]} y2={sb[1]} />
            <text x={(sa[0] + sCorner[0]) / 2} y={sa[1] - 6} textAnchor="middle">
              {formatLength(dx, units)}
            </text>
            <text x={sCorner[0] + 6} y={(sCorner[1] + sb[1]) / 2} textAnchor="start" dominantBaseline="central">
              {formatLength(dy, units)}
            </text>
          </g>
        )}
        {sa && sb && (
          <g className="measure-span">
            <line x1={sa[0]} y1={sa[1]} x2={sb[0]} y2={sb[1]} />
            <circle cx={sa[0]} cy={sa[1]} r={4.5} />
            <circle cx={sb[0]} cy={sb[1]} r={4.5} />
          </g>
        )}
        {cursor?.snapped && !b && (() => {
          const [cx, cy] = planToScreen(view, cursor.point);
          return <circle cx={cx} cy={cy} r={7.5} className="measure-snap" />;
        })()}
      </svg>

      {mid && dist > 0.1 && (
        <div className="measure-badge" style={{ left: mid[0], top: mid[1] }}>
          <strong>{formatLength(dist, units)}</strong>
          {diagonal && (
            <span className="measure-delta">
              ({formatLength(dx, units)} × {formatLength(dy, units)})
            </span>
          )}
        </div>
      )}

      <div className="measure-hint">
        {!a
          ? "Click a start point to measure · Esc exits"
          : !b
            ? "Click an end point · Shift locks angle · Esc clears"
            : "Click anywhere to measure again · Esc clears"}
      </div>
    </div>
  );
}
