import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { Opening, Room, Shell, Wall } from "../model/schema";
import { M } from "../model/units";
import { useOdaja } from "../store";
import { useMaterials } from "./materials";

// Height walls are cut at in "cut" view, so you can see into rooms from above.
const CUT_HEIGHT = 110;

interface WallPiece {
  start: number; // cm along the wall from its `from` point
  end: number;
  bottom: number; // cm above the floor
  top: number;
}

// Split a wall into solid boxes around its openings. Walls are extended by
// half their thickness at both ends so corners close up.
function wallPieces(wall: Wall, openings: Opening[], wallHeight: number): { solid: WallPiece[]; glass: WallPiece[] } {
  const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
  const height = wall.height ?? wallHeight;
  const ext = wall.thickness / 2;
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  const solid: WallPiece[] = [];
  const glass: WallPiece[] = [];
  let cursor = -ext;
  for (const o of sorted) {
    const start = o.offset;
    const end = o.offset + o.width;
    if (start > cursor) solid.push({ start: cursor, end: start, bottom: 0, top: height });
    if (o.sill > 0) solid.push({ start, end, bottom: 0, top: o.sill });
    if (o.sill + o.height < height) solid.push({ start, end, bottom: o.sill + o.height, top: height });
    if (o.type === "window") glass.push({ start, end, bottom: o.sill, top: o.sill + o.height });
    cursor = Math.max(cursor, end);
  }
  if (length + ext > cursor) solid.push({ start: cursor, end: length + ext, bottom: 0, top: height });
  return { solid, glass };
}

function cut(pieces: WallPiece[], wallsCut: boolean): WallPiece[] {
  if (!wallsCut) return pieces;
  return pieces.filter((p) => p.bottom < CUT_HEIGHT).map((p) => ({ ...p, top: Math.min(p.top, CUT_HEIGHT) }));
}

function WallView({ wall, openings, shell }: { wall: Wall; openings: Opening[]; shell: Shell }) {
  const material = useMaterials();
  const wallsCut = useOdaja((s) => s.wallsCut);
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
          <mesh key={i} position={b.position} rotation={[0, -angle, 0]} castShadow receiveShadow material={material(wall.material ?? "wall")}>
            <boxGeometry args={b.args} />
          </mesh>
        );
      })}
      {cut(glass, wallsCut).map((p, i) => {
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

function RoomFloor({ room }: { room: Room }) {
  const material = useMaterials();
  const geometry = useMemo(() => {
    // Shape coordinates are (x, -y) so that after laying the shape flat
    // (rotating -90° about X) plan y ends up on world +z.
    const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(M(x), -M(y))));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);
  const center = room.polygon.reduce((acc, [x, y]) => [acc[0] + x / room.polygon.length, acc[1] + y / room.polygon.length], [0, 0]);

  return (
    <group>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={material(room.floor ?? "oak")} />
      <Html position={[M(center[0]), 0.01, M(center[1])]} center className="room-label" zIndexRange={[10, 0]}>
        {room.name}
      </Html>
    </group>
  );
}

export function ShellView() {
  const shell = useOdaja((s) => s.shell);
  if (!shell) return null;
  return (
    <group>
      {shell.rooms.map((room) => (
        <RoomFloor key={room.id} room={room} />
      ))}
      {shell.walls.map((wall) => (
        <WallView key={wall.id} wall={wall} shell={shell} openings={shell.openings.filter((o) => o.wall === wall.id)} />
      ))}
    </group>
  );
}
