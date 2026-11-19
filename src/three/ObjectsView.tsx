import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Light, Part, SceneObject } from "../model/schema";
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
import { upgradeModelMaterials } from "./render/modelMaterials";
import { proceduralMaps } from "./render/proceduralMaps";

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color("#ffffff");

function shadeDimensions(part: Part): [number, number] {
  if (part.shape === "cylinder") return [M(part.radius), M(part.height / 2)];
  if (part.shape === "box") return [M(Math.max(part.size[0], part.size[1]) / 2), M(part.size[2] / 2)];
  return [0.16, 0.12];
}

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
  const [shadeRadius, shadeHalfHeight] = shadeDimensions(part);
  const glowing = useMemo(() => {
    if (!glow || !part.glow || !(base instanceof THREE.MeshStandardMaterial)) return null;
    if (part.name === "shade") {
      const weave = proceduralMaps("fabric");
      // Opaque woven fabric: real linen diffuses the bulb rather than showing
      // its silhouette through alpha blending, and avoids an extra transmission
      // pass. Open-ended cylinders stay double-sided so looking into the top or
      // bottom reveals the brighter inner wall and bulb.
      const m = new THREE.MeshPhysicalMaterial({
        color: base.color.clone().multiplyScalar(0.85),
        roughness: 0.92,
        roughnessMap: weave.roughnessMap,
        normalMap: weave.normalMap,
        normalScale: new THREE.Vector2(0.35, 0.35),
        sheen: 0.4,
        sheenRoughness: 0.7,
        sheenColor: base.color.clone().lerp(WHITE, 0.35),
        emissive: glow.color,
        emissiveIntensity: 1,
        side: THREE.DoubleSide,
      });
      const [lightX, lightY, lightZ] = glow.at;
      const bulb = new THREE.Vector3(M(lightX - px), M(lightZ - pz), M(lightY - py))
        .applyAxisAngle(UP, (part.rotation * Math.PI) / 180);
      const dims = new THREE.Vector2(shadeRadius, shadeHalfHeight);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.shadeBulb = { value: bulb };
        shader.uniforms.shadeDims = { value: dims };
        shader.vertexShader = `varying vec3 vShadePosition;\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvShadePosition = position;",
        );
        shader.fragmentShader = `varying vec3 vShadePosition;\nuniform vec3 shadeBulb;\nuniform vec2 shadeDims;\n${shader.fragmentShader}`
          .replace(
            "roughnessFactor *= texelRoughness.g;",
            "roughnessFactor *= (texelRoughness.g + 0.5);",
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
            vec3 fromBulb = vShadePosition - shadeBulb;
            float dy = fromBulb.y / max(shadeDims.y, 0.05);
            float dr = length(fromBulb.xz) / max(shadeDims.x, 0.05);
            float verticalFalloff = exp(-1.35 * dy * dy);
            float radialFalloff = 1.0 / (0.65 + 0.35 * dr * dr);
            float glowProfile = 0.22 + 0.78 * verticalFalloff * radialFalloff;
            #ifdef USE_ROUGHNESSMAP
              float weaveNoise = clamp((texelRoughness.g - 0.5) / 0.06, -1.0, 1.0);
              float weaveTrans = 1.0 + 0.16 * weaveNoise;
            #else
              float weaveTrans = 1.0;
            #endif
            float ndotv = abs(dot(normalize(normal), normalize(vViewPosition)));
            float edgeFactor = mix(0.68, 1.0, smoothstep(0.0, 0.65, ndotv));
            if (gl_FrontFacing) {
              vec3 dye = diffuseColor.rgb * vec3(1.04, 0.96, 0.84);
              totalEmissiveRadiance *= dye * (1.15 * glowProfile * weaveTrans * edgeFactor);
            } else {
              totalEmissiveRadiance *= mix(vec3(1.0), diffuseColor.rgb, 0.45) * (1.65 * glowProfile);
            }`,
          );
      };
      m.customProgramCacheKey = () => "lamp-shade-fabric-v2";
      return m;
    }
    const m = base.clone();
    m.emissive.copy(glow.color);
    const panel = part.name === "trim" || part.name === "diffuser";
    m.emissiveIntensity = part.name === "bulb" ? 1.9 : panel ? 0.85 : 0.3;
    if (part.name === "bulb") m.roughness = 0.25;
    return m;
  }, [base, glow, px, py, pz, part.glow, part.name, part.rotation, shadeRadius, shadeHalfHeight]);
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
  const select = useOdaja((s) => s.select);
  const apply = useOdaja((s) => s.apply);
  const setDragPreview = useOdaja((s) => s.setDragPreview);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [x, y] = object.position;
  const lampsOn = useLamps((s) => s.on);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const light = lampsOn && !plan && !ghost && !inert && object.light?.on ? object.light : null;
  const lightKelvin = light?.kelvin ?? null;
  const lx = light?.at[0] ?? 0;
  const ly = light?.at[1] ?? 0;
  const lz = light?.at[2] ?? 0;
  const glow = useMemo(
    () => (lightKelvin !== null ? { color: kelvinColor(lightKelvin), at: [lx, ly, lz] as Light["at"] } : null),
    [lightKelvin, lx, ly, lz],
  );
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
            prepareMaterials={upgradeModelMaterials}
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
