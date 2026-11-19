import { useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { boundsOf, shellBounds } from "../model/geometry";
import { levelById, levelsOf } from "../model/levels";
import { roofRise, roofThickness } from "../model/roofs";
import { siteBounds } from "../model/site";
import type { Underlay } from "../model/schema";
import { pixelToPlan } from "../model/underlay";

const underlayBounds = (u: Underlay) =>
  boundsOf(([[0, 0], [u.width, 0], [u.width, u.height], [0, u.height]] as [number, number][]).map((p) => pixelToPlan(u, p)));
import { M } from "../model/units";
import { useOdaja } from "../store";
import { useLamps } from "../ui/lampState";
import { useSun } from "../ui/sunState";
import { gizmo, ObjectsView } from "./ObjectsView";
import { viewport } from "./capture";
import { planCamera } from "./planCamera";
import { applyPlanTheme, useSceneTheme } from "./theme";
import { ShapeEditorView } from "./ShapeEditorView";
import { ShellView } from "./ShellView";
import { Lights } from "./SunLight";
import { Environment } from "./render/Environment";
import { AoEffect } from "./render/AoEffect";
import { setProceduralAnisotropy } from "./render/proceduralMaps";
import { UnderlayView } from "./UnderlayView";
import { WalkControls } from "./WalkControls";

// Room around the flat in plan view for the dimension lines, in metres.
const PLAN_MARGIN = 2.2;

function CameraRig() {
  const viewMode = useOdaja((s) => s.viewMode);
  const presenting = useOdaja((s) => s.presenting);
  const frameRequest = useOdaja((s) => s.frameRequest);
  const shell = useOdaja((s) => s.shell);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const underlay = useOdaja((s) => s.project?.underlay);
  const hasShell = shell !== null;
  const hasUnderlay = Boolean(underlay);

  // Frame something on request (the shape editor focusing on an object).
  const focus = useOdaja((s) => s.focus);
  useEffect(() => {
    if (!focus || !controls || viewMode !== "3d" || presenting) return;
    const [x, y, z] = focus.center;
    controls.target.set(x, y, z);
    const d = focus.radius * 1.5;
    camera.position.set(x + d * 0.5, y + d * 0.95, z + d * 0.75);
    controls.update();
    invalidate();
  }, [focus, controls, camera, viewMode, presenting, invalidate]);

  useEffect(() => {
    planCamera.camera = camera;
    planCamera.controls = controls;
  }, [camera, controls]);

  // Frame the whole flat when the view changes (not on every resize or edit).
  useEffect(() => {
    if (!controls || viewMode === "walk") return;
    // Plan frames the whole site; 3D frames the house so it does not shrink
    // inside a large garden. With neither, fall back to the plan background.
    const state = useOdaja.getState();
    const framingShell = presenting ? state.wholeShell ?? shell : shell;
    const b = framingShell
      ? (viewMode === "plan" ? siteBounds(framingShell) : shellBounds(framingShell))
      : (underlay ? underlayBounds(underlay) : null);
    const [cx, cz] = b ? [M((b.minX + b.maxX) / 2), M((b.minY + b.maxY) / 2)] : [0, 0];
    const [w, d] = b ? [M(b.maxX - b.minX), M(b.maxY - b.minY)] : [10, 10];
    controls.target.set(cx, 0, cz);
    if (camera instanceof THREE.OrthographicCamera) {
      // A tiny offset keeps "north" (-z) pointing up the screen.
      camera.position.set(cx, 50, cz + 0.0001);
      camera.zoom = Math.min(size.width / (w + 2 * PLAN_MARGIN), size.height / (d + 2 * PLAN_MARGIN));
      camera.updateProjectionMatrix();
    } else if (presenting && viewMode === "3d" && camera instanceof THREE.PerspectiveCamera) {
      // Fit all building corners, including upper storeys and the roof, with
      // a little landscape. This runs on entry, not during orbit or resizing.
      const ground = framingShell ? -M(levelById(framingShell, state.level).elevation) : 0;
      const top = framingShell ? Math.max(
        ...levelsOf(framingShell).map((l) => ground + M(l.elevation + (l.height ?? framingShell.wallHeight))),
        ...framingShell.roofs.map((r) => {
          const l = levelById(framingShell, r.level);
          return ground + M(l.elevation + (l.height ?? framingShell.wallHeight) + roofRise(r) + roofThickness(r));
        }),
      ) : 3;
      const target = new THREE.Vector3(cx, ground + 1.2, cz);
      const direction = new THREE.Vector3(0.65, 0.38, 1).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right);
      camera.fov = 40;
      // The layout has already changed, before R3F's resize observer fires.
      const host = gl.domElement.parentElement;
      const aspect = host ? host.clientWidth / Math.max(1, host.clientHeight) : size.width / size.height;
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const tanH = tanV * aspect;
      let distance = 5;
      for (const x of [-w / 2 - 0.6, w / 2 + 0.6]) {
        for (const z of [-d / 2 - 0.6, d / 2 + 0.6]) {
          for (const y of [ground, top]) {
            const corner = new THREE.Vector3(x, y - target.y, z);
            distance = Math.max(distance, corner.dot(direction) + 1.15 * Math.max(Math.abs(corner.dot(right)) / tanH, Math.abs(corner.dot(up)) / tanV));
          }
        }
      }
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.updateProjectionMatrix();
    } else {
      const reach = Math.max(w, d) * 1.05 * 1.15;
      // A lower architectural 3/4 angle: the house reads as a building instead
      // of a plan viewed from directly above.
      camera.position.set(cx + reach * 0.45, reach * 0.55, cz + reach * 1.15);
    }
    controls.update();
    invalidate();
  }, [viewMode, frameRequest, controls, camera, hasShell, hasUnderlay, presenting, invalidate]);

  return null;
}

// Gives screenshot code access to the renderer, scene and camera.
function RegisterViewport() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    Object.assign(viewport, { gl, scene, camera });
  }, [gl, scene, camera]);
  return null;
}

// Publishes the plan camera so the SVG dimension overlay can follow pan/zoom.
function PlanViewSync() {
  const setPlanView = useOdaja((s) => s.setPlanView);
  useFrame(({ camera, size }) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const current = useOdaja.getState().planView;
    const next = { centerX: camera.position.x, centerZ: camera.position.z, zoom: camera.zoom, width: size.width, height: size.height };
    if (
      !current ||
      current.centerX !== next.centerX ||
      current.centerZ !== next.centerZ ||
      current.zoom !== next.zoom ||
      current.width !== next.width ||
      current.height !== next.height
    ) {
      setPlanView(next);
    }
  });
  return null;
}

// Shadow maps only depend on geometry and lights, never camera orbit. Disable
// per-frame autoUpdate and refresh only when scene/light state changes.
function ShadowUpdater() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const shell = useOdaja((s) => s.shell);
  const wholeShell = useOdaja((s) => s.wholeShell);
  const scene = useOdaja((s) => s.scene);
  const level = useOdaja((s) => s.level);
  const viewMode = useOdaja((s) => s.viewMode);
  const wallsCut = useOdaja((s) => s.wallsCut);
  const showRoofs = useOdaja((s) => s.showRoofs);
  const editingObjectId = useOdaja((s) => s.editingObjectId);
  const dragPreview = useOdaja((s) => s.dragPreview);
  const lampsOn = useLamps((s) => s.on);
  const sunOn = useSun((s) => s.on);
  const sunDay = useSun((s) => s.day);
  const sunMinutes = useSun((s) => s.minutes);

  useEffect(() => {
    setProceduralAnisotropy(gl.capabilities.getMaxAnisotropy());
    // Skip synchronous getProgramInfoLog / getShaderInfoLog stalls in production
    // builds so shader compilation doesn't block the main thread on the GPU.
    gl.debug.checkShaderErrors = import.meta.env.DEV;
    gl.shadowMap.autoUpdate = false;
    gl.transmissionResolutionScale = 0.5;
    gl.shadowMap.needsUpdate = true;
    invalidate();
    return () => {
      gl.shadowMap.autoUpdate = true;
      gl.transmissionResolutionScale = 1;
    };
  }, [gl, invalidate]);

  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, invalidate, shell, wholeShell, scene, level, viewMode, wallsCut, showRoofs, editingObjectId, dragPreview, lampsOn, sunOn, sunDay, sunMinutes]);

  return null;
}

export function Viewport() {
  const presenting = useOdaja((s) => s.presenting);
  const select = useOdaja((s) => s.select);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const structure = useOdaja((s) => s.mode === "structure");
  const walk = useOdaja((s) => s.viewMode === "walk");
  const sunPlaying = useSun((s) => s.playing);
  const theme = useSceneTheme();
  useEffect(() => applyPlanTheme(theme), [theme]);
  // The grid is the ground: under the viewed level when it's an upper one.
  // A plot is the ground instead (the grid would show through a pool).
  const ground = useOdaja((s) => (s.wholeShell ? -M(levelById(s.wholeShell, s.level).elevation) : 0));
  const hasPlot = useOdaja((s) => Boolean(s.wholeShell?.plot));
  return (
    <Canvas frameloop={walk || sunPlaying ? "always" : "demand"} shadows dpr={[1, 1.5]} onPointerMissed={() => {
        if (performance.now() - gizmo.lastUsed < 300) return;
        // In the shape editor a click on empty space clears the part selection.
        if (useOdaja.getState().editingObjectId) useOdaja.getState().selectParts([]);
        else select(null);
      }}>
      <ShadowUpdater />
      <PerspectiveCamera makeDefault={!plan} fov={presenting ? 40 : 45} near={0.05} far={200} />
      <OrthographicCamera makeDefault={plan} near={0.1} far={200} />
      <Lights theme={theme} plan={plan} walk={walk} />
      <Environment />
      <AoEffect />
      {!presenting && !plan && !walk && !hasPlot && (
        <Grid args={[60, 60]} cellSize={0.1} sectionSize={1} cellColor={theme.gridCell} sectionColor={theme.gridSection} fadeDistance={40} position={[0, ground - 0.02, 0]} infiniteGrid />
      )}
      <ShellView />
      {!presenting && <UnderlayView />}
      <ObjectsView />
      {!presenting && <ShapeEditorView />}
      {walk && <WalkControls />}
      <OrbitControls
        makeDefault
        enabled={presenting || (!structure && !walk)}
        enableRotate={!plan}
        zoomSpeed={plan ? 2 : 1}
        maxPolarAngle={Math.PI / 2 - 0.05}
        mouseButtons={
          plan
            ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
        }
      />
      <CameraRig />
      <RegisterViewport />
      {plan && <PlanViewSync />}
    </Canvas>
  );
}
