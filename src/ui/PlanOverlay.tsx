// SVG layer drawn over the plan view: dimension lines along outer walls,
// overall size, room sizes, door widths, and for the selected object its size
// and distance to the walls around it. Lines are computed in plan centimetres
// and projected with the plan camera published by the viewport.
import { useMemo, type ReactNode } from "react";
import {
  add,
  clearances,
  doorSwing,
  exteriorSide,
  formatCm,
  objectFootprint,
  pointOnWall,
  polygonArea,
  rectEdges,
  roomClearSize,
  scale,
  shellBounds,
  wallChain,
  wallEdges,
  wallLength,
  wallOutline,
  type Vec,
} from "../model/geometry";
import { issuesFor, objectOutlines } from "../model/issues";
import type { Shell } from "../model/schema";
import { M } from "../model/units";
import { useOdaja, type PlanView } from "../store";

// Distances of the dimension rows outside the walls' outer face, in cm.
const CHAIN_OFFSET = 45;
const OVERALL_OFFSET = 95;
// Don't label segments shorter than this on screen.
const MIN_LABEL_PX = 24;

type ToScreen = (p: Vec) => Vec;

function useToScreen(view: PlanView | null): ToScreen | null {
  return useMemo(() => {
    if (!view) return null;
    return ([x, y]: Vec): Vec => [
      (M(x) - view.centerX) * view.zoom + view.width / 2,
      (M(y) - view.centerZ) * view.zoom + view.height / 2,
    ];
  }, [view]);
}

function Label({ at, angle = 0, children, className }: { at: Vec; angle?: number; children: ReactNode; className?: string }) {
  return (
    <text
      x={at[0]}
      y={at[1]}
      transform={angle ? `rotate(${angle} ${at[0]} ${at[1]})` : undefined}
      className={className}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {children}
    </text>
  );
}

interface DimProps {
  toScreen: ToScreen;
  a: Vec;
  b: Vec;
  // Signed distance (cm) of the dimension line from a→b, towards a→b's left
  // normal; extension lines run from `extFrom` to just past the line.
  offset?: number;
  extFrom?: number;
  label?: string;
  className?: string;
}

function Dim({ toScreen, a, b, offset = 0, extFrom, label, className = "dim" }: DimProps) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5) return null;
  const n: Vec = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const sa = toScreen(add(a, scale(n, offset)));
  const sb = toScreen(add(b, scale(n, offset)));
  const u: Vec = [sb[0] - sa[0], sb[1] - sa[1]];
  const pxLen = Math.hypot(u[0], u[1]);
  const ux: Vec = [u[0] / pxLen, u[1] / pxLen];
  const tick = (p: Vec) => {
    // Architectural 45° tick through the end point.
    const t: Vec = [(ux[0] - ux[1]) * 3.5, (ux[1] + ux[0]) * 3.5];
    return <line x1={p[0] - t[0]} y1={p[1] - t[1]} x2={p[0] + t[0]} y2={p[1] + t[1]} className="tick" />;
  };
  let angle = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const mid: Vec = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2];
  const overshoot = Math.sign(offset - (extFrom ?? 0)) * 6; // cm past the line
  return (
    <g className={className}>
      {extFrom !== undefined && (
        <>
          <Line toScreen={toScreen} a={add(a, scale(n, extFrom))} b={add(a, scale(n, offset + overshoot))} className="ext" />
          <Line toScreen={toScreen} a={add(b, scale(n, extFrom))} b={add(b, scale(n, offset + overshoot))} className="ext" />
        </>
      )}
      <line x1={sa[0]} y1={sa[1]} x2={sb[0]} y2={sb[1]} />
      {tick(sa)}
      {tick(sb)}
      {pxLen >= MIN_LABEL_PX && (
        <Label at={mid} angle={angle}>
          {label ?? formatCm(len)}
        </Label>
      )}
    </g>
  );
}

function Line({ toScreen, a, b, className }: { toScreen: ToScreen; a: Vec; b: Vec; className?: string }) {
  const [sa, sb] = [toScreen(a), toScreen(b)];
  return <line x1={sa[0]} y1={sa[1]} x2={sb[0]} y2={sb[1]} className={className} />;
}

function WallDims({ shell, toScreen }: { shell: Shell; toScreen: ToScreen }) {
  const bounds = shellBounds(shell);
  return (
    <g>
      {shell.walls.map((wall) => {
        const side = exteriorSide(wall, shell);
        if (side === 0) return null;
        const chain = wallChain(wall, shell);
        const face = (wall.thickness / 2) * side;
        return chain.slice(1).map((s, i) => (
          <Dim
            key={`${wall.id}-${i}`}
            toScreen={toScreen}
            a={pointOnWall(wall, chain[i])}
            b={pointOnWall(wall, s)}
            offset={face + CHAIN_OFFSET * side}
            extFrom={face + 4 * side}
          />
        ));
      })}
      {bounds && (
        <>
          <Dim
            toScreen={toScreen}
            a={[bounds.minX, bounds.minY]}
            b={[bounds.maxX, bounds.minY]}
            offset={-OVERALL_OFFSET}
            extFrom={-4}
            className="dim overall"
          />
          <Dim
            toScreen={toScreen}
            a={[bounds.minX, bounds.maxY]}
            b={[bounds.minX, bounds.minY]}
            offset={-OVERALL_OFFSET}
            extFrom={-4}
            className="dim overall"
          />
        </>
      )}
      {/* Door and opening widths on interior walls; outer walls have them in the chain. */}
      {shell.openings.map((o) => {
        const wall = shell.walls.find((w) => w.id === o.wall);
        if (!wall || o.type === "window" || exteriorSide(wall, shell) !== 0) return null;
        if (o.offset + o.width > wallLength(wall)) return null;
        return (
          <Label key={o.id} at={toScreen(pointOnWall(wall, o.offset + o.width / 2))} className="opening-label">
            {formatCm(o.width)}
          </Label>
        );
      })}
    </g>
  );
}

// Door leaves drawn open, with their swing arc, as on an architect's plan.
function DoorSwings({ shell, toScreen }: { shell: Shell; toScreen: ToScreen }) {
  return (
    <g className="door-swings">
      {shell.openings.map((o) => {
        if (o.type !== "door") return null;
        const wall = shell.walls.find((w) => w.id === o.wall);
        if (!wall) return null;
        const { hinge, closed, open } = doorSwing(wall, o);
        const [h, c, op] = [toScreen(hinge), toScreen(closed), toScreen(open)];
        const r = Math.hypot(c[0] - h[0], c[1] - h[1]);
        // Sweep direction: the arc goes from the open leaf back to the closed position.
        const cross = (op[0] - h[0]) * (c[1] - h[1]) - (op[1] - h[1]) * (c[0] - h[0]);
        return (
          <g key={o.id}>
            <line x1={h[0]} y1={h[1]} x2={op[0]} y2={op[1]} className="leaf" />
            <path d={`M ${op[0]} ${op[1]} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${c[0]} ${c[1]}`} className="arc" />
          </g>
        );
      })}
    </g>
  );
}

function RoomLabels({ shell, toScreen }: { shell: Shell; toScreen: ToScreen }) {
  const edges = useMemo(() => wallEdges(shell), [shell]);
  return (
    <g>
      {shell.rooms.map((room) => {
        const xs = room.polygon.map((p) => p[0]);
        const ys = room.polygon.map((p) => p[1]);
        const c = toScreen([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
        const screenWidth = toScreen([Math.max(...xs), 0])[0] - toScreen([Math.min(...xs), 0])[0];
        if (screenWidth < 40) return null;
        const size = roomClearSize(room, edges);
        // Clear area for simple rectangular rooms; outline area otherwise.
        const area = size && room.polygon.length === 4 ? size.width * size.depth : polygonArea(room.polygon);
        return (
          <g key={room.id} className="room">
            <Label at={[c[0], c[1] - 8]} className="room-name">
              {room.name}
            </Label>
            {screenWidth >= 150 && (
              <Label at={[c[0], c[1] + 8]} className="room-size">
                {size ? `${formatCm(size.width)} × ${formatCm(size.depth)} · ` : ""}
                {(area / 10000).toFixed(1)} m²
              </Label>
            )}
          </g>
        );
      })}
    </g>
  );
}

function SelectionDims({ shell, toScreen }: { shell: Shell; toScreen: ToScreen }) {
  const object = useOdaja((s) => s.scene?.objects.find((o) => o.id === s.selectedId));
  const others = useOdaja((s) => s.scene?.objects);
  const preview = useOdaja((s) => s.dragPreview);
  // Measure to walls and to the other objects' footprints, so the lines show
  // real free space (sofa to coffee table, toilet to wall).
  const edges = useMemo(
    () => [
      ...wallEdges(shell),
      ...(others ?? []).filter((o) => o.id !== object?.id).flatMap((o) => rectEdges(objectFootprint(o))),
    ],
    [shell, others, object?.id],
  );
  if (!object) return null;
  const position = preview?.id === object.id ? preview.position : object.position;
  const r = objectFootprint(object, position);
  const gaps = clearances(r, edges);
  const cx = (r.minX + r.maxX) / 2;
  const cy = (r.minY + r.maxY) / 2;
  const [tl, br] = [toScreen([r.minX, r.minY]), toScreen([r.maxX, r.maxY])];
  const lines: [Vec, Vec, number | null][] = [
    [[r.minX, cy], [-1, 0], gaps.left],
    [[r.maxX, cy], [1, 0], gaps.right],
    [[cx, r.minY], [0, -1], gaps.up],
    [[cx, r.maxY], [0, 1], gaps.down],
  ];
  return (
    <g className="dim selection">
      <rect x={tl[0]} y={tl[1]} width={br[0] - tl[0]} height={br[1] - tl[1]} className="footprint" />
      {lines.map(([from, dir, d], i) =>
        d === null || d > 800 ? null : <Dim key={i} toScreen={toScreen} a={from} b={add(from, scale(dir, d))} className="dim selection" />,
      )}
      <Label at={toScreen([cx, cy])} className="size-label">
        {formatCm(r.maxX - r.minX)} × {formatCm(r.maxY - r.minY)}
      </Label>
    </g>
  );
}

// Red/amber outlines on everything that has an issue; the focused issue's
// targets drawn stronger.
function IssueHighlights({ shell, toScreen }: { shell: Shell; toScreen: ToScreen }) {
  const scene = useOdaja((s) => s.scene);
  const focused = useOdaja((s) => s.focusedIssue);
  const issues = issuesFor(scene, shell);
  if (!scene) return null;
  const poly = (points: Vec[]) => points.map((p) => toScreen(p).join(",")).join(" ");
  return (
    <g className="issue-highlights">
      {issues.flatMap((issue) =>
        issue.targets.map((t, i) => {
          const cls = `${issue.severity} ${focused === issue.key ? "focused" : ""}`;
          if (t.kind === "object") {
            const o = scene.objects.find((x) => x.id === t.id);
            return o ? objectOutlines(o).map((p, j) => <polygon key={`${issue.key}-${i}-${j}`} points={poly(p)} className={cls} />) : null;
          }
          if (t.kind === "opening") {
            const o = shell.openings.find((x) => x.id === t.id);
            const wall = o && shell.walls.find((w) => w.id === o.wall);
            if (!o || !wall) return null;
            const h = wall.thickness / 2 + 2;
            const r = [pointOnWall(wall, o.offset, -h), pointOnWall(wall, o.offset + o.width, -h), pointOnWall(wall, o.offset + o.width, h), pointOnWall(wall, o.offset, h)];
            return <polygon key={`${issue.key}-${i}`} points={poly(r)} className={cls} />;
          }
          // Walls are only outlined for the focused issue (they'd clutter otherwise).
          if (focused !== issue.key) return null;
          const wall = shell.walls.find((w) => w.id === t.id);
          return wall ? <polygon key={`${issue.key}-${i}`} points={poly(wallOutline(wall))} className={cls} /> : null;
        }),
      )}
    </g>
  );
}

// What a renovation option changes compared with the flat as it is
// (shell.json): walls to take down in red, new walls in green.
function WallChanges({ shell, toScreen }: { shell: Shell; toScreen: ToScreen }) {
  const base = useOdaja((s) => s.baseShell);
  const show = useOdaja((s) => s.showChanges);
  if (!base || !show) return null;
  const key = (w: Shell["walls"][number]) => {
    const ends = [w.from, w.to].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort();
    return `${ends.join("|")}|${w.thickness}`;
  };
  const current = new Set(shell.walls.map(key));
  const before = new Set(base.walls.map(key));
  const poly = (w: Shell["walls"][number]) => wallOutline(w).map((p) => toScreen(p).join(",")).join(" ");
  const removed = base.walls.filter((w) => !current.has(key(w)));
  const added = shell.walls.filter((w) => !before.has(key(w)));
  return (
    <g className="wall-changes">
      {removed.map((w) => (
        <polygon key={`r-${w.id}`} points={poly(w)} className="removed" />
      ))}
      {added.map((w) => (
        <polygon key={`a-${w.id}`} points={poly(w)} className="added" />
      ))}
    </g>
  );
}

export function PlanOverlay() {
  const plan = useOdaja((s) => s.viewMode === "plan");
  const view = useOdaja((s) => s.planView);
  const shell = useOdaja((s) => s.shell);
  const toScreen = useToScreen(view);
  if (!plan || !view || !shell || !toScreen) return null;
  return (
    <svg className="plan-overlay" width={view.width} height={view.height}>
      <WallChanges shell={shell} toScreen={toScreen} />
      <DoorSwings shell={shell} toScreen={toScreen} />
      <RoomLabels shell={shell} toScreen={toScreen} />
      <WallDims shell={shell} toScreen={toScreen} />
      <IssueHighlights shell={shell} toScreen={toScreen} />
      <SelectionDims shell={shell} toScreen={toScreen} />
    </svg>
  );
}
