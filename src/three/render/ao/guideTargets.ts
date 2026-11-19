import * as THREE from "three";
import { checkTarget, withRendererState } from "./common";
import type { GuideDescriptor } from "./types";

function isExcludedMaterial(m: THREE.Material): boolean {
  return !m.visible || m.transparent || m.opacity < 1 || !m.colorWrite || !m.depthWrite ||
    (m.blending !== THREE.NormalBlending && m.blending !== THREE.NoBlending) ||
    ("transmission" in m && Number(m.transmission) > 0);
}

export class GuideTargets {
  readonly target: THREE.WebGLRenderTarget;
  private readonly normalMaterial = new THREE.MeshNormalMaterial({ blending: THREE.NoBlending });
  private readonly hidden: THREE.Object3D[] = [];

  constructor(width: number, height: number) {
    const depth = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    depth.internalFormat = "DEPTH_COMPONENT24";
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      internalFormat: "RGBA8",
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  get descriptor(): GuideDescriptor {
    return {
      depth: this.target.depthTexture!,
      normalValidity: this.target.texture,
      width: this.target.width,
      height: this.target.height,
      depthFormat: "DEPTH_COMPONENT24",
      normalFormat: "RGBA8",
    };
  }

  check(renderer: THREE.WebGLRenderer): void { checkTarget(renderer, this.target); }
  resize(width: number, height: number): void { this.target.setSize(width, height); }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    withRendererState(renderer, () => {
      const override = scene.overrideMaterial;
      const background = scene.background;
      const hidden = this.hidden;
      hidden.length = 0;
      try {
        scene.traverse((object) => {
          if (!object.visible) return;
          const renderable = object as THREE.Mesh;
          const mat = renderable.material;
          if (!mat) return;
          // Conservative policy for mixed opaque/transparent groups: skip the entire object.
          let hide = !renderable.isMesh;
          if (!hide) {
            if (Array.isArray(mat)) {
              for (let i = 0; i < mat.length; i++) {
                if (isExcludedMaterial(mat[i]!)) { hide = true; break; }
              }
            } else {
              hide = isExcludedMaterial(mat);
            }
          }
          if (hide) {
            hidden.push(object);
            object.visible = false;
          }
        });
        scene.overrideMaterial = this.normalMaterial;
        scene.background = null;
        renderer.setRenderTarget(this.target);
        renderer.setViewport(0, 0, this.target.width, this.target.height);
        renderer.setClearColor(0, 0);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
      } finally {
        scene.overrideMaterial = override;
        scene.background = background;
        for (let i = 0; i < hidden.length; i++) hidden[i]!.visible = true;
        hidden.length = 0;
      }
    });
  }

  dispose(): void {
    this.target.dispose();
    this.normalMaterial.dispose();
  }
}
