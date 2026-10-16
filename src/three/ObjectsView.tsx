import { useState } from "react";
import * as THREE from "three";
import { RoundedBox, TransformControls } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Part, SceneObject } from "../model/schema";
import { moveObject } from "../model/operations";
import { M, planToWorld, rotationToWorld, worldToPlan } from "../model/units";
import { useOdaja } from "../store";
import { useMaterials } from "./materials";

// Clicking the move gizmo doesn't hit a scene mesh, which three-fiber reports as
// a "pointer missed" click. The viewport checks this to avoid deselecting.
export const gizmo = { lastUsed: 0 };

function PartMesh({ part }: { part: Part }) {
  const material = useMaterials();
  const mat = material(part.material, part.color);
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

function ObjectView({ object }: { object: SceneObject }) {
  const selected = useOdaja((s) => s.selectedId === object.id);
  const select = useOdaja((s) => s.select);
  const apply = useOdaja((s) => s.apply);
  const setDragPreview = useOdaja((s) => s.setDragPreview);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [x, y] = object.position;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(object.id);
  };

  const onDrag = () => {
    if (group) setDragPreview({ id: object.id, position: worldToPlan(group.position.x, group.position.z) });
  };

  const onDragEnd = () => {
    gizmo.lastUsed = performance.now();
    setDragPreview(null);
    if (!group) return;
    const next = worldToPlan(group.position.x, group.position.z);
    if (next[0] !== x || next[1] !== y) apply(moveObject(object.id, next));
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
          <PartMesh key={i} part={part} />
        ))}
      </group>
      {selected && group && <SelectionBox target={group} />}
      {selected && group && !object.locked && (
        <TransformControls object={group} mode="translate" showY={false} translationSnap={0.05} size={0.8} onMouseDown={() => (gizmo.lastUsed = performance.now())} onObjectChange={onDrag} onMouseUp={onDragEnd} />
      )}
    </>
  );
}

export function ObjectsView() {
  const objects = useOdaja((s) => s.scene?.objects);
  return <group>{objects?.map((object) => <ObjectView key={object.id} object={object} />)}</group>;
}
