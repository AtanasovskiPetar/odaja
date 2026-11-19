import type { DepthTexture, Texture } from "three";

export interface AoSettings {
  /** Denoiser signal tolerance, not a lighting multiplier. */
  strength: number;
  /** Radius in full-resolution pixels at a reference view depth of one metre. */
  radiusPx: number;
  /** View-space intersection bias, in metres. */
  threshold: number;
  /** Preserve a roughly constant world-space radius with perspective depth. */
  autoRadius: boolean;
  /** Integer ray count, clamped to 1–8. */
  rays: number;
}

export const DEFAULT_AO_SETTINGS: Readonly<AoSettings> = Object.freeze({
  strength: 1,
  radiusPx: 8,
  threshold: 0.015,
  autoRadius: true,
  rays: 8,
});

export interface GuideDescriptor {
  depth: DepthTexture;
  normalValidity: Texture;
  width: number;
  height: number;
  depthFormat: "DEPTH_COMPONENT24";
  normalFormat: "RGBA8";
}

export interface SignalDescriptor {
  texture: Texture;
  width: number;
  height: number;
  format: "RG16F";
  channels: readonly ["visibility", "variance"];
}

export interface AoStats {
  supported: boolean;
  enabled: boolean;
  reason: string | null;
  width: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
  /** Completed frames, not GPU timing. */
  frames: number;
  passes: number;
}
