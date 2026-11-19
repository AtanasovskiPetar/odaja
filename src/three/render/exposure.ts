import * as THREE from "three";

// Fixed calibration, not auto-exposure. ACES keeps the warm sun/wood contrast
// and is closer to the arch-viz look than AgX's flatter response. Neutral is a
// calmer material-review alternative; switch here if a project needs it.
export const EXPOSURE_EV = 0;
export const EXPOSURE = 2 ** EXPOSURE_EV;

export function configureExposure(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = EXPOSURE;
}
