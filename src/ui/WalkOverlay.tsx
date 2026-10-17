// Walk view overlays: picking a start point on the plan, the controls hint
// with eye height, and a mini-map of where you are and where you're looking.
import { useMemo } from "react";
import { shellBounds, wallOutline, type Vec } from "../model/geometry";
import { headingIntoRoom } from "../model/walk";
import { useOdaja } from "../store";

// Covers the plan while choosing where to stand.
export function WalkStartPicker() {
  const picking = useOdaja((s) => s.pickingWalkStart && s.viewMode === "plan");
  const view = useOdaja((s) => s.planView);
  const shell = useOdaja((s) => s.shell);
  const startWalk = useOdaja((s) => s.startWalk);
  const setPicking = useOdaja((s) => s.setPickingWalkStart);
  if (!picking || !view || !shell) return null;
  return (
    <div
      className="walk-picker"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const p: Vec = [((sx - view.width / 2) / view.zoom + view.centerX) * 100, ((sy - view.height / 2) / view.zoom + view.centerZ) * 100];
        startWalk({ position: p, heading: headingIntoRoom(shell, p) });
      }}
    >
      <div className="walk-banner" onClick={(e) => e.stopPropagation()}>
        Click on the plan where you want to stand.
        <button onClick={() => startWalk(null)}>Start at the entrance</button>
        <button onClick={() => setPicking(false)}>Cancel</button>
      </div>
    </div>
  );
}

function MiniMap() {
  const shell = useOdaja((s) => s.shell);
  const pose = useOdaja((s) => s.walkPose);
  const geometry = useMemo(() => {
    const b = shell && shellBounds(shell);
    if (!shell || !b) return null;
    const pad = 20;
    const w = b.maxX - b.minX + pad * 2;
    const h = b.maxY - b.minY + pad * 2;
    return { viewBox: `${b.minX - pad} ${b.minY - pad} ${w} ${h}`, aspect: w / h };
  }, [shell]);
  if (!shell || !geometry) return null;
  const width = 180;
  const height = Math.min(200, width / geometry.aspect);
  // View cone: 70° wide, pointing along the yaw (0 = north, CCW positive).
  const cone = pose
    ? [-35, 35]
        .map((deg) => {
          const a = pose.yaw + (deg * Math.PI) / 180;
          return `${pose.x - Math.sin(a) * 120},${pose.y - Math.cos(a) * 120}`;
        })
        .join(" ")
    : "";
  return (
    <svg className="mini-map" width={width} height={height} viewBox={geometry.viewBox} preserveAspectRatio="xMidYMid meet">
      {shell.rooms.map((r) => (
        <polygon key={r.id} points={r.polygon.map((p) => p.join(",")).join(" ")} className="mm-room" />
      ))}
      {shell.walls.map((w) => (
        <polygon key={w.id} points={wallOutline(w).map((p) => p.join(",")).join(" ")} className="mm-wall" />
      ))}
      {pose && (
        <>
          <polygon points={`${pose.x},${pose.y} ${cone}`} className="mm-cone" />
          <circle cx={pose.x} cy={pose.y} r={18} className="mm-me" />
        </>
      )}
    </svg>
  );
}

export function WalkOverlay() {
  const walking = useOdaja((s) => s.viewMode === "walk");
  const eyeHeight = useOdaja((s) => s.eyeHeight);
  const setEyeHeight = useOdaja((s) => s.setEyeHeight);
  const setViewMode = useOdaja((s) => s.setViewMode);
  const setPicking = useOdaja((s) => s.setPickingWalkStart);
  if (!walking) return null;
  return (
    <>
      <MiniMap />
      <div className="walk-help">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>Shift</kbd> faster · <kbd>Q</kbd>
          <kbd>E</kbd> turn · click or drag to look · <kbd>Esc</kbd> frees the mouse
        </span>
        <label>
          Eyes at
          <select value={eyeHeight} onChange={(e) => setEyeHeight(Number(e.target.value))}>
            {[110, 130, 150, 160, 170, 180, 190].map((h) => (
              <option key={h} value={h}>
                {h} cm
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setViewMode("plan");
            setPicking(true);
          }}
        >
          Stand somewhere else
        </button>
        <button onClick={() => setViewMode("3d")}>Exit</button>
      </div>
    </>
  );
}
