import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { objectLights, type Light, type Part, type SceneObject } from "../model/schema";
import { moveObject, setObjectProps } from "../model/operations";
import { snapToWall } from "../model/attach";
import { roomAt } from "../model/geometry";
import { levelById, levelOf, levelsOf } from "../model/levels";
import { M, planToWorld, rotationToWorld, round, worldToPlan } from "../model/units";
import { selectSoon } from "./WalkControls";
import { useOdaja } from "../store";
import { sceneTheme } from "./theme";
import { useMaterials } from "./materials";
import { partGeometry, partTransform } from "./partGeometry";
import { ModelView } from "./ModelView";
import { kelvinColor, LampLight, LightHelper } from "./LampLight";
import { useLamps } from "../ui/lampState";
import { upgradeModelMaterials } from "./render/modelMaterials";
import { proceduralMaps } from "./render/proceduralMaps";
import { FALLOFF_GLSL } from "./render/falloff";
import { SHADE_SCATTER_DEFAULTS, SHADE_SCATTER_GLSL } from "./render/shadeScatter";

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color("#ffffff");

// Clicking the move gizmo doesn't hit a scene mesh, which three-fiber reports as
// a "pointer missed" click. The viewport checks this to avoid deselecting.
export const gizmo = { lastUsed: 0 };

// Furniture is shown faded while editing walls.
const GHOST = new THREE.MeshBasicMaterial({ color: "#b9b2a6", transparent: true, opacity: 0.35, depthWrite: false });

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
  glow?: { color: THREE.Color; at: Light["at"] } | null;
  castShadow?: boolean;
}) {
  const material = useMaterials();
  const base = override ?? (ghost ? GHOST : material(part.material, part.color));
  const [px, py, pz] = part.at;
  const glowing = useMemo(() => {
    if (!glow || !part.glow || !(base instanceof THREE.MeshStandardMaterial)) return null;
    if (part.name === "shade") {
      const weave = proceduralMaps("fabric");
      const options = SHADE_SCATTER_DEFAULTS;
      // Thin-shell woven fabric: diffuses the bulb with a Henyey-Greenstein
      // scatter approximation and grazing-angle edge transmission instead of
      // alpha blending or a full-scene transmission pass. Open-ended cylinders
      // stay double-sided so looking into the top or bottom reveals the inner
      // wall and bulb.
      const m = new THREE.MeshPhysicalMaterial({
        color: base.color.clone().multiplyScalar(0.78),
        roughness: 0.94,
        roughnessMap: weave.roughnessMap,
        normalMap: weave.normalMap,
        normalScale: new THREE.Vector2(0.35, 0.35),
        sheen: 0.35,
        sheenRoughness: 0.75,
        sheenColor: base.color.clone().lerp(WHITE, 0.4),
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 1,
        side: THREE.DoubleSide,
      });
      const [lightX, lightY, lightZ] = glow.at;
      const bulb = new THREE.Vector3(M(lightX - px), M(lightZ - pz), M(lightY - py))
        .applyAxisAngle(UP, (part.rotation * Math.PI) / 180);
      const shadeAlbedo = base.color.clone().multiplyScalar(0.78).multiply(glow.color);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.shadeBulb = { value: bulb };
        shader.uniforms.shadeAlbedo = { value: shadeAlbedo };
        shader.uniforms.shadeScatterRadius = { value: options.scatterRadius };
        shader.uniforms.shadeOpticalDepth = { value: options.opticalDepth };
        shader.uniforms.shadePhase = { value: options.phase };
        shader.uniforms.shadeBulbRadius = { value: options.bulbRadius };
        shader.uniforms.shadeFront = { value: options.frontScatter ? 1 : 0 };
        shader.uniforms.shadeBack = { value: options.backScatter ? 1 : 0 };
        shader.uniforms.shadeInnerStrength = { value: options.innerStrength };
        shader.uniforms.shadeOuterStrength = { value: options.outerStrength };

        shader.vertexShader = `
          varying vec3 vShadeBulbView;
          uniform vec3 shadeBulb;
          ${shader.vertexShader}
        `.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvShadeBulbView = (modelViewMatrix * vec4(shadeBulb, 1.0)).xyz;",
        );

        shader.fragmentShader = `
          varying vec3 vShadeBulbView;
          uniform vec3 shadeAlbedo;
          uniform float shadeScatterRadius;
          uniform float shadeOpticalDepth;
          uniform float shadePhase;
          uniform float shadeBulbRadius;
          uniform float shadeFront;
          uniform float shadeBack;
          uniform float shadeInnerStrength;
          uniform float shadeOuterStrength;
          ${FALLOFF_GLSL}
          ${shader.fragmentShader}
        `
          .replace(
            "roughnessFactor *= texelRoughness.g;",
            "roughnessFactor *= (texelRoughness.g + 0.5);",
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>\n${SHADE_SCATTER_GLSL}`,
          );
      };
      m.customProgramCacheKey = () => "lamp-shade-scatter-v3";
      return m;
    }
    const m = base.clone();
    m.emissive.copy(glow.color);
    const panel = part.name === "trim" || part.name === "diffuser";
    m.emissiveIntensity = part.name === "bulb" ? 1.45 : panel ? 0.85 : 0.3;
    if (part.name === "bulb") m.roughness = 0.25;
    return m;
  }, [base, glow, px, py, pz, part.glow, part.name, part.rotation]);
  useEffect(() => () => glowing?.dispose(), [glowing]);
  // Open-ended drum shades need double-sided rendering when unlit too.
  const shadeOff = useMemo(() => {
    if (glowing || part.name !== "shade" || part.shape !== "cylinder" || !(base instanceof THREE.MeshStandardMaterial)) return null;
    const m = base.clone();
    m.side = THREE.DoubleSide;
    m.onBeforeCompile = base.onBeforeCompile;
    m.customProgramCacheKey = base.customProgramCacheKey;
    return m;
  }, [base, glowing, part.name, part.shape]);
  useEffect(() => () => shadeOff?.dispose(), [shadeOff]);
  // Rebuild the geometry only when the part's shape changes.
  const key = JSON.stringify({ ...part, at: undefined, rotation: undefined, material: undefined, color: undefined, name: undefined, glow: undefined, shade: part.name === "shade" || undefined });
  const geometry = useMemo(() => partGeometry(part), [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { position, rotationY } = partTransform(part);
  const activeMaterial = glowing ?? shadeOff ?? base;
  const transmits = "transmission" in activeMaterial && Number(activeMaterial.transmission) > 0;
  return <mesh geometry={geometry} position={position} rotation={[0, rotationY, 0]} material={activeMaterial} castShadow={castShadow && !activeMaterial.transparent && !transmits} receiveShadow onClick={onClick} userData={userData} />;
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
  const presenting = useOdaja((s) => s.presenting);
  const gizmoMode = useOdaja((s) => (s.selectedId === object.id ? s.objectGizmo : "move"));
  const selectedLightIndex = useOdaja((s) => (s.selectedId === object.id ? s.selectedLightIndex : 0));
  const setSelectedLightIndex = useOdaja((s) => s.setSelectedLightIndex);
  const select = useOdaja((s) => s.select);
  const apply = useOdaja((s) => s.apply);
  const setDragPreview = useOdaja((s) => s.setDragPreview);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [lightHandle, setLightHandle] = useState<THREE.Group | null>(null);
  const [targetHandle, setTargetHandle] = useState<THREE.Group | null>(null);
  const [lightPreview, setLightPreview] = useState<{ index: number; at?: [number, number, number]; target?: [number, number, number] } | null>(null);
  const [x, y] = object.position;
  const lampsOn = useLamps((s) => s.on);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const allLights = useMemo(() => objectLights(object), [object.light, object.lights]);
  const activeLightIndex = Math.min(selectedLightIndex, Math.max(0, allLights.length - 1));
  const effectiveLights: Light[] = useMemo(() => {
    if (!lightPreview) return allLights;
    return allLights.map((l, i) =>
      i === lightPreview.index
        ? { ...l, at: lightPreview.at ?? l.at, target: lightPreview.target ?? l.target }
        : l,
    );
  }, [allLights, lightPreview]);
  const activeLight = effectiveLights[activeLightIndex] ?? null;
  const litLights = useMemo(
    () => (lampsOn && !plan && !ghost && !inert ? effectiveLights.filter((l) => l.on) : []),
    [lampsOn, plan, ghost, inert, effectiveLights],
  );
  const firstLit = litLights[0] ?? null;
  const lightKelvin = firstLit?.kelvin ?? null;
  const lx = firstLit?.at[0] ?? 0;
  const ly = firstLit?.at[1] ?? 0;
  const lz = firstLit?.at[2] ?? 0;
  const glow = useMemo(
    () => (lightKelvin !== null ? { color: kelvinColor(lightKelvin), at: [lx, ly, lz] as Light["at"] } : null),
    [lightKelvin, lx, ly, lz],
  );
  const castShadow = allLights.length === 0;

  const activeGizmo =
    gizmoMode === "light" && activeLight
      ? "light"
      : gizmoMode === "target" && activeLight && activeLight.type !== "point"
        ? "target"
        : gizmoMode === "lift" || gizmoMode === "rotate"
          ? gizmoMode
          : "move";

  // Keep local light handles synced when not actively dragging them.
  useEffect(() => {
    if (!activeLight || lightPreview) return;
    if (lightHandle) lightHandle.position.set(M(activeLight.at[0]), M(activeLight.at[2]), M(activeLight.at[1]));
    if (targetHandle) targetHandle.position.set(M(activeLight.target[0]), M(activeLight.target[2]), M(activeLight.target[1]));
  }, [activeLight, lightPreview, lightHandle, targetHandle]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // Measuring, clicks are points; walking, a drag looks around and with
    // the mouse captured the pointer isn't where you look, so only a plain click selects.
    const s = useOdaja.getState();
    if (ghost || inert || s.measuring) return;
    if (s.viewMode === "walk" && (e.delta > 4 || document.pointerLockElement)) return;
    e.stopPropagation();
    if (s.viewMode === "walk") selectSoon(object.id);
    else select(object.id);
  };

  // Wall the object snapped to during the current drag, if any.
  const snappedWall = useRef<string | null>(null);

  const onDrag = () => {
    if (!group) return;
    if (activeGizmo === "rotate") return;
    let position = worldToPlan(group.position.x, group.position.z);
    if (activeGizmo === "move") {
      const shell = useOdaja.getState().shell;
      const snap = shell ? snapToWall(object.parts, object.rotation, position, shell.walls) : null;
      snappedWall.current = snap?.wall ?? null;
      if (snap) {
        position = snap.position;
        const [wx, , wz] = planToWorld(position[0], position[1]);
        group.position.x = wx;
        group.position.z = wz;
      }
    } else {
      snappedWall.current = null;
    }
    setDragPreview({ id: object.id, position });
  };

  const onDragEnd = () => {
    gizmo.lastUsed = performance.now();
    setDragPreview(null);
    if (!group) return;
    if (activeGizmo === "rotate") {
      const deg = Math.round((((-group.rotation.y * 180) / Math.PI) % 360 + 360) % 360);
      if (deg !== object.rotation) apply(setObjectProps(object.id, { rotation: deg }));
      return;
    }
    const next = worldToPlan(group.position.x, group.position.z);
    const nextElev = round(group.position.y * 100);
    const shell = useOdaja.getState().shell;
    if (activeGizmo === "lift" && nextElev !== object.elevation) {
      apply(setObjectProps(object.id, { position: next, elevation: Math.max(0, nextElev), room: shell ? roomAt(shell, next) : undefined }));
      return;
    }
    if (next[0] !== x || next[1] !== y) {
      apply(moveObject(object.id, next, { room: shell ? roomAt(shell, next) : undefined, attachedTo: snappedWall.current }));
    }
  };

  const onLightDrag = (kind: "at" | "target") => {
    const handle = kind === "at" ? lightHandle : targetHandle;
    if (!handle) return;
    const next: [number, number, number] = [round(handle.position.x * 100), round(handle.position.z * 100), round(handle.position.y * 100)];
    setLightPreview((prev) => ({ ...(prev?.index === activeLightIndex ? prev : {}), index: activeLightIndex, [kind]: next }));
  };

  const onLightDragEnd = (kind: "at" | "target") => {
    gizmo.lastUsed = performance.now();
    const handle = kind === "at" ? lightHandle : targetHandle;
    if (handle) {
      const next: [number, number, number] = [round(handle.position.x * 100), round(handle.position.z * 100), round(handle.position.y * 100)];
      const writtenObj = useOdaja.getState().sceneDoc?.objects?.find((o) => o.id === object.id);
      if (writtenObj?.lights?.length) {
        const nextLights = writtenObj.lights.map((l, i) => (i === activeLightIndex ? { ...l, [kind]: next } : l));
        apply(setObjectProps(object.id, { lights: nextLights }));
      } else {
        apply(setObjectProps(object.id, { light: { ...writtenObj?.light, [kind]: next } }));
      }
    }
    setLightPreview(null);
  };

  const walking = useOdaja((s) => s.viewMode === "walk");
  const showEditorHelpers = selected && !presenting && !ghost && !inert;
  // Walking, a drag looks around: the selection shows, the handles don't.
  const showHandles = showEditorHelpers && !walking;

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
            prepareMaterials={upgradeModelMaterials}
            size={object.model.size}
            material={ghost ? GHOST : undefined}
            castShadow={castShadow}
            fallback={object.parts.map((part, i) => <PartMesh key={i} part={part} ghost />)}
          />
        ) : (
          object.parts.map((part, i) => <PartMesh key={i} part={part} ghost={ghost} glow={glow} castShadow={castShadow} />)
        )}
        {litLights.map((l, i) => <LampLight key={i} light={l} />)}
        {showHandles && !plan && effectiveLights.map((l, i) => (
          <LightHelper key={i} light={l} active={i === activeLightIndex} onSelect={() => setSelectedLightIndex(i)} />
        ))}
        {showHandles && !plan && activeLight && (
          <>
            <group ref={setLightHandle} position={[M(activeLight.at[0]), M(activeLight.at[2]), M(activeLight.at[1])]} userData={{ noAo: true, measureHelper: true }} />
            <group ref={setTargetHandle} position={[M(activeLight.target[0]), M(activeLight.target[2]), M(activeLight.target[1])]} userData={{ noAo: true, measureHelper: true }} />
          </>
        )}
      </group>
      {showEditorHelpers && group && activeGizmo !== "light" && activeGizmo !== "target" && <SelectionBox target={group} />}
      {showHandles && !object.locked && activeGizmo === "light" && lightHandle && (
        <TransformControls
          object={lightHandle}
          mode="translate"
          translationSnap={0.02}
          size={0.8}
          onMouseDown={() => (gizmo.lastUsed = performance.now())}
          onObjectChange={() => onLightDrag("at")}
          onMouseUp={() => onLightDragEnd("at")}
        />
      )}
      {showHandles && !object.locked && activeGizmo === "target" && targetHandle && (
        <TransformControls
          object={targetHandle}
          mode="translate"
          translationSnap={0.02}
          size={0.8}
          onMouseDown={() => (gizmo.lastUsed = performance.now())}
          onObjectChange={() => onLightDrag("target")}
          onMouseUp={() => onLightDragEnd("target")}
        />
      )}
      {showHandles && group && !object.locked && (activeGizmo === "move" || activeGizmo === "lift" || activeGizmo === "rotate") && (
        <TransformControls
          object={group}
          mode={activeGizmo === "rotate" ? "rotate" : "translate"}
          showX={activeGizmo !== "rotate"}
          showY={activeGizmo !== "move"}
          showZ={activeGizmo !== "rotate"}
          translationSnap={activeGizmo === "lift" ? 0.02 : 0.05}
          rotationSnap={Math.PI / 12}
          size={0.9}
          onMouseDown={() => (gizmo.lastUsed = performance.now())}
          onObjectChange={onDrag}
          onMouseUp={onDragEnd}
        />
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
