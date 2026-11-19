import * as THREE from "three";
import { AoPass } from "./aoPass";
import { checkTarget, signalTarget } from "./common";
import { GuideTargets } from "./guideTargets";
import { GuidedFilter } from "./guidedFilter";
import { UpsamplePass } from "./upsample";
import { DEFAULT_AO_SETTINGS, type AoSettings, type AoStats, type GuideDescriptor, type SignalDescriptor } from "./types";

export { DEFAULT_AO_SETTINGS } from "./types";
export type { AoSettings, AoStats, GuideDescriptor, SignalDescriptor } from "./types";

const dimension = (n: number) => Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;

export class AoPipeline {
  private readonly guides: GuideTargets;
  private readonly raw: THREE.WebGLRenderTarget;
  private readonly ping: THREE.WebGLRenderTarget;
  private readonly filtered: THREE.WebGLRenderTarget;
  private readonly output: THREE.WebGLRenderTarget;
  private readonly ao = new AoPass();
  private readonly filter = new GuidedFilter();
  private readonly upsample = new UpsamplePass();
  private settings: AoSettings;
  private disposed = false;
  private ready = false;
  private state: AoStats;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    width: number,
    height: number,
    settings: Partial<AoSettings> = {},
  ) {
    width = dimension(width); height = dimension(height);
    const hw = Math.ceil(width / 2), hh = Math.ceil(height / 2);
    this.guides = new GuideTargets(width, height);
    this.raw = signalTarget(hw, hh);
    this.ping = signalTarget(hw, hh);
    this.filtered = signalTarget(hw, hh);
    this.output = signalTarget(width, height);
    this.settings = { ...DEFAULT_AO_SETTINGS };
    this.setSettings(settings);
    this.state = {
      supported: false, enabled: true, reason: null, width, height,
      halfWidth: hw, halfHeight: hh, frames: 0, passes: 0,
    };
    this.probe();
  }

  private probe(): void {
    try {
      const gl = this.renderer.getContext();
      if (!("texStorage2D" in gl)) throw new Error("AO requires WebGL2");
      if (this.renderer.capabilities.logarithmicDepthBuffer || this.renderer.capabilities.reversedDepthBuffer) {
        throw new Error("AO requires standard, non-logarithmic, non-reversed depth");
      }
      if (!this.renderer.extensions.has("EXT_color_buffer_float")) throw new Error("AO requires EXT_color_buffer_float");
      if (Math.max(this.state.width, this.state.height) > this.renderer.capabilities.maxTextureSize) {
        throw new Error("AO dimensions exceed maxTextureSize");
      }
      this.guides.check(this.renderer);
      for (const target of [this.raw, this.ping, this.filtered, this.output]) checkTarget(this.renderer, target);
      this.state.supported = true;
      this.state.reason = null;
    } catch (error) {
      this.state.supported = false;
      this.state.reason = error instanceof Error ? error.message : String(error);
    }
  }

  get stats(): Readonly<AoStats> { return { ...this.state }; }
  /** Null until a successful render, or when disabled/unsupported/disposed. */
  get debugTexture(): THREE.Texture | null {
    return this.ready && this.state.enabled && this.state.supported && !this.disposed ? this.output.texture : null;
  }
  get signal(): SignalDescriptor | null {
    const texture = this.debugTexture;
    return texture ? {
      texture, width: this.state.width, height: this.state.height,
      format: "RG16F", channels: ["visibility", "variance"],
    } : null;
  }
  get guideTextures(): GuideDescriptor | null {
    return this.debugTexture ? this.guides.descriptor : null;
  }

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    if (!enabled) this.ready = false;
  }

  setSettings(settings: Partial<AoSettings>): void {
    const s = { ...this.settings, ...settings };
    this.settings = {
      strength: Math.max(0, finite(s.strength, 1)),
      radiusPx: Math.max(0.1, finite(s.radiusPx, 8)),
      threshold: Math.max(0.00001, finite(s.threshold, 0.015)),
      autoRadius: Boolean(s.autoRadius),
      rays: Math.min(8, Math.max(1, Math.round(finite(s.rays, 8)))),
    };
    this.ready = false;
  }

  render(): THREE.Texture | null {
    this.state.passes = 0;
    if (this.disposed || !this.state.enabled || !this.state.supported) return null;
    this.ready = false;
    try {
      this.guides.render(this.renderer, this.scene, this.camera);
      const guide = this.guides.descriptor;
      for (const pass of [this.ao, this.filter, this.upsample]) {
        const u = pass.material.uniforms;
        u.depthGuide!.value = guide.depth;
        u.normalGuide!.value = guide.normalValidity;
        u.fullSize!.value.set(this.state.width, this.state.height);
        u.halfSize!.value.set(this.state.halfWidth, this.state.halfHeight);
        u.projectionInverse!.value.copy(this.camera.projectionMatrixInverse);
      }
      this.ao.configure(this.settings, this.camera);
      this.ao.render(this.renderer, this.raw);
      const u = this.filter.material.uniforms;
      u.initialSignal!.value = this.raw.texture;
      u.strength!.value = this.settings.strength;
      u.radiusPx!.value = this.settings.radiusPx;
      u.signalTexture!.value = this.raw.texture;
      u.stride!.value = 1;
      this.filter.render(this.renderer, this.ping);
      u.signalTexture!.value = this.ping.texture;
      u.stride!.value = 2;
      this.filter.render(this.renderer, this.filtered);
      this.upsample.material.uniforms.signalTexture!.value = this.filtered.texture;
      this.upsample.render(this.renderer, this.output);
      this.ready = true;
      this.state.frames++;
      this.state.passes = 5;
      return this.output.texture;
    } catch (error) {
      this.state.supported = false;
      this.state.reason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    width = dimension(width); height = dimension(height);
    if (width === this.state.width && height === this.state.height) return;
    const hw = Math.ceil(width / 2), hh = Math.ceil(height / 2);
    this.ready = false;
    this.guides.resize(width, height);
    for (const target of [this.raw, this.ping, this.filtered]) target.setSize(hw, hh);
    this.output.setSize(width, height);
    Object.assign(this.state, { width, height, halfWidth: hw, halfHeight: hh, passes: 0 });
    this.probe();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.state.enabled = false;
    this.guides.dispose();
    for (const target of [this.raw, this.ping, this.filtered, this.output]) target.dispose();
    for (const pass of [this.ao, this.filter, this.upsample]) pass.dispose();
  }
}

export function createAoPipeline(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  width: number, height: number, settings: Partial<AoSettings> = {},
): AoPipeline {
  return new AoPipeline(renderer, scene, camera, width, height, settings);
}
