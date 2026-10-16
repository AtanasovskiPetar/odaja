import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { M } from "../model/units";
import { useOdaja } from "../store";
import { gizmo, ObjectsView } from "./ObjectsView";
import { ShellView } from "./ShellView";

// Centre of the shell's walls in world units, used to frame the camera.
function useShellCenter(): [number, number, number] {
  const walls = useOdaja((s) => s.shell?.walls);
  if (!walls?.length) return [0, 0, 0];
  const xs = walls.flatMap((w) => [w.from[0], w.to[0]]);
  const ys = walls.flatMap((w) => [w.from[1], w.to[1]]);
  return [M((Math.min(...xs) + Math.max(...xs)) / 2), 0, M((Math.min(...ys) + Math.max(...ys)) / 2)];
}

function CameraRig() {
  const viewRequest = useOdaja((s) => s.viewRequest);
  const center = useShellCenter();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const [cx, , cz] = center;

  useEffect(() => {
    if (!controls) return;
    const kind = viewRequest?.kind ?? "perspective";
    controls.target.set(cx, 0, cz);
    if (kind === "top") camera.position.set(cx, 13, cz + 0.001);
    else camera.position.set(cx + 3, 9, cz + 9);
    controls.update();
  }, [viewRequest, controls, camera, cx, cz]);

  return null;
}

export function Viewport() {
  const select = useOdaja((s) => s.select);
  return (
    <Canvas shadows camera={{ fov: 45, near: 0.05, far: 200 }} onPointerMissed={() => performance.now() - gizmo.lastUsed > 300 && select(null)}>
      <color attach="background" args={["#eceae6"]} />
      <hemisphereLight args={["#ffffff", "#b8b0a4", 1.4]} />
      <directionalLight position={[6, 12, 4]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.5, 40]} />
      </directionalLight>
      <Grid args={[60, 60]} cellSize={0.1} sectionSize={1} cellColor="#d6d2cb" sectionColor="#bdb7ad" fadeDistance={40} position={[0, -0.002, 0]} infiniteGrid />
      <ShellView />
      <ObjectsView />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} />
      <CameraRig />
    </Canvas>
  );
}
