import { useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBox, TransformControls } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Part, SceneObject } from "../model/schema";
import { moveObject } from "../model/operations";
import { snapToWall } from "../model/attach";
import { roomAt } from "../model/geometry";
import { M, planToWorld, rotationToWorld, worldToPlan } from "../model/units";
import { useOdaja } from "../store";
import { useMaterials } from "./materials";

// Clicking the move gizmo doesn't hit a scene mesh, which three-fiber reports as
// a "pointer missed" click. The viewport checks this to avoid deselecting.
export const gizmo = { lastUsed: 0 };

// Furniture is shown faded while editing walls.
const GHOST = new THREE.MeshBasicMaterial({ color: "#b9b2a6", transparent: true, opacity: 0.35, depthWrite: false });

function PartMesh({ part, ghost }: { part: Part; ghost: boolean }) {
  const material = useMaterials();
  const mat = ghost ? GHOST : material(part.material, part.color);
  const [x, y, z] = part.at;
  const rotation: [number, number, number] = [0, rotationToWorld(part.rotation), 0];

  if (part.shape === "cylinder") {
    return (
      <mesh position={planToWorld(x, y, z + part.height / 2)} rotation={rotation} material={mat} castShadow receiveShadow>
        <cylinderGeometry args={[M(part.radius), M(part.radius), M(part.height), 32]} />
      </mesh>
    );
  }

  const [w, d, h] = part.size;
  const position = planToWorld(x, y, z + h / 2);
  // RoundedBox needs a radius smaller than half the thinnest side.
  const radius = Math.min(part.radius, Math.min(w, d, h) / 2 - 0.01);
  if (radius > 0.05) {
    return (
      <RoundedBox args={[M(w), M(h), M(d)]} radius={M(radius)} smoothness={3} position={position} rotation={rotation} material={mat} castShadow receiveShadow />
    );
  }
  return (
    <mesh position={position} rotation={rotation} material={mat} castShadow receiveShadow>
      <boxGeometry args={[M(w), M(h), M(d)]} />
    </mesh>
  );
}

function SelectionBox({ target }: { target: THREE.Object3D }) {
  const [helper] = useState(() => new THREE.BoxHelper(target, "#ff7a1a"));
  // Follow the object while it is being dragged.
  useFrame(() => helper.setFromObject(target));
  return <primitive object={helper} />;
}

function ObjectView({ object, ghost }: { object: SceneObject; ghost: boolean }) {
  const selected = useOdaja((s) => s.selectedId === object.id);
  const select = useOdaja((s) => s.select);
  const apply = useOdaja((s) => s.apply);
  const setDragPreview = useOdaja((s) => s.setDragPreview);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [x, y] = object.position;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (ghost) return;
    e.stopPropagation();
    select(object.id);
  };

  // Wall the object snapped to during the current drag, if any.
  const snappedWall = useRef<string | null>(null);

  const onDrag = () => {
    if (!group) return;
    let position = worldToPlan(group.position.x, group.position.z);
    const shell = useOdaja.getState().shell;
    const snap = shell ? snapToWall(object.parts, object.rotation, position, shell.walls) : null;
    snappedWall.current = snap?.wall ?? null;
    if (snap) {
      position = snap.position;
      const [wx, , wz] = planToWorld(position[0], position[1]);
      group.position.x = wx;
      group.position.z = wz;
    }
    setDragPreview({ id: object.id, position });
  };

  const onDragEnd = () => {
    gizmo.lastUsed = performance.now();
    setDragPreview(null);
    if (!group) return;
    const next = worldToPlan(group.position.x, group.position.z);
    const shell = useOdaja.getState().shell;
    if (next[0] !== x || next[1] !== y) {
      apply(moveObject(object.id, next, { room: shell ? roomAt(shell, next) : undefined, attachedTo: snappedWall.current }));
    }
  };

  return (
    <>
      <group
        ref={setGroup}
        position={planToWorld(x, y, object.elevation)}
        rotation={[0, rotationToWorld(object.rotation), 0]}
        onClick={onClick}
        userData={{ kind: "object", id: object.id }}
      >
        {object.parts.map((part, i) => (
          <PartMesh key={i} part={part} ghost={ghost} />
        ))}
      </group>
      {selected && !ghost && group && <SelectionBox target={group} />}
      {selected && !ghost && group && !object.locked && (
        <TransformControls object={group} mode="translate" showY={false} translationSnap={0.05} size={0.8} onMouseDown={() => (gizmo.lastUsed = performance.now())} onObjectChange={onDrag} onMouseUp={onDragEnd} />
      )}
    </>
  );
}

export function ObjectsView() {
  const objects = useOdaja((s) => s.scene?.objects);
  const structure = useOdaja((s) => s.mode === "structure");
  const hidden = useOdaja((s) => s.mode === "structure" && s.hideFurniture);
  if (hidden) return null;
  return <group>{objects?.map((object) => <ObjectView key={object.id} object={object} ghost={structure} />)}</group>;
}
