# Odaja project

This folder is an **Odaja** project: a 3D model of a home, stored as plain JSON
files. Odaja watches these files, so any edit you save appears in the app
immediately. To change the design, edit the files directly.

> This file is maintained by Odaja and overwritten when the project is opened.
> Don't edit it. Put your own notes in `NOTES.md`.

## Files

| Path | Contents |
|---|---|
| `project.json` | Project name and the named **materials** (colours) |
| `shell.json` | The flat itself: **walls**, **openings** (doors, windows) and **rooms** (floors) |
| `scenes/*.json` | One file per layout or variant. Each scene holds the **objects** (furniture, fixtures) placed in the shared shell. |

All scenes share `shell.json`. To try a variant, copy a scene file to a new
name (for example `scenes/option-island-kitchen.json`) and change its `name`.

## Coordinates and units

- **Centimetres** everywhere.
- Positions are on a **top-down floor plan**: `x` grows to the right (east),
  `y` grows **down the page** (south). `[0, 0]` is the top-left (north-west) of the plan.
- Heights (`elevation`, `sill`, part `z`) are measured **up from the floor**.
- `rotation` is in **degrees, clockwise when seen from above**. At rotation `0`
  an object's **front faces north** (towards smaller `y`) and its back faces south.
  `90` = front faces east, `180` = front faces south, `270` = front faces west.

## project.json

```json
{
  "version": 1,
  "name": "My flat",
  "units": "cm",
  "materials": {
    "oak": { "color": "#c49a6c", "roughness": 0.7 },
    "glass": { "color": "#bfe3f2", "roughness": 0.05, "opacity": 0.35 }
  }
}
```

Material fields: `color` (`#rrggbb`, required), `roughness` 0–1 (default 0.8),
`metalness` 0–1 (default 0), `opacity` 0–1 (default 1). Walls use the material
`wall` unless they name another. Windows use `glass`.

## shell.json

```json
{
  "version": 1,
  "wallHeight": 260,
  "walls": [
    { "id": "wall-north", "from": [0, 0], "to": [900, 0], "thickness": 25 }
  ],
  "openings": [
    { "id": "window-living", "wall": "wall-north", "type": "window", "offset": 100, "width": 180, "height": 150, "sill": 90 }
  ],
  "rooms": [
    { "id": "living", "name": "Living room", "polygon": [[0, 0], [500, 0], [500, 700], [0, 700]], "floor": "oak" }
  ]
}
```

- **Wall**: `from` and `to` are the wall's **centreline** end points. `thickness`
  (default 12) is split evenly on both sides of it, so the inner face of a 25 cm
  outer wall at `y = 0` is at `y = 12.5`. Optional `height` (defaults to
  `wallHeight`) and `material`.
- **Opening**: sits in the wall named by `wall`. `offset` is the distance along
  the wall from its `from` point to the opening's near edge. `type` is `door`,
  `window` or `opening`. `sill` is the height of the bottom edge (default 0).
- **Room**: a floor polygon (plan points) with a `name` and a `floor` material.

## scenes/*.json

```json
{
  "version": 1,
  "name": "Current state",
  "description": "Optional longer description",
  "objects": [
    {
      "id": "dining-table",
      "name": "Dining table",
      "room": "living",
      "position": [180, 470],
      "rotation": 0,
      "parts": [
        { "name": "top", "shape": "box", "size": [160, 90, 4], "at": [0, 0, 71], "material": "oak", "radius": 1 },
        { "shape": "cylinder", "radius": 2.5, "height": 71, "at": [-72, -37, 0], "material": "black" }
      ]
    }
  ]
}
```

### Objects

| Field | Meaning |
|---|---|
| `id` | Unique, lowercase kebab-case (`chair-3`). Required. |
| `name` | Human name. Required. |
| `position` | `[x, y]` on the plan: where the object's origin sits. Required. |
| `elevation` | Height of the origin above the floor (default 0). Use it for wall cabinets, shelves, mirrors. |
| `rotation` | Degrees clockwise from above (default 0, front facing north). |
| `room` | Optional id of the room it belongs to. |
| `locked` | `true` stops it being dragged in the app (default false). |
| `notes` | Free text, such as a product link, price or reminder. |
| `parts` | The shapes that make up the object (at least one), unless it uses a `template`. |
| `template`, `params` | Build the object from a built-in template instead of `parts` (see below). |

### Template objects

Instead of `parts`, an object can use a built-in **template** and set its sizes
with `params`. This is the quickest way to add common furniture:

```json
{ "id": "base-cabinet-1", "name": "Sink cabinet", "template": "base-cabinet", "params": { "width": 80 }, "position": [120, 657.5] }
```

Params you leave out use the defaults below. An object has **either**
`template` + `params` **or** `parts`, never both. To customise a template object
beyond its params, replace `template`/`params` with your own `parts`. The app's
"Edit as parts" button does exactly that.

<!-- templates:start -->
| Template | What | Params (defaults, cm) | Notes |
|---|---|---|---|
| `base-cabinet` | Base cabinet with worktop | `width` 60, `depth` 60, `height` 90 |  |
| `wall-cabinet` | Wall cabinet | `width` 60, `depth` 35, `height` 70 | Set `elevation` (usually 145) |
| `tall-cabinet` | Tall cabinet | `width` 60, `depth` 60, `height` 220 |  |
| `fridge` | Fridge | `width` 60, `depth` 65, `height` 200 |  |
| `table` | Table | `width` 160, `depth` 90, `height` 75 |  |
| `chair` | Chair | `width` 45, `depth` 48, `seat` 45 |  |
| `sofa` | Sofa | `width` 220, `depth` 95, `height` 85 |  |
| `coffee-table` | Coffee table | `width` 110, `depth` 60, `height` 40 |  |
| `bookcase` | Bookcase | `width` 80, `depth` 30, `height` 200, `shelves` 5 |  |
| `bed` | Bed | `width` 160, `length` 200 |  |
| `nightstand` | Nightstand | `width` 40, `depth` 40, `height` 50 |  |
| `wardrobe` | Wardrobe | `width` 200, `depth` 60, `height` 220 |  |
| `toilet` | Toilet | `width` 38, `depth` 65 |  |
| `vanity` | Vanity with basin | `width` 60, `depth` 45 |  |
| `shower` | Shower tray with glass | `width` 90, `depth` 90 |  |
| `bathtub` | Bathtub | `width` 170, `depth` 75 |  |
| `washing-machine` | Washing machine | `width` 60, `depth` 60, `height` 85 |  |
| `box` | Box | `width` 60, `depth` 60, `height` 60 |  |
| `cylinder` | Cylinder | `diameter` 50, `height` 75 |  |
<!-- templates:end -->

### Parts

An object is built from simple shapes positioned relative to the object's
origin, before the object's rotation is applied. **Build objects so the origin
is the centre of their footprint, the front faces north (-y) and the back
faces south (+y).** Then `rotation` behaves predictably.

| Field | Meaning |
|---|---|
| `shape` | `box` or `cylinder` |
| `at` | `[x, y, z]`: `x, y` is the centre of the part's footprint relative to the object origin. `z` is the height of the part's **bottom** above the object's elevation. Default `[0, 0, 0]`. |
| `size` | box only: `[width (x), depth (y), height]` |
| `radius` | box: corner rounding (default 0). cylinder: radius (required). |
| `height` | cylinder only. Cylinders stand upright. |
| `rotation` | Extra rotation of this part, degrees clockwise (default 0) |
| `material` | A name from `project.json` materials |
| `color` | `#rrggbb`, overrides the material's colour |
| `name` | Optional label such as `top` or `leg-1` |

## Checking measurements

The app's **Plan** view shows a to-scale floor plan. Dimensions along the outer
walls measure inside wall faces, broken at openings and at interior walls. Each
room shows its clear width × depth and area. Selecting an object shows its
footprint and its distance to the nearest wall or object on each side. Ask the
user to check there, or compute the same numbers from the files.

## Rules for editing

- Keep the JSON valid and keep `"version": 1`. If a file is invalid, the app
  shows the error and keeps the last good version on screen.
- Keep ids stable. Refer to and change existing objects by `id`.
- Use realistic dimensions. Common heights: dining table 75, kitchen worktop 90,
  chair seat 45, bed 45–55, toilet seat 40–42, basin 85, door 210.
- Keep objects inside rooms and clear of walls: subtract half the wall
  thickness from the wall's centreline to find its face.
- Leave walking space: about 60 cm in front of toilets and basins, 90 cm for
  main paths, 100–120 cm between a kitchen run and an island.
- Prefer adding a material to `project.json` over repeating `color` on many parts.
- To compare layouts, create a new scene file instead of overwriting the user's scene.
