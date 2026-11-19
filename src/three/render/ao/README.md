# Guided screen-space AO core

```ts
const ao = createAoPipeline(renderer, scene, camera, drawingWidth, drawingHeight, {
  strength: 1, radiusPx: 8, threshold: 0.015, autoRadius: true, rays: 8,
});
const texture = ao.render(); // Texture | null; R = visibility, G = variance
ao.resize(drawingWidth, drawingHeight);
ao.setSettings({ strength: 1.5 });
ao.setEnabled(false);
ao.dispose();
```

`AoPipeline` and the factory are exported from `index.ts`, as are settings,
descriptor and stats types and `DEFAULT_AO_SETTINGS`. `debugTexture` and `signal`
are null until a successful render (also null when disabled or disposed).
`guideTextures` exposes the corresponding guide descriptor. `stats` is a
snapshot: support/reason, enabled, dimensions, completed frames and pass count.
Textures are owned by the pipeline: do not dispose them. Re-read descriptors
after resize. A disabled/unsupported pipeline returns null; integration must
use neutral visibility 1, not stale output. Camera/scene references are fixed;
recreate when replacing them. Update camera projection before calling render.
Dimensions are drawing-buffer pixels, not CSS pixels. No beauty render or
lighting composition is performed here.

## Targets and pass order

1. Full-resolution nearest-sampled `DEPTH_COMPONENT24` / unsigned-int depth
   texture plus `RGBA8` view normals (RGB = normal * .5 + .5, A = validity).
   Clear alpha 0 and depth 1; `MeshNormalMaterial` writes alpha 1. Background,
   transparent/blended/transmissive and shadow-only objects are excluded.
2. `ceil(width/2) × ceil(height/2)` stochastic AO into nearest `RG16F`.
3. Guided 3×3 filter, stride 1, into another half-resolution `RG16F`.
4. Same filter, stride 2, into a third half-resolution `RG16F`.
5. Four-tap depth/normal bilateral upsample into full-resolution `RG16F`.

All textures are linear data (`NoColorSpace`), without MSAA or mipmaps.
No depth packing or 8-bit signal fallback: WebGL2, `EXT_color_buffer_float`,
standard depth and complete framebuffers are required, otherwise AO is
disabled with a reason. Framebuffer checks happen at creation/resize, not
per frame. No CPU pixel readback or GPU timing queries are used.
Renderer target/cube face/mip, viewport/scissor, clear colour/alpha, autoClear,
XR and shadow auto-update are restored after each pass, including exceptions.
Scene background, override material and temporary visibility are restored.

## Formula summary

Positions are reconstructed with inverse projection (perspective or orthographic).
Half pixels use full guide pixel `min(2*p+1, fullSize-1)`, consistently across
all passes, including odd dimensions. Up to eight stratified cosine-hemisphere
rays receive deterministic per-pixel hash rotation and six depth-march steps.
Offscreen rays are unoccluded. Visibility is clamped `k/n`; uncertainty is the
Jeffreys/Beta posterior variance `ab / ((a+b)^2 * (a+b+1))`,
`a=k+.5, b=n-k+.5`.

`radiusPx` is in full-resolution pixels at one metre view depth. `autoRadius`
divides pixel radius by perspective view depth (minimum .1m), giving roughly
constant world radius; disabling it preserves screen radius. Orthographic
radius remains in pixels. `threshold` is intersection bias in scene metres.
`strength` is denoiser tolerance, **not AO lighting intensity**.

The filter kernel is the outer product of `[1,2,1]/4`. Its weight is
`kernel * wRadius * wPlane * wNormal * wSignal`:

- `wRadius = 1/(1+(pixelDistance/max(1,radiusPx))²)`.
- `e = max(abs(dot(Np,Q-P)), abs(dot(Nq,Q-P)))`;
  `h=max(.005,.01*z)`; Tukey `wPlane=max(0,1-(e/h)²)²`.
- `wNormal=smoothstep(.75,.95,dot(Np,Nq))`.
- `sigma=max(.0001,strength*sqrt(vp+vq))`;
  `wSignal=1/(1+((sp-sq)/sigma)²)`.
- Invalid/different-validity taps are rejected. Invalid centres remain neutral.
  Accepted weights are normalized; variance is
  `max(.25*vInit, sum(normalizedWeight² * tapVariance))`.

Every tap is bounds-checked, never edge-clamped. The upsampler rejects invalid,
depth-different (`abs(zp-zq)>=h`), plane-different and normal-different taps,
then normalizes spatial/depth/normal weights. No accepted tap means visibility 1.

## Limitations

Screen-space approximation: no hidden/offscreen occluders, temporal history,
motion vectors, multilayer depth or physical ray tracing. Small features missed
at half resolution may become neutral during upsampling. Deterministic noise
can remain visible; variance propagation ignores spatial correlation.
Normal guides are 8-bit and use geometry normals, not normal/bump maps.
Override rendering does not reproduce source material alpha cuts, displacement,
custom shaders, per-material sidedness or clipping; use opaque mesh geometry.
Mixed-material objects with any excluded material are skipped as a whole;
excluded parents also hide their descendants for this guide pass.
Object render callbacks must not mutate the scene during guide rendering.
Logarithmic/reversed depth are explicitly unsupported. Recreate after context
loss/restoration. GPU shader compilation, image quality and performance require
browser/device validation; TypeScript/build checks do not establish these.
