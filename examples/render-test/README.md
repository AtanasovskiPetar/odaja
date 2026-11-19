# Render Test

A small furnished living/dining room for judging IBL, physical materials and
guided AO/denoising together, rather than isolated material balls.

From the repository root:

```sh
ODAJA_PROJECT=examples/render-test bun run dev
```

## Room and lighting

- Clear inside dimensions: **640 × 520 cm**, height **280 cm**; 25 cm walls,
  with centrelines spanning 665 × 545 cm.
- A **340 × 215 cm fixed, three-pane south-facing window**, sill 45 cm,
  occupies x = 170–510 on the south wall. Nothing stands in front of it.
- Site: Skopje, 41.9981 N / 21.4254 E; true north is plan-up.
  Enable sunlight and try an equinox around local midday, then lower afternoon
  sun for long contact shadows. Date/time are UI state, not project fields.
- Enable lamps for the evening comparison: dining spot pendant 1100 lm / 3000 K
  (85° cone), reading floor lamp 800 lm / 2700 K, sideboard lamp 350 lm / 2700 K.
  The pendant top meets the ceiling at 280 cm; its shade starts at 177 cm.
- Living furniture is west, dining east; the southeast door and the strip behind
  the dining chairs stay clear. Low furniture keeps the overview readable.

## Ground and terrace

- The grass plot polygon is `[[-362.5,-362.5], [1027.5,-362.5],
  [1027.5,907.5], [-362.5,907.5]]` cm: 350 cm beyond every exterior wall face.
  Continuous ground extends beneath the house, below its floor, without a
  coplanar overlay. A plot makes the renderer hide the editor grid.
- The warm-grey paved south terrace runs x = -12.5–797.5,
  y = 557.5–807.5: 250 cm deep, flush in plan with the south exterior wall.
  Its east end connects to the gravel approach.
- The 120 cm wide east-door approach runs from x = 677.5 to the plot's
  east edge at 1027.5, y = 395–515. A short return at x = 677.5–797.5
  connects it to the terrace at y = 557.5. The door opening at y = 410–500
  stays clear, including its outward swing.
- The rest of the plot is dark-green grass. Four `hedge` fences follow its
  boundary centrelines, **75 cm high × 40 cm thick**, using `plant-green`.
  North and west are continuous; east has a **120 cm opening at y = 395–515**
  (`offset: 757.5` from its north end), matching the gravel approach. South
  has a **600 cm opening at x = 100–700** (`offset: 462.5` from its west
  end), keeping the terrace and south glazing visible. These are empty gate
  gaps, not gate leaves; the hedge extends 20 cm either side of the boundary.
- Two modest `tree` templates stand at the far north corners, elevation 0:
  **[-225, -225], height 320 / spread 180 cm** and **[890, -225],
  height 340 / spread 200 cm**. Their crowns stay clear of the house, door,
  terrace and south window. No south-side trees or terrace clutter were added.
- Areas meet exterior wall faces, not room polygons; they do not overlap each
  other. The renderer places plot ground 1.2 cm below the floor and flat areas
  slightly above it with built-in layer offsets to prevent z-fighting.
- Oak planks now use 20 × 120 cm modules with 0.25 cm darker joints, retaining
  the quiet third-offset pattern and low shade variation.

Inspect wall-to-ground contact shadows, the door threshold, terrace/path seam,
the sunlight patch through the south window and its continuity across the
floor, and plank joints from the default three-quarter view. The editor grid
should be hidden with this plot, not visible through the house or garden.

## Roof terrace

- The flat roof stands on the 280 cm walls; its 30 cm slab puts the paving
  surface at **310 cm**. The 40 cm overhang expands its outline to
  **x = -52.5–717.5, y = -52.5–597.5**.
- Four white box-part objects form a **45 cm high × 12 cm thick** parapet,
  all at elevation **310 cm**, with tops at **355 cm**:
  north/south centres `[332.5, -46.5]` / `[332.5, 591.5]`, each
  `770 × 12 × 45`; west/east centres `[-46.5, 272.5]` /
  `[711.5, 272.5]`, each `12 × 626 × 45` cm.
  The sides butt between the full-width ends without overlapping volumes
  or corner gaps, leaving **746 × 626 cm** of uncluttered roof surface.
- In **3D**, click the roof icon in the toolbar, titled
  **“Show the roof (hide it to look inside)”**, to hide the slab for the
  interior/sun-patch comparison. The parapets are ordinary scene objects,
  so they remain visible when the roof is hidden. Walk renders the roof
  regardless of this overview toggle.

## What to inspect

| Material / surface | Render check |
|---|---|
| `wall` warm plaster, roughness 0.9 | Broad diffuse light and AO in room corners |
| `white` ceiling palette / window frames, roughness 0.85 | Neutral reference against warm finishes |
| `oak` floor and open sideboard, roughness 0.45 | Broad, softly reflective wood highlights; plank scale |
| `walnut` dining table, coffee table, chairs and frames, roughness 0.35 | Tighter wood highlights and leg contacts |
| `travertine` coffee-table cap, roughness 0.25 | Clearcoat lobe over a pale dielectric |
| `steel` tray and accent-lamp base, metalness 0.85 / roughness 0.3 | Metallic IBL highlights |
| `black` furniture bases/legs, metalness 0.7 / roughness 0.45 | Dark metal reflection and fine contact shadows |
| `fabric-blue` natural linen sofa, roughness 1 | Fabric sheen on rounded upholstery edges |
| `velvet-cushion`, roughness 0.9 | Fabric sheen versus matte linen |
| `wool-rug`, roughness 1 | Fabric lobe, thin rug edge and table contact AO |
| `glass` window / carafe, opacity 0.25 / roughness 0.05 | Transmission and transparent overlap |
| `ceramic` vase, roughness 0.15 | Stronger clearcoat highlight beside matte plaster |
| `terracotta` planter / art, roughness 0.85 | Matte coloured dielectric |
| `lampshade` accent-lamp shade, roughness 0.9 | Warm glowing surface in evening mode |
| `plant-green` shrub / art, roughness 0.9 | Dark diffuse colour near the window |
| `grass` plot, roughness 1 | Matte ground and exterior contact shadows |
| `paving` south terrace, roughness 0.8 | Broad sunlit stone surface and quiet 60 cm joints |
| `gravel-path` east approach, roughness 1 | Matte path versus paved terrace |

Inspect AO under chair legs, the coffee-table plinth, sideboard shelf corners,
the cushions and planter. Compare sun-only and lamps-only views with the same
camera; watch for halos around the carafe and over-darkening on the rug.

## Format limitations

- `fences` belongs to the shell, alongside `plot`, not inside the plot.
  Fence body width is `thickness`; `offset` and `width` belong to `gates`.
  Gate bounds are not enforced by Zod; these gaps are within their fence
  lengths and match the intended access routes.
- A hedge is rendered as solid box stretches, not individual leaves.
  The tree template uses overlapping spherical crowns and fixed bark/leaf
  colours, not a named-material override; the small spreads are intentional.
- The roof has no parapet field: these are independent parts, not roof-linked
  geometry. This is a visual terrace, not an accessible roof route: no stair,
  roof door or safety-compliant guard is provided by the 45 cm parapet.
- Plot/area materials use the ordinary material schema: there is no dedicated
  grass or gravel texture field, grass blades, terrain displacement or plot
  elevation control. Grass and gravel here are flat colours; paving uses the
  supported procedural tile pattern. Ground/layer offsets are renderer policy,
  not project settings.
- The schema has no explicit clearcoat, sheen, transmission, anisotropy or
  texture-normal controls. The current renderer derives clearcoat from low
  roughness, transmission from opacity, and fabric sheen from material names.
  Oak at roughness 0.45 has a soft specular highlight, **not a separate sheen
  lobe**. Brushed steel is an isotropic approximation.
- `fabric-blue` is the sofa template's fixed material slot; its colour here is
  intentionally natural linen. Templates cannot accept material overrides.
  The dining table and planter use the built-in geometries expanded to parts
  to assign walnut / terracotta / green. The coffee table remains a template
  with a separate stone cap. The sideboard is a short `bookcase` template.
- There are no rug, cushion, vase, carafe or wall-art templates; these use simple
  schema-supported parts. The carafe is solid geometry, not a hollow glass model.
  Lighting templates use fixed shade colours; the accent lamp uses named materials.
- Floor and all interior wall finishes are explicit. There is **no ceiling
  finish field**: `white` supplies the ceiling palette, but the normal overview
  renderer leaves ceilings visually open (with a shadow-only sun ceiling).
  No opaque ceiling has been added to hide the room from the default camera.
- Sun time, lamp-mode enablement and the camera cannot be saved in these project
  files. This scene supplies geometry and site/light inputs, not render settings.
