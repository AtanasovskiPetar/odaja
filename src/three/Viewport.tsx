import { useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { boundsOf, shellBounds } from "../model/geometry";
import type { Underlay } from "../model/schema";
import { pixelToPlan } from "../model/underlay";

const underlayBounds = (u: Underlay) =>
  boundsOf(([[0, 0], [u.width, 0], [u.width, u.height], [0, u.height]] as [number, number][]).map((p) => pixelToPlan(u, p)));
import { M } from "../model/units";
import { useOdaja } from "../store";
import { gizmo, ObjectsView } from "./ObjectsView";
import { viewport } from "./capture";
import { planCamera } from "./planCamera";
import { applyPlanTheme, useSceneTheme } from "./theme";
import { ShapeEditorView } from "./ShapeEditorView";
import { ShellView } from "./ShellView";
import { UnderlayView } from "./UnderlayView";
import { WalkControls } from "./WalkControls";

// Room around the flat in plan view for the dimension lines, in metres.
const PLAN_MARGIN = 2.2;

function CameraRig() {
  const viewMode = useOdaja((s) => s.viewMode);
  const frameRequest = useOdaja((s) => s.frameRequest);
  const shell = useOdaja((s) => s.shell);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const underlay = useOdaja((s) => s.project?.underlay);
  const hasShell = shell !== null;
  const hasUnderlay = Boolean(underlay);

  // Frame something on request (the shape editor focusing on an object).
  const focus = useOdaja((s) => s.focus);
  useEffect(() => {
    if (!focus || !controls || viewMode !== "3d") return;
    const [x, y, z] = focus.center;
    controls.target.set(x, y, z);
    const d = focus.radius * 1.5;
    camera.position.set(x + d * 0.5, y + d * 0.95, z + d * 0.75);
    controls.update();
  }, [focus, controls, camera, viewMode]);

  useEffect(() => {
    planCamera.camera = camera;
    planCamera.controls = controls;
  }, [camera, controls]);

  // Frame the whole flat when the view changes (not on every resize or edit).
  useEffect(() => {
    if (!controls || viewMode === "walk") return;
    // No walls yet: frame the floor plan background instead.
    const b = (shell && shellBounds(shell)) || (underlay ? underlayBounds(underlay) : null);
    const [cx, cz] = b ? [M((b.minX + b.maxX) / 2), M((b.minY + b.maxY) / 2)] : [0, 0];
    const [w, d] = b ? [M(b.maxX - b.minX), M(b.maxY - b.minY)] : [10, 10];
    controls.target.set(cx, 0, cz);
    if (camera instanceof THREE.OrthographicCamera) {
      // A tiny offset keeps "north" (-z) pointing up the screen.
      camera.position.set(cx, 50, cz + 0.0001);
      camera.zoom = Math.min(size.width / (w + 2 * PLAN_MARGIN), size.height / (d + 2 * PLAN_MARGIN));
      camera.updateProjectionMatrix();
    } else {
      camera.position.set(cx + w * 0.3, Math.max(w, d) * 1.05, cz + Math.max(w, d) * 1.05);
    }
    controls.update();
  }, [viewMode, frameRequest, controls, camera, hasShell, hasUnderlay]);

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

export function Viewport() {
  const select = useOdaja((s) => s.select);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const structure = useOdaja((s) => s.mode === "structure");
  const walk = useOdaja((s) => s.viewMode === "walk");
  const theme = useSceneTheme();
  useEffect(() => applyPlanTheme(theme), [theme]);
  return (
    <Canvas shadows onPointerMissed={() => {
        if (performance.now() - gizmo.lastUsed < 300) return;
        // In the shape editor a click on empty space clears the part selection.
        if (useOdaja.getState().editingObjectId) useOdaja.getState().selectParts([]);
        else select(null);
      }}>
      <PerspectiveCamera makeDefault={!plan} fov={45} near={0.05} far={200} />
      <OrthographicCamera makeDefault={plan} near={0.1} far={200} />
      <color attach="background" args={[plan ? theme.paper : walk ? theme.walk : theme.room]} />
      <hemisphereLight args={["#ffffff", theme.ground, plan ? 2.2 : walk ? 2.0 : 1.4]} />
      <directionalLight position={[6, 12, 4]} intensity={plan ? 0.8 : 1.6} castShadow={!plan} shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.5, 40]} />
      </directionalLight>
      {!plan && !walk && (
        <Grid args={[60, 60]} cellSize={0.1} sectionSize={1} cellColor={theme.gridCell} sectionColor={theme.gridSection} fadeDistance={40} position={[0, -0.02, 0]} infiniteGrid />
      )}
      <ShellView />
      <UnderlayView />
      <ObjectsView />
      <ShapeEditorView />
      {walk && <WalkControls />}
      <OrbitControls
        makeDefault
        enabled={!structure && !walk}
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
