import * as THREE from "three";
import { createSkyUniforms, SKY_DEFAULTS, updateSkyUniforms, type SkySettings } from "./preetham";
import { skyFragmentShader, skyVertexShader } from "./skyShader";

/** Camera must remain inside the dome; center it on the camera for large worlds. */
export class SkyDome extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  private readonly skyUniforms = createSkyUniforms();
  private readonly settings: SkySettings;

  constructor(settings: Partial<SkySettings> = {}) {
    super(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      name: "OdajaProceduralSky",
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    }));
    this.settings = {
      ...SKY_DEFAULTS,
      sunDirection: SKY_DEFAULTS.sunDirection.clone(),
      sunColor: SKY_DEFAULTS.sunColor.clone(),
    };
    this.material.uniforms = this.skyUniforms;
    this.frustumCulled = false;
    this.renderOrder = -Infinity;
    this.scale.setScalar(1000);
    this.update(settings);
  }

  /** Partial updates retain earlier settings; input vector/color objects are copied. */
  update(settings: Partial<SkySettings>): void {
    const next = { ...this.settings, ...settings };
    this.settings.sunDirection.copy(next.sunDirection);
    this.settings.sunColor.copy(next.sunColor);
    const direction = this.settings.sunDirection;
    const color = this.settings.sunColor;
    const ground = next.groundAlbedo;
    Object.assign(this.settings, next, {
      sunDirection: direction,
      sunColor: color,
      groundAlbedo: typeof ground === "number" ? ground : ground.clone(),
    });
    updateSkyUniforms(this.skyUniforms, this.settings);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
