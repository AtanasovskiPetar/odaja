import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Part, SceneObject } from "../model/schema";
import { moveObject } from "../model/operations";
import { snapToWall } from "../model/attach";
import { roomAt } from "../model/geometry";
import { levelById, levelOf, levelsOf } from "../model/levels";
import { M, planToWorld, rotationToWorld, worldToPlan } from "../model/units";
import { useOdaja } from "../store";
import { sceneTheme } from "./theme";
import { useMaterials } from "./materials";
import { partGeometry, partTransform } from "./partGeometry";
import { ModelView } from "./ModelView";
import { kelvinColor, LampLight } from "./LampLight";
import { useLamps } from "../ui/lampState";

// Clicking the move gizmo doesn't hit a scene mesh, which three-fiber reports as
// a "pointer missed" click. The viewport checks this to avoid deselecting.
export const gizmo = { lastUsed: 0 };

// Furniture is shown faded while editing walls.
const GHOST = new THREE.MeshBasicMaterial({ color: "#b9b2a6", transparent: true, opacity: 0.35, depthWrite: false });

// `glow`: the colour of the object's light while it's lit, for glowing parts.
// Lamps don't cast shadows: their shades would block their own light.
export function PartMesh({
  part,
  ghost,
  material: override,
  onClick,
  userData,
  glow,
  castShadow = true,
}: {
  part: Part;
  ghost: boolean;
  material?: THREE.Material;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  userData?: Record<string, unknown>;
  glow?: THREE.Color | null;
  castShadow?: boolean;
}) {
  const material = useMaterials();
  const base = override ?? (ghost ? GHOST : material(part.material, part.color));
  const glowing = useMemo(() => {
    if (!glow || !part.glow || !(base instanceof THREE.MeshStandardMaterial)) return null;
    const m = base.clone();
    m.emissive = glow;
    return m;
  }, [base, glow, part.glow]);
  useEffect(() => () => glowing?.dispose(), [glowing]);
  // Rebuild the geometry only when the part's shape changes.
  const key = JSON.stringify({ ...part, at: undefined, rotation: undefined, material: undefined, color: undefined, name: undefined, glow: undefined });
  const geometry = useMemo(() => partGeometry(part), [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { position, rotationY } = partTransform(part);
  return <mesh geometry={geometry} position={position} rotation={[0, rotationY, 0]} material={glowing ?? base} castShadow={castShadow} receiveShadow onClick={onClick} userData={userData} />;
}

function SelectionBox({ target }: { target: THREE.Object3D }) {
  const [helper] = useState(() => new THREE.BoxHelper(target, sceneTheme().accent));
  // Follow the object while it is being dragged.
  useFrame(() => helper.setFromObject(target));
  return <primitive object={helper} />;
}

// `inert`: furniture on a level below the one being viewed, drawn but not
// selectable.
function ObjectView({ object, ghost, inert = false }: { object: SceneObject; ghost: boolean; inert?: boolean }) {
  const selected = useOdaja((s) => s.selectedId === object.id);
  const select = useOdaja((s) => s.select);
  const apply = useOdaja((s) => s.apply);
  const setDragPreview = useOdaja((s) => s.setDragPreview);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [x, y] = object.position;
  const lampsOn = useLamps((s) => s.on);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const light = lampsOn && !plan && !ghost && !inert && object.light?.on ? object.light : null;
  const glow = useMemo(() => (light ? kelvinColor(light.kelvin) : null), [light?.kelvin]);
  const castShadow = !object.light;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // While walking, clicks are for looking around.
    if (ghost || inert || useOdaja.getState().viewMode === "walk") return;
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
          if (ghost || inert || useOdaja.getState().viewMode === "walk") return;
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
            castShadow={castShadow}
            fallback={object.parts.map((part, i) => <PartMesh key={i} part={part} ghost />)}
          />
        ) : (
          object.parts.map((part, i) => <PartMesh key={i} part={part} ghost={ghost} glow={glow} castShadow={castShadow} />)
        )}
        {light && <LampLight light={light} />}
      </group>
      {selected && !ghost && !inert && group && <SelectionBox target={group} />}
      {selected && !ghost && !inert && group && !object.locked && (
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
      <OtherLevelObjects />
    </group>
  );
}

// Furniture on the levels under the one being viewed (and, when walking,
// above it), at their height: the viewed level is at 0 (see ShellView). Not
// in the plan.
function OtherLevelObjects() {
  const whole = useOdaja((s) => s.wholeShell);
  const scene = useOdaja((s) => s.wholeScene);
  const levelId = useOdaja((s) => s.level);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const walk = useOdaja((s) => s.viewMode === "walk");
  if (!whole || !scene || plan || !whole.levels.length) return null;
  const active = levelById(whole, levelId);
  const below = levelsOf(whole).filter((l) => l.id !== active.id && (walk || l.elevation <= active.elevation));
  return (
    <>
      {below.map((l) => (
        <group key={l.id} position={[0, M(l.elevation - active.elevation), 0]}>
          {scene.objects.filter((o) => levelOf(o, whole) === l.id).map((o) => <ObjectView key={o.id} object={o} ghost={false} inert />)}
        </group>
      ))}
    </>
  );
}
