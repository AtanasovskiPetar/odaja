import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { finishRects, floorMaterial, sideVector } from "../model/finishes";
import { pointOnWall, wallPieces, type WallPiece } from "../model/geometry";
import type { Finish, Opening, Room, Shell, Wall } from "../model/schema";
import { M } from "../model/units";
import { useOdaja } from "../store";
import { JoineryView } from "./JoineryView";
import { useMaterials } from "./materials";

// Height walls are cut at in "cut" view and in plan view, so you can see into
// rooms from above and windows and doors show as openings.
const CUT_HEIGHT = 110;
const PLAN_WALL = new THREE.MeshBasicMaterial({ color: "#3d3a36" });
const PLAN_WINDOW = new THREE.MeshBasicMaterial({ color: "#ffffff" });

function cut(pieces: WallPiece[], wallsCut: boolean): WallPiece[] {
  if (!wallsCut) return pieces;
  return pieces.filter((p) => p.bottom < CUT_HEIGHT).map((p) => ({ ...p, top: Math.min(p.top, CUT_HEIGHT) }));
}

function WallView({ wall, openings, shell }: { wall: Wall; openings: Opening[]; shell: Shell }) {
  const material = useMaterials();
  const plan = useOdaja((s) => s.viewMode === "plan");
  const walk = useOdaja((s) => s.viewMode === "walk");
  // Walls are cut low while editing a shape, so they don't hide it.
  const wallsCut = ((useOdaja((s) => s.wallsCut || s.editingObjectId !== null)) && !walk) || plan;
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
          <mesh key={i} position={b.position} rotation={[0, -angle, 0]} castShadow receiveShadow material={plan ? (p.sill ? PLAN_WINDOW : PLAN_WALL) : material(wall.material ?? "wall")}>
            <boxGeometry args={b.args} />
          </mesh>
        );
      })}
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

// Ceilings are only drawn when walking (they'd hide everything from above).
// They don't cast shadows, so daylight still reaches the rooms.
function RoomCeiling({ room, height }: { room: Room; height: number }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(M(x), -M(y))));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);
  return <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, M(height), 0]} material={CEILING} receiveShadow />;
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

function RoomFloor({ room }: { room: Room }) {
  const material = useMaterials();
  const scene = useOdaja((s) => s.scene);
  const geometry = useMemo(() => {
    // Shape coordinates are (x, -y) so that after laying the shape flat
    // (rotating -90° about X) plan y ends up on world +z.
    const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(M(x), -M(y))));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);

  return <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={material(floorMaterial(scene, room))} />;
}

export function ShellView() {
  const shell = useOdaja((s) => s.shell);
  const walk = useOdaja((s) => s.viewMode === "walk");
  const plan = useOdaja((s) => s.viewMode === "plan");
  const wallsCut = useOdaja((s) => s.wallsCut || s.editingObjectId !== null);
  const finishes = useOdaja((s) => s.scene?.finishes);
  if (!shell) return null;
  const clip = plan || (wallsCut && !walk) ? CUT_HEIGHT : Infinity;
  return (
    <group>
      {shell.rooms.map((room) => (
        <RoomFloor key={room.id} room={room} />
      ))}
      {walk && shell.rooms.map((room) => <RoomCeiling key={`c-${room.id}`} room={room} height={shell.wallHeight} />)}
      {shell.walls.map((wall) => (
        <WallView key={wall.id} wall={wall} shell={shell} openings={shell.openings.filter((o) => o.wall === wall.id)} />
      ))}
      {!plan && finishes?.filter((f) => f.surface === "wall").map((f) => <WallFinish key={f.id} finish={f} shell={shell} clip={clip} />)}
    </group>
  );
}
