// Doors and windows in 3D: frames, sashes, glazing bars, glass, handles and
// door leaves (drawn slightly open). Built in the wall's own frame: x along
// the wall from its `from` point, y up, z towards its right side (cm).
import type { ReactNode } from "react";
import * as THREE from "three";
import type { Opening, Wall } from "../model/schema";
import { M } from "../model/units";
import { useMaterials } from "./materials";

type Mat = (name?: string, color?: string) => THREE.MeshStandardMaterial;

// A box from (x0,y0,z0) to (x1,y1,z1) in wall cm.
function Box({ x0, x1, y0, y1, z0, z1, material }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; material: THREE.Material }) {
  if (x1 - x0 <= 0 || y1 - y0 <= 0 || z1 - z0 <= 0) return null;
  return (
    // Glass lets the light through: it casts no shadow.
    <mesh position={[M((x0 + x1) / 2), M((y0 + y1) / 2), M((z0 + z1) / 2)]} material={material} castShadow={!material.transparent} receiveShadow>
      <boxGeometry args={[M(x1 - x0), M(y1 - y0), M(z1 - z0)]} />
    </mesh>
  );
}

// Glass with optional glazing bars, in the rectangle x0..x1, y0..y1 at depth z.
function Glazing({ x0, x1, y0, y1, z, panes, frameMat, glass }: { x0: number; x1: number; y0: number; y1: number; z: number; panes: [number, number]; frameMat: THREE.Material; glass: THREE.Material }) {
  const bars: ReactNode[] = [];
  const [cols, rows] = panes;
  for (let i = 1; i < cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols;
    bars.push(<Box key={`c${i}`} x0={x - 1} x1={x + 1} y0={y0} y1={y1} z0={z - 1.5} z1={z + 1.5} material={frameMat} />);
  }
  for (let j = 1; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    bars.push(<Box key={`r${j}`} x0={x0} x1={x1} y0={y - 1} y1={y + 1} z0={z - 1.5} z1={z + 1.5} material={frameMat} />);
  }
  return (
    <>
      <Box x0={x0} x1={x1} y0={y0} y1={y1} z0={z - 0.4} z1={z + 0.4} material={glass} />
      {bars}
    </>
  );
}

// A frame (ring of four bars) around x0..x1, y0..y1, `f` wide, depth z0..z1.
function Ring({ x0, x1, y0, y1, f, z0, z1, material }: { x0: number; x1: number; y0: number; y1: number; f: number; z0: number; z1: number; material: THREE.Material }) {
  return (
    <>
      <Box x0={x0} x1={x0 + f} y0={y0} y1={y1} z0={z0} z1={z1} material={material} />
      <Box x0={x1 - f} x1={x1} y0={y0} y1={y1} z0={z0} z1={z1} material={material} />
      <Box x0={x0 + f} x1={x1 - f} y0={y1 - f} y1={y1} z0={z0} z1={z1} material={material} />
      <Box x0={x0 + f} x1={x1 - f} y0={y0} y1={y0 + f} z0={z0} z1={z1} material={material} />
    </>
  );
}

function WindowModel({ o, wall, material, clip }: { o: Opening; wall: Wall; material: Mat; clip: number }) {
  const frameMat = material(o.frameMaterial ?? "#f4f4f2");
  const glass = material("glass");
  const handle = material("steel");
  const f = o.frame ?? 6;
  const depth = Math.min(wall.thickness, 9);
  const [z0, z1] = [-depth / 2, depth / 2];
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const y0 = o.sill;
  const y1 = Math.min(o.sill + o.height, clip);
  if (y1 <= y0) return null;
  const panes = o.panes ?? [1, 1];
  const style = o.style ?? "casement";
  const inner = { x0: x0 + f, x1: x1 - f, y0: y0 + f, y1: y1 - f };
  const sash = 5;
  const parts: ReactNode[] = [<Ring key="frame" x0={x0} x1={x1} y0={y0} y1={y1} f={f} z0={z0} z1={z1} material={frameMat} />];

  if (style === "fixed") {
    parts.push(<Glazing key="g" {...inner} z={0} panes={panes} frameMat={frameMat} glass={glass} />);
  } else if (style === "sliding") {
    // Two sashes overlapping in the middle, on two tracks.
    const mid = (inner.x0 + inner.x1) / 2;
    const overlap = 4;
    [
      { a: inner.x0, b: mid + overlap, z: -2 },
      { a: mid - overlap, b: inner.x1, z: 2 },
    ].forEach((s, i) => {
      parts.push(<Ring key={`s${i}`} x0={s.a} x1={s.b} y0={inner.y0} y1={inner.y1} f={sash} z0={s.z - 2} z1={s.z + 2} material={frameMat} />);
      parts.push(<Glazing key={`sg${i}`} x0={s.a + sash} x1={s.b - sash} y0={inner.y0 + sash} y1={inner.y1 - sash} z={s.z} panes={panes} frameMat={frameMat} glass={glass} />);
    });
  } else {
    // Casement, tilt-turn: one sash; double casement: two with a mullion.
    const sashes =
      style === "double-casement"
        ? [
            { a: inner.x0, b: (inner.x0 + inner.x1) / 2 },
            { a: (inner.x0 + inner.x1) / 2, b: inner.x1 },
          ]
        : [{ a: inner.x0, b: inner.x1 }];
    sashes.forEach((s, i) => {
      parts.push(<Ring key={`s${i}`} x0={s.a} x1={s.b} y0={inner.y0} y1={inner.y1} f={sash} z0={-3} z1={3} material={frameMat} />);
      parts.push(<Glazing key={`sg${i}`} x0={s.a + sash} x1={s.b - sash} y0={inner.y0 + sash} y1={inner.y1 - sash} z={0} panes={panes} frameMat={frameMat} glass={glass} />);
      // Handle on the side away from the hinge (the middle for double).
      const hx = sashes.length === 2 ? (i === 0 ? s.b - sash / 2 : s.a + sash / 2) : o.hinge === "start" ? s.b - sash / 2 : s.a + sash / 2;
      const hy = (inner.y0 + inner.y1) / 2;
      if (hy < clip) parts.push(<Box key={`h${i}`} x0={hx - 1} x1={hx + 1} y0={hy - 6} y1={hy + 6} z0={-5} z1={5} material={handle} />);
    });
  }
  return <>{parts}</>;
}

function DoorLeaf({ width, height, glass, frameMat, leafMat, handleMat, panes, handleAt }: { width: number; height: number; glass: boolean; frameMat: THREE.Material; leafMat: THREE.Material; handleMat: THREE.Material; panes: [number, number]; handleAt: number }) {
  // Leaf from x=0 (hinge) to x=width, 4 cm thick, centred on z=0.
  const t = 4;
  return (
    <>
      {glass ? (
        <>
          <Ring x0={0} x1={width} y0={0} y1={height} f={8} z0={-t / 2} z1={t / 2} material={frameMat} />
          <Glazing x0={8} x1={width - 8} y0={8} y1={height - 8} z={0} panes={panes} frameMat={frameMat} glass={leafMat} />
        </>
      ) : (
        <Box x0={0} x1={width} y0={0} y1={height} z0={-t / 2} z1={t / 2} material={leafMat} />
      )}
      {handleAt < height && <Box x0={handleAt - 6} x1={handleAt + 1} y0={102} y1={106} z0={-t / 2 - 5} z1={t / 2 + 5} material={handleMat} />}
    </>
  );
}

function DoorModel({ o, wall, material, clip }: { o: Opening; wall: Wall; material: Mat; clip: number }) {
  const frameMat = material(o.frameMaterial ?? "#f4f4f2");
  const leafMat = material(o.style === "glass" ? "glass" : (o.frameMaterial ?? "#f4f4f2"));
  const handleMat = material("steel");
  const f = o.frame ?? 4;
  const t = wall.thickness;
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const top = Math.min(o.height, clip);
  const leafH = Math.min(o.height - f - 1, clip);
  const style = o.style ?? "single";
  const panes = o.panes ?? [1, 1];
  const sideSign = o.swing === "right" ? 1 : -1;
  const openRad = ((o.open ?? 20) * Math.PI) / 180;
  const parts: ReactNode[] = [];

  // Casing: jambs and head lining the opening, slightly proud of both faces.
  parts.push(<Box key="jl" x0={x0} x1={x0 + f} y0={0} y1={top} z0={-t / 2 - 1} z1={t / 2 + 1} material={frameMat} />);
  parts.push(<Box key="jr" x0={x1 - f} x1={x1} y0={0} y1={top} z0={-t / 2 - 1} z1={t / 2 + 1} material={frameMat} />);
  if (o.height - f < clip) parts.push(<Box key="hd" x0={x0} x1={x1} y0={o.height - f} y1={o.height} z0={-t / 2 - 1} z1={t / 2 + 1} material={frameMat} />);
  if (leafH <= 0) return <>{parts}</>;
  const clear = o.width - 2 * f;
  const leafProps = { height: leafH, glass: style === "glass", frameMat, leafMat, handleMat, panes };

  // A hinged leaf of `width` at x = hingeX, opening towards the swing side.
  const hinged = (key: string, hingeX: number, width: number, fromStart: boolean) => {
    const zFace = sideSign * (t / 2 - 2);
    const angle = (fromStart ? -1 : 1) * sideSign * openRad;
    return (
      <group key={key} position={[M(hingeX), 0, M(zFace)]} rotation={[0, angle, 0]}>
        <group scale={[fromStart ? 1 : -1, 1, 1]}>
          <DoorLeaf width={width} handleAt={width - 6} {...leafProps} />
        </group>
      </group>
    );
  };

  if (style === "double") {
    parts.push(hinged("l", x0 + f, clear / 2, true), hinged("r", x1 - f, clear / 2, false));
  } else if (style === "sliding") {
    // Leaf on the wall face on the swing side, with a rail above; drawn half open.
    const z = sideSign * (t / 2 + 3);
    const slide = o.hinge === "start" ? -0.45 * clear : 0.45 * clear;
    parts.push(
      <group key="slide" position={[M(x0 + f + slide), 0, M(z)]}>
        <DoorLeaf width={clear + 6} handleAt={o.hinge === "start" ? clear : 6} {...leafProps} />
      </group>,
    );
    if (o.height + 6 < clip) parts.push(<Box key="rail" x0={x0 - clear * 0.5} x1={x1 + clear * 0.5} y0={o.height + 1} y1={o.height + 6} z0={z - 3} z1={z + 3} material={handleMat} />);
  } else if (style === "pocket") {
    // Leaf slid mostly into the wall cavity; the edge and handle show.
    const slide = o.hinge === "start" ? -0.8 * clear : 0.8 * clear;
    parts.push(
      <group key="pocket" position={[M(x0 + f + slide), 0, 0]}>
        <DoorLeaf width={clear} handleAt={o.hinge === "start" ? clear - 4 : 4} {...leafProps} />
      </group>,
    );
  } else if (style === "folding") {
    // Two panels folded into a shallow V at the hinge side.
    const half = clear / 2;
    const fromStart = o.hinge === "start";
    const hingeX = fromStart ? x0 + f : x1 - f;
    const a = 45 * (Math.PI / 180);
    const dir = fromStart ? 1 : -1;
    parts.push(
      <group key="fold" position={[M(hingeX), 0, M(sideSign * (t / 2 - 2))]} rotation={[0, -dir * sideSign * a, 0]}>
        <group scale={[dir, 1, 1]}>
          <DoorLeaf width={half} handleAt={half + 10} {...leafProps} />
          <group position={[M(half), 0, 0]} rotation={[0, 2 * sideSign * a, 0]}>
            <DoorLeaf width={half} handleAt={half - 6} {...leafProps} />
          </group>
        </group>
      </group>,
    );
  } else {
    const fromStart = o.hinge === "start";
    parts.push(hinged("leaf", fromStart ? x0 + f : x1 - f, clear, fromStart));
  }
  return <>{parts}</>;
}

// All doors and windows of a wall. `clip` cuts them at a height (cut views).
export function JoineryView({ wall, openings, clip }: { wall: Wall; openings: Opening[]; clip: number }) {
  const material = useMaterials();
  const angle = Math.atan2(wall.to[1] - wall.from[1], wall.to[0] - wall.from[0]);
  return (
    <group position={[M(wall.from[0]), 0, M(wall.from[1])]} rotation={[0, -angle, 0]}>
      {openings.map((o) =>
        o.type === "window" ? (
          <WindowModel key={o.id} o={o} wall={wall} material={material} clip={clip} />
        ) : o.type === "door" ? (
          <DoorModel key={o.id} o={o} wall={wall} material={material} clip={clip} />
        ) : null,
      )}
    </group>
  );
}
