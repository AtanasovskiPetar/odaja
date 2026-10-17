import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Part, SceneObject } from "../model/schema";
import { moveObject } from "../model/operations";
import { snapToWall } from "../model/attach";
import { roomAt } from "../model/geometry";
import { planToWorld, rotationToWorld, worldToPlan } from "../model/units";
import { useOdaja } from "../store";
import { sceneTheme } from "./theme";
import { useMaterials } from "./materials";
import { partGeometry, partTransform } from "./partGeometry";
import { ModelView } from "./ModelView";

// Clicking the move gizmo doesn't hit a scene mesh, which three-fiber reports as
// a "pointer missed" click. The viewport checks this to avoid deselecting.
export const gizmo = { lastUsed: 0 };

// Furniture is shown faded while editing walls.
const GHOST = new THREE.MeshBasicMaterial({ color: "#b9b2a6", transparent: true, opacity: 0.35, depthWrite: false });

export function PartMesh({ part, ghost, material: override, onClick, userData }: { part: Part; ghost: boolean; material?: THREE.Material; onClick?: (e: ThreeEvent<MouseEvent>) => void; userData?: Record<string, unknown> }) {
  const material = useMaterials();
  const mat = override ?? (ghost ? GHOST : material(part.material, part.color));
  // Rebuild the geometry only when the part's shape changes.
  const key = JSON.stringify({ ...part, at: undefined, rotation: undefined, material: undefined, color: undefined, name: undefined });
  const geometry = useMemo(() => partGeometry(part), [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { position, rotationY } = partTransform(part);
  return <mesh geometry={geometry} position={position} rotation={[0, rotationY, 0]} material={mat} castShadow receiveShadow onClick={onClick} userData={userData} />;
}

function SelectionBox({ target }: { target: THREE.Object3D }) {
  const [helper] = useState(() => new THREE.BoxHelper(target, sceneTheme().accent));
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
    // While walking, clicks are for looking around.
    if (ghost || useOdaja.getState().viewMode === "walk") return;
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
        onDoubleClick={(e) => {
          if (ghost || useOdaja.getState().viewMode === "walk") return;
          e.stopPropagation();
          useOdaja.getState().editShape(object.id);
        }}
        userData={{ kind: "object", id: object.id }}
      >
        {object.model ? (
          <ModelView
            src={object.model.src}
            size={object.model.size}
            material={ghost ? GHOST : undefined}
            fallback={object.parts.map((part, i) => <PartMesh key={i} part={part} ghost />)}
          />
        ) : (
          object.parts.map((part, i) => <PartMesh key={i} part={part} ghost={ghost} />)
        )}
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
  // While editing an object's shape, it's drawn by the shape editor and the
  // rest of the furniture is faded.
  const editing = useOdaja((s) => s.editingObjectId);
  if (hidden) return null;
  return (
    <group>
      {objects?.filter((o) => o.id !== editing).map((object) => <ObjectView key={object.id} object={object} ghost={structure || !!editing} />)}
    </group>
  );
}
