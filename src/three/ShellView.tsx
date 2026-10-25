import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { finishRects, floorMaterial, sideVector } from "../model/finishes";
import { pointOnWall, wallLength, wallPieces, type WallPiece } from "../model/geometry";
import { isLowest, levelById, levelShell, levelsOf, stairsArriving } from "../model/levels";
import type { Finish, Opening, Room, Shell, Stair, Wall } from "../model/schema";
import { cutOut } from "../model/polygonClip";
import { isOpen, stairFlights, stairGuards, stairOutline, stairRails, stairTreads, TREAD, treadBottom, type Flight, type P } from "../model/stairs";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec } from "../model/geometry";
import { M } from "../model/units";
import { useOdaja } from "../store";
import { JoineryView } from "./JoineryView";
import { SiteView } from "./SiteView";
import { RoofView } from "./RoofView";
import { roofHeightAt } from "../model/roofs";
import { useMaterials } from "./materials";
import { planMaterials } from "./theme";

// Height walls are cut at in "cut" view and in plan view, so you can see into
// rooms from above and windows and doors show as openings.
const CUT_HEIGHT = 110;

function cut(pieces: WallPiece[], wallsCut: boolean): WallPiece[] {
  if (!wallsCut) return pieces;
  return pieces.filter((p) => p.bottom < CUT_HEIGHT).map((p) => ({ ...p, top: Math.min(p.top, CUT_HEIGHT) }));
}

// `active`: on the level being viewed (only its walls are cut). `slab`: the
// floor under an upper level; the wall reaches down through it, so outer
// walls run on from the level below.
function WallView({ wall, openings, shell, active, slab }: { wall: Wall; openings: Opening[]; shell: Shell; active: boolean; slab: number }) {
  const material = useMaterials();
  const plan = useOdaja((s) => s.viewMode === "plan");
  const walk = useOdaja((s) => s.viewMode === "walk");
  // Walls are cut low while editing a shape, so they don't hide it.
  const cutOn = useOdaja((s) => s.wallsCut || s.editingObjectId !== null);
  const wallsCut = active && ((cutOn && !walk) || plan);
  const { solid, glass } = wallPieces(wall, openings, shell.wallHeight);
  const angle = Math.atan2(wall.to[1] - wall.from[1], wall.to[0] - wall.from[0]);
  const dir: [number, number] = [Math.cos(angle), Math.sin(angle)];

  const box = (p: WallPiece, thickness: number) => {
    const mid = (p.start + p.end) / 2;
    const x = wall.from[0] + dir[0] * mid;
    const y = wall.from[1] + dir[1] * mid;
    return {
      position: [M(x), M((p.bottom + p.top) / 2), M(y)] as [number, number, number],
      args: [M(p.end - p.start), M(p.top - p.bottom), M(thickness)] as [number, number, number],
    };
  };

  return (
    <group userData={{ kind: "wall", id: wall.id }}>
      {cut(solid, wallsCut).map((p, i) => {
        const b = box(p, wall.thickness);
        return (
          <mesh key={i} position={b.position} rotation={[0, -angle, 0]} castShadow receiveShadow material={plan ? (p.sill ? planMaterials.glazing : planMaterials.wall) : material(wall.material ?? "wall")}>
            <boxGeometry args={b.args} />
          </mesh>
        );
      })}
      {slab > 0 && !plan && (
        <mesh position={box({ start: 0, end: wallLength(wall), bottom: -slab, top: 0 }, wall.thickness).position} rotation={[0, -angle, 0]} castShadow receiveShadow material={material(wall.material ?? "wall")}>
          <boxGeometry args={[M(wallLength(wall)), M(slab), M(wall.thickness)]} />
        </mesh>
      )}
      {/* The plan shows windows as a glass line; other views get full joinery. */}
      {!plan && <JoineryView wall={wall} openings={openings} clip={wallsCut ? CUT_HEIGHT : Infinity} />}
      {plan && cut(glass, wallsCut).map((p, i) => {
        const b = box(p, 2);
        return (
          <mesh key={`g${i}`} position={b.position} rotation={[0, -angle, 0]} material={material("glass")}>
            <boxGeometry args={b.args} />
          </mesh>
        );
      })}
    </group>
  );
}

const CEILING = new THREE.MeshStandardMaterial({ color: "#f6f4f0", roughness: 0.95, side: THREE.DoubleSide });

// An outline as shapes to lay flat, cut open where stairs (or pools) are.
// Shape coordinates are (x, -y) so that after laying the shape flat (rotating
// -90° about X) plan y ends up on world +z.
export function flatShapes(outline: Vec[], openings: Vec[][]): THREE.Shape[] {
  const flat = (poly: Vec[]) => poly.map(([x, y]) => new THREE.Vector2(M(x), -M(y)));
  return cutOut(outline, openings).map((piece) => {
    const shape = new THREE.Shape(flat(piece.outer));
    shape.holes = piece.holes.map((h) => new THREE.Path(flat(h)));
    return shape;
  });
}

function useRoomShape(room: Room, openings: Vec[][]) {
  return useMemo(() => flatShapes(room.polygon, openings), [room.polygon, openings]);
}

// Ceilings are only drawn when walking (they'd hide everything from above),
// open where stairs go up. They don't cast shadows, so daylight still reaches
// the rooms. Just under the slab of a level above, which is the same surface.
function RoomCeiling({ room, height, openings }: { room: Room; height: number; openings: Vec[][] }) {
  const shape = useRoomShape(room, openings);
  const geometry = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, M(height) - 0.003, 0]} material={CEILING} receiveShadow />;
}

// A room under a roof with sloped ceilings has the roof as its ceiling.
function underSlopedRoof(shell: Shell, room: Room): boolean {
  const c = room.polygon.reduce<Vec>((s, p) => [s[0] + p[0] / room.polygon.length, s[1] + p[1] / room.polygon.length], [0, 0]);
  return shell.roofs.some((r) => r.ceiling === "sloped" && roofHeightAt(r, c) !== null);
}

// A stringer of open stairs: a beam under one side of a flight, following
// its slope.
function Stringer({ from, to, z0, z1, material }: { from: Vec; to: Vec; z0: number; z1: number; material: THREE.Material }) {
  const run = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const tilt = Math.atan2(z1 - z0, run);
  // Its top edge just under the treads' front edges.
  const drop = 11 / Math.cos(tilt) + TREAD;
  return (
    <group position={[M((from[0] + to[0]) / 2), M((z0 + z1) / 2 - drop), M((from[1] + to[1]) / 2)]} rotation={[0, -angle, 0]}>
      <mesh rotation={[0, 0, tilt]} castShadow receiveShadow material={material}>
        <boxGeometry args={[M(Math.hypot(run, z1 - z0)), 0.22, 0.04]} />
      </mesh>
    </group>
  );
}

const stringerLines = (f: Flight): [Vec, Vec][] => {
  const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]) || 1;
  const n: Vec = [-(f.b[1] - f.a[1]) / len, (f.b[0] - f.a[0]) / len];
  return [-1, 1].map((s) => {
    const k = s * (f.width / 2 - 2);
    return [
      [f.a[0] + n[0] * k, f.a[1] + n[1] * k],
      [f.b[0] + n[0] * k, f.b[1] + n[1] * k],
    ];
  });
};

// A box from a to b (plan cm with heights), `w` × `h` cm across.
function beam(a: P, b: P, w: number, h: number): THREE.BufferGeometry {
  const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const run = Math.hypot(dx, dy);
  const g = new THREE.BoxGeometry(M(Math.hypot(run, dz)) || 0.001, M(h), M(w));
  g.rotateZ(Math.atan2(dz, run));
  g.rotateY(-Math.atan2(dy, dx));
  g.translate(M((a[0] + b[0]) / 2), M((a[2] + b[2]) / 2), M((a[1] + b[1]) / 2));
  return g;
}

// Handrails: top rails, newel posts at the ends and balusters, in one mesh.
function StairRails({ stair, walls }: { stair: Stair; walls: Wall[] }) {
  const geometry = useMemo(() => {
    const { rails, posts } = stairRails(stair, stair.rise ?? 280, walls);
    if (!rails.length) return null;
    const pieces = [
      ...rails.map(([a, b]) => beam(a, b, 5, 4)),
      ...posts.map(([a, b]) => {
        // Upright: a thin box standing on the tread.
        const g = new THREE.BoxGeometry(0.02, M(b[2] - a[2]), 0.02);
        g.translate(M(a[0]), M((a[2] + b[2]) / 2), M(a[1]));
        return g;
      }),
    ];
    const merged = mergeGeometries(pieces);
    pieces.forEach((p) => p.dispose());
    return merged;
  }, [stair, walls]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry ? <mesh geometry={geometry} castShadow material={RAIL} /> : null;
}

// Solid steps down to the floor, or for open stairs tread plates on
// stringers (spiral: round a pole). `rise` is filled in by the level view.
function StairView({ stair, walls }: { stair: Stair; walls: Wall[] }) {
  const material = useMaterials();
  const rise = stair.rise ?? 280;
  const spiral = stair.type === "spiral";
  const geometries = useMemo(
    () =>
      stairTreads(stair, rise).map((t) => {
        const shape = new THREE.Shape(t.poly.map(([x, y]) => new THREE.Vector2(M(x), -M(y))));
        const bottom = treadBottom(stair, t);
        return { geometry: new THREE.ExtrudeGeometry(shape, { depth: M(t.top - bottom), bevelEnabled: false }), bottom };
      }),
    [stair, rise],
  );
  const flights = useMemo(() => (isOpen(stair) ? stairFlights(stair, rise) : []), [stair, rise]);
  useEffect(() => () => geometries.forEach((g) => g.geometry.dispose()), [geometries]);
  const mat = material(stair.material ?? "oak");
  return (
    <group userData={{ kind: "stair", id: stair.id }}>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g.geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, M(g.bottom), 0]} castShadow receiveShadow material={mat} />
      ))}
      {spiral && (
        <mesh position={[M(stair.position[0]), M(rise + 90) / 2, M(stair.position[1])]} castShadow material={material("#3a3a3a")}>
          <cylinderGeometry args={[0.05, 0.05, M(rise + 90), 16]} />
        </mesh>
      )}
      {flights.flatMap((f, i) => stringerLines(f).map(([a, b], j) => <Stringer key={`${i}-${j}`} from={a} to={b} z0={f.z0} z1={f.z1} material={mat} />))}
      <StairRails stair={stair} walls={walls} />
    </group>
  );
}

// A finish on one side of a wall: thin panels on the face, with doors and
// windows cut out. UVs are in metres along the wall and up, so tile patterns
// line up across the pieces.
function WallFinish({ finish, shell, clip }: { finish: Finish; shell: Shell; clip: number }) {
  const material = useMaterials();
  const wall = shell.walls.find((w) => w.id === finish.wall);
  // Build the panels once per change, not on every render.
  const panels = useMemo(() => {
    if (!wall || !finish.side) return [];
    const out = finish.side === "right" ? 1 : -1;
    return finishRects(finish, shell).flatMap((r) => {
      const top = Math.min(r.top, clip);
      if (top <= r.bottom) return [];
      const w = r.end - r.start;
      const h = top - r.bottom;
      const mid = pointOnWall(wall, (r.start + r.end) / 2, out * (wall.thickness / 2 + 0.3));
      const geometry = new THREE.PlaneGeometry(M(w), M(h));
      // u runs along the wall (mirrored on the left side so it matches the
      // panel's own left-to-right), v up from the floor.
      const u0 = out === 1 ? r.start : -r.end;
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, M(u0 + uv.getX(k) * w), M(r.bottom + uv.getY(k) * h));
      return [{ geometry, position: [M(mid[0]), M((r.bottom + top) / 2), M(mid[1])] as [number, number, number] }];
    });
  }, [finish, shell, wall, clip]);
  useEffect(() => () => panels.forEach((p) => p.geometry.dispose()), [panels]);
  if (!wall || !finish.side) return null;
  const v = sideVector(wall, finish.side);
  const rotation = Math.atan2(v[0], v[1]);
  const mat = material(finish.material);
  return (
    <group>
      {panels.map((p, i) => (
        <mesh key={i} geometry={p.geometry} position={p.position} rotation={[0, rotation, 0]} material={mat} receiveShadow />
      ))}
    </group>
  );
}

// The floor construction under an upper level: seen from below it's the
// ceiling of the level under it, and it shades that level from the sun.
const SLAB = new THREE.MeshStandardMaterial({ color: "#efece6", roughness: 0.95 });

// `openings`: where stairs come up through this floor.
function RoomFloor({ room, slab, openings }: { room: Room; slab: number; openings: Vec[][] }) {
  const material = useMaterials();
  const scene = useOdaja((s) => s.scene);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const shape = useRoomShape(room, openings);
  const geometry = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const slabGeometry = useMemo(() => (slab > 0 ? new THREE.ExtrudeGeometry(shape, { depth: M(slab), bevelEnabled: false }) : null), [shape, slab]);
  useEffect(() => () => slabGeometry?.dispose(), [slabGeometry]);

  return (
    <>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={material(floorMaterial(scene, room))} />
      {slabGeometry && !plan && <mesh geometry={slabGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -M(slab) - 0.001, 0]} castShadow receiveShadow material={SLAB} />}
      {/* The plan tints floors like a watercolour wash, so walls and furniture read first. */}
      {plan && <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={planMaterials.wash} renderOrder={1} />}
    </>
  );
}

const GUARD_HEIGHT = 100;
const RAIL = new THREE.MeshStandardMaterial({ color: "#3a3a3a", roughness: 0.4, metalness: 0.6 });

// A glass balustrade with a top rail along one edge of a stair opening.
function Guard({ from, to }: { from: Vec; to: Vec }) {
  const material = useMaterials();
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const [x, z] = [M((from[0] + to[0]) / 2), M((from[1] + to[1]) / 2)];
  return (
    <group position={[x, 0, z]} rotation={[0, -angle, 0]}>
      <mesh position={[0, M(GUARD_HEIGHT - 4) / 2, 0]} material={material("glass")}>
        <boxGeometry args={[M(len), M(GUARD_HEIGHT - 4), 0.012]} />
      </mesh>
      <mesh position={[0, M(GUARD_HEIGHT - 2), 0]} castShadow material={RAIL}>
        <boxGeometry args={[M(len + 4), 0.04, 0.05]} />
      </mesh>
    </group>
  );
}

// `arriving`: stairs from below coming up through this level's floor.
function LevelView({ shell, active, slab, arriving }: { shell: Shell; active: boolean; slab: number; arriving: { stair: Stair; rise: number }[] }) {
  const openings = useMemo(() => arriving.map((a) => stairOutline(a.stair)), [arriving]);
  const guards = useMemo(() => arriving.flatMap((a) => stairGuards(a.stair, a.rise)), [arriving]);
  const walk = useOdaja((s) => s.viewMode === "walk");
  const plan = useOdaja((s) => s.viewMode === "plan");
  const wallsCut = useOdaja((s) => s.wallsCut || s.editingObjectId !== null);
  const finishes = useOdaja((s) => s.scene?.finishes);
  const clip = active && (plan || (wallsCut && !walk)) ? CUT_HEIGHT : Infinity;
  const stairsUp = useMemo(() => shell.stairs.map(stairOutline), [shell.stairs]);
  // Roofs: not on the plan, nor over the viewed level when its walls are cut
  // or roofs are switched off; always when walking.
  const roofsOn = useOdaja((s) => s.showRoofs);
  const showRoofs = !plan && (walk || ((roofsOn || !active) && !(active && wallsCut)));
  return (
    <>
      {shell.rooms.map((room) => (
        <RoomFloor key={room.id} room={room} slab={slab} openings={openings} />
      ))}
      {walk && active && shell.rooms.filter((room) => !underSlopedRoof(shell, room)).map((room) => <RoomCeiling key={`c-${room.id}`} room={room} height={shell.wallHeight} openings={stairsUp} />)}
      {shell.stairs.map((stair) => (
        <StairView key={stair.id} stair={stair} walls={shell.walls} />
      ))}
      {!plan && guards.map(([a, b], i) => <Guard key={i} from={a} to={b} />)}
      {/* Only the first level's view has the garden. */}
      <SiteView shell={shell} />
      {showRoofs && shell.roofs.map((roof) => <RoofView key={roof.id} roof={roof} base={shell.wallHeight} walls={shell.walls} />)}
      {shell.walls.map((wall) => (
        <WallView key={wall.id} wall={wall} shell={shell} openings={shell.openings.filter((o) => o.wall === wall.id)} active={active} slab={slab} />
      ))}
      {!plan && finishes?.filter((f) => f.surface === "wall").map((f) => <WallFinish key={f.id} finish={f} shell={shell} clip={clip} />)}
    </>
  );
}

// The level being viewed sits at height 0, so cameras, dragging and walking
// work the same on every level. The levels below are drawn under it (the
// plan shows only the level itself); the levels above are hidden, except
// when walking, where you see up the stairs.
export function ShellView() {
  const whole = useOdaja((s) => s.wholeShell);
  const levelId = useOdaja((s) => s.level);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const walk = useOdaja((s) => s.viewMode === "walk");
  const shown = useMemo(() => {
    if (!whole) return [];
    const active = levelById(whole, levelId);
    return levelsOf(whole)
      .filter((l) => (plan ? l.id === active.id : walk || l.elevation <= active.elevation))
      .map((l) => ({
        id: l.id,
        shell: levelShell(whole, l.id),
        offset: l.elevation - active.elevation,
        active: l.id === active.id,
        slab: isLowest(whole, l) ? 0 : l.slab,
        arriving: stairsArriving(whole, l.id),
      }));
  }, [whole, levelId, plan, walk]);
  return (
    <group>
      {shown.map((l) => (
        <group key={l.id} position={[0, M(l.offset), 0]}>
          <LevelView shell={l.shell} active={l.active} slab={l.slab} arriving={l.arriving} />
        </group>
      ))}
    </group>
  );
}
