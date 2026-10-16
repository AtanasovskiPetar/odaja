// Direct access to the plan camera for the structure editing layer, which
// handles its own pan and zoom (orbit controls are off while editing walls).
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export const planCamera: { camera: THREE.Camera | null; controls: OrbitControlsImpl | null } = {
  camera: null,
  controls: null,
};

function ortho() {
  const c = planCamera.camera;
  return c instanceof THREE.OrthographicCamera ? c : null;
}

function moveTo(x: number, z: number) {
  const camera = ortho();
  if (!camera) return;
  camera.position.x = x;
  camera.position.z = z;
  planCamera.controls?.target.set(x, 0, z);
}

// Pan by a screen distance in pixels.
export function panBy(dxPx: number, dyPx: number) {
  const camera = ortho();
  if (!camera) return;
  moveTo(camera.position.x - dxPx / camera.zoom, camera.position.z - dyPx / camera.zoom);
}

// Zoom by `factor`, keeping the point under the cursor (sx, sy in viewport
// pixels) where it is.
export function zoomAt(factor: number, sx: number, sy: number, width: number, height: number) {
  const camera = ortho();
  if (!camera) return;
  const zoom = Math.min(2000, Math.max(5, camera.zoom * factor));
  const wx = camera.position.x + (sx - width / 2) / camera.zoom;
  const wz = camera.position.z + (sy - height / 2) / camera.zoom;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  moveTo(wx - (sx - width / 2) / zoom, wz - (sy - height / 2) / zoom);
}
