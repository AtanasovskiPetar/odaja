# Material rendering

Project materials retain the existing schema. `useMaterials` derives physical
lobes at render time:

- Opaque, non-fabric dielectrics (metalness < 0.2, roughness < 0.35) receive
  clearcoat 0.25–0.4 and clearcoat roughness = roughness × 0.5.
- Glass-like dielectrics (0 < opacity < 0.5, roughness < 0.2) use alpha-blended
  `MeshPhysicalMaterial` with clearcoat 1.0, IOR 1.5 and reflectivity 1.0 by
  default so Fresnel reflections remain visible without Three's offscreen
  transmission pass (which re-renders all opaque meshes and invalidates
  Three's per-material color-space/tone-mapping cache twice per frame). Set
  `materialRendering.transmission = true` in `materials.ts` to opt into
  physical transmission (`transmission = 1 − opacity`, thickness 0.015 m).
- Plain opaque materials without clearcoat, sheen or glass stay
  `MeshStandardMaterial` (shared across all scene components via a module-level
  cache) for faster shader compilation and lower draw-call overhead.
- Names containing the words `fabric`, `curtain(s)`, `rug(s)`, `textile`,
  `linen`, `velvet`, or `upholstery` receive subtle, base-colour-tinted sheen
  (0.18, roughness 0.8) only for low-metalness materials. Hyphenated names work.
- Metalness is unchanged. Optional anisotropy is not enabled: some generated
  geometry has no usable UV/tangent frame.

Transmission is disabled in plan view. Set `materialRendering.transmission =
false` in `materials.ts` for the alpha-blended fallback on slower GPUs or
scenes with problematic pane sorting. This is runtime policy, not project data;
changing the flag requires a render to rebuild cached materials.

Imported models are prepared once per mount/rebuild through `ModelView`.
`ObjectsView` explicitly supplies the same preparation callback. Plain Standard
materials are promoted without guessing new lobes; existing Physical, legacy,
unlit and custom shader materials retain their shading. Alpha settings,
material arrays, vertex colours, maps and mesh/skinning state are retained.
Colour maps use sRGB; normal, roughness and metalness maps use NoColorSpace.
Textures shared across colour/data slots are cloned when reinterpretation is
needed so one slot cannot corrupt another.

Screen-space round edges are deliberately not shipped. Local fragment
derivatives cannot reliably identify a box/wall silhouette or a disconnected
mesh's adjacent face; without a dedicated depth/normal pass this risks seams,
false bevels and plan/helper artifacts. Use real bevel geometry instead.

Plan wash, text, selection, gizmos and ghost materials are not upgraded.
