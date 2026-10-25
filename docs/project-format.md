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
| `shell.json` | The home as it is: its **levels** (storeys), **walls**, **openings** (doors, windows) and **rooms** (floors) |
| `shells/*.json` | Other versions of the walls, for renovation options that move or remove walls |
| `assets/models/*.glb` | 3D models used by objects (imported files are converted to GLB) |
| `assets/textures/*` | Photo textures used by tile materials |
| `assets/plans/*` | Floor plan images shown under the plan view (PDFs are saved as their first page) |
| `.odaja/` | App data such as saved chat conversations. Leave it alone. |
| `scenes/*.json` | One file per layout or variant. Each scene holds the **objects** (furniture, fixtures) and says which shell it uses. |

Scenes use `shell.json` unless they set `"shell": "shells/<name>.json"`. Scenes
that share a shell all change when it changes. To try a furniture variant, copy a
scene file to a new name (for example `scenes/option-island-kitchen.json`) and
change its `name`. To try a **wall** change, also copy the shell to
`shells/<name>.json` and point the new scene's `shell` at it. Never edit
`shell.json` for an option: it records the flat as it is today, and the app
compares options against it.
Scene file names follow the scene's name in lowercase with dashes, the same way
the app names them. Every project keeps at least one scene.

### Saved as one file: `.odaja`

A home can also travel as a single **`.odaja` file** (Save to file in Odaja).
It's a zip of this folder: `project.json`, `shell.json`, `shells/`, `scenes/`,
`assets/`, plus `odaja.json` (`{ "format": "odaja-home", "version": 1, "savedAt": … }`).
`AGENTS.md`, `CLAUDE.md` and hidden files are left out; chats (`.odaja/chats/`)
only when the person saving chose "Include chat history". Opening the file
gives back the same folder, so an agent can unzip it, edit the files as
described here, and zip them again (keep `project.json` at the top level).

## Coordinates and units

- **Centimetres** everywhere.
- Positions are on a **top-down floor plan**: `x` grows to the right (east),
  `y` grows **down the page** (south). `[0, 0]` is the top-left (north-west) of the plan.
- Heights (`elevation`, `sill`, part `z`) are measured **up from the floor** of
  the level the thing is on.
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
`wall` unless they name another. Windows use `glass`. Anywhere a material name
is expected, `#rrggbb` also works.

**Tiles, planks and panels** add `tile`:

```json
"bath-tile": { "color": "#dfe6ea", "roughness": 0.3,
  "tile": { "size": [30, 60], "grout": 0.3, "groutColor": "#f2f2f0", "pattern": "brick", "variation": 0 } }
```

`size` is one tile in cm, `grout` the joint width in cm (default 0.2),
`pattern` one of `grid`, `brick` (½ offset), `third` (⅓ offset), `vertical`
(tiles standing), `herringbone` (planks; length a multiple of the width) or
`diagonal` (square tiles at 45°), `variation` 0–1 shade differences between
tiles. `color` is the tile colour. A **photo texture** uses
`"tile": { "size": [w, h], "image": "assets/textures/<file>.jpg" }`, where
`size` is how much real surface the image shows; it repeats as is.

### Floor plan background

`underlay` puts a floor plan image under the plan view, for tracing and
checking walls. It never changes the design.

```json
"underlay": { "image": "assets/plans/flat-m1x2.png", "width": 2400, "height": 1700,
  "scale": 0.52, "center": [620, 440], "rotation": 0, "opacity": 0.5, "visible": true }
```

`width` and `height` are the image's size in pixels, `scale` is centimetres per
pixel, `center` is where the image's centre sits on the plan (cm) and
`rotation` turns it clockwise in degrees. A plan point is
`center + rotate(rotation, (pixel - [width, height] / 2) * scale)`. Set the
scale from one known length: measure it in pixels on the image and divide the
real length by it.

### Location and north

`site` is optional and only used for sunlight: where the flat is, and which way
north points on the plan.

```json
"site": { "latitude": 41.9981, "longitude": 21.4254, "north": 20 }
```

`latitude` and `longitude` are in degrees (north and east positive). `north` is
the direction of true north on the plan, in degrees clockwise from the plan's
up (−y): 0 means up is north, 90 means north is to the right (+x). The app
works out the sun's direction for any date and time from these; nothing is
looked up online.

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
  Joinery (optional): `style`: doors `single` (default), `double`, `sliding`
  (on the wall face), `pocket` (slides into the wall), `folding`, `glass`;
  windows `casement` (default), `double-casement`, `tilt-turn`, `sliding`,
  `fixed`. `frame` width in cm, `frameMaterial` (material name or `#rrggbb`),
  `panes` glazing bars as `[columns, rows]`, `open` how far a hinged door is
  drawn open in degrees.
  An opening must fit between the wall's corners (and walls meeting it) without
  overlapping another opening. Doors also have `hinge` (`start` or `end`: which
  end of the opening, counted from the wall's `from` point) and `swing` (`left`
  or `right`: the side of the wall the door opens into, as seen walking along
  the wall from `from` to `to` on the plan with north up). Defaults are `start`
  and `left`.
- **Room**: a floor polygon (plan points) with a `name` and a `floor` material.

### Levels (storeys)

A flat is one level and needs no `levels`. A house with several storeys lists
them, and walls, rooms and objects say which level they are on with `level`:

```json
"levels": [
  { "id": "ground", "name": "Ground floor", "elevation": 0 },
  { "id": "first-floor", "name": "First floor", "elevation": 280, "height": 250 }
],
"walls": [
  { "id": "wall-north", "from": [0, 0], "to": [900, 0], "thickness": 25 },
  { "id": "wall-north-up", "level": "first-floor", "from": [0, 0], "to": [900, 0], "thickness": 25 }
]
```

- `elevation`: the level's floor height above the ground floor's, in cm
  (negative for a basement). `height`: its wall height (default `wallHeight`).
  `slab`: the floor thickness under it (default 20), drawn under its rooms;
  usually `elevation` = the level below's elevation + its wall height + `slab`.
- Anything **without `level` is on the first level listed**, so keep the
  existing ground floor first and add new levels after it. Doors and windows
  are on their wall's level, and finishes follow their wall or room.
- Every level draws its own walls: an upper floor's outer walls stand on the
  ones below at the same plan positions (copy them, with new ids).
- In the app you view and edit one level at a time; the 3D view shows it with
  the levels below it. Checks (overlaps, clearances) are per level.

## scenes/*.json

```json
{
  "version": 1,
  "name": "Current state",
  "description": "Optional longer description",
  "shell": "shell.json",
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

### Finishes

Tiles, paint and floors chosen for a scene live in its `finishes` list (so
options can differ):

```json
"finishes": [
  { "id": "finish-1", "surface": "wall", "wall": "wall-east", "side": "right", "material": "bath-tile", "from": 426, "to": 687.5, "top": 200 },
  { "id": "floor-1", "surface": "floor", "room": "living", "material": "oak-herringbone" }
]
```

A wall finish covers one side of a wall: `side` is `left` or `right` as seen
walking along the wall from its `from` to its `to` point on the plan. `from`
and `to` (cm along the wall) and `bottom` and `top` (cm above the floor) limit
it; leave them out for the whole face. Doors and windows are cut out
automatically. A floor finish replaces the room's own `floor` in this scene.

### Objects

| Field | Meaning |
|---|---|
| `id` | Unique, lowercase kebab-case (`chair-3`). Required. |
| `name` | Human name. Required. |
| `position` | `[x, y]` on the plan: where the object's origin sits. Required. |
| `elevation` | Height of the origin above the floor (default 0). Use it for wall cabinets, shelves, mirrors. |
| `rotation` | Degrees clockwise from above (default 0, front facing north). |
| `level` | The level it stands on, in a home with several levels (default: the first level). |
| `room` | Optional id of the room it belongs to (on the same level). |
| `attachedTo` | Optional id of the wall the object's back stands against. When that wall moves, the object moves with it. Set it for kitchen runs, wardrobes, toilets and anything else fixed to a wall, with the object's back (+y side) touching the wall face. |
| `locked` | `true` stops it being dragged in the app (default false). |
| `notes` | Free text, such as a product link, price or reminder. |
| `parts` | The shapes that make up the object (at least one), unless it uses a `template` or `model`. |
| `template`, `params` | Build the object from a built-in template instead of `parts` (see below). |
| `model` | Use a 3D model instead of `parts`: `{ "src": "assets/models/chair-3a2f.glb", "size": [w, d, h] }`. The model is stretched to exactly `size` (cm), centred on the object's origin and standing on its elevation, with its front towards -y like every object. |
| `libraryItem` | Set by the app when the object was placed from the furniture library: `{ "id": "oak-table", "category": "Living" }`. When someone opens a saved home, Odaja offers to add the items it uses to their library. Keep it when editing; leave it out for objects you create. |

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

### Model objects

Use a model for things that can't be built well from boxes and cylinders
(chairs, lamps, taps, real products). The user imports models in the app, which
converts them to GLB under `assets/models/`. An agent can also put a GLB there
and reference it; set `size` to the real product dimensions. Measurements and
checks use the box of `size`.

### Parts

An object is built from simple shapes positioned relative to the object's
origin, before the object's rotation is applied. **Build objects so the origin
is the centre of their footprint, the front faces north (-y) and the back
faces south (+y).** Then `rotation` behaves predictably.

| Field | Meaning |
|---|---|
| `shape` | `box`, `cylinder`, `sphere`, `wedge` or `extrusion` |
| `at` | `[x, y, z]`: `x, y` is the centre of the part's footprint relative to the object origin. `z` is the height of the part's **bottom** above the object's elevation. Default `[0, 0, 0]`. |
| `size` | box, wedge: `[width (x), depth (y), height]`. A wedge is full height at the back (+y) and zero at the front. |
| `radius` | box: corner rounding (default 0). cylinder, sphere: radius (required). |
| `height` | cylinder: its height, or its length when lying down |
| `axis` | cylinder: `z` upright (default), `x` lying left–right, `y` lying front–back (centred on `at`, resting on its z) |
| `profile`, `depth`, `axis` | extrusion: an outline (points in cm, relative to `at`) pushed out by `depth`. Axis `z` (default): an outline on the plan `[x, y]` raised by `depth` (L-shaped worktops, round tables). Axis `y`: a front-view outline `[x, up]` pushed back by `depth` (headboards, arches). Axis `x`: a side-view outline `[y, up]` pushed across by `depth`. |
| `holes` | box, extrusion: cut-outs all the way through, in the outline's plane relative to the part's centre: `{ "at": [x, y], "size": [w, d] }` or `{ "at": [x, y], "radius": r }` (sinks, hobs, cable holes) |
| `repeat` | `{ "count": 5, "step": [0, 0, 40] }`: that many copies in total, each moved by `step` (shelves, legs, slats) |
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

## Photos

Photos shared in Odaja's chat are named `photo-1`, `photo-2`, … in that
conversation. Agents use them through tools (edit_photo, save_texture) and
keep only finished results (texture images under `assets/textures/`), never
the raw photos.

## Checks the app runs

The app lists **issues** for the open scene. They never block saving, but fix
them unless the user wants them:

- **Errors**: furniture inside a wall; an opening running into a corner,
  another wall or another opening; an opening in a missing wall; a wall shorter
  than 10 cm.
- **Warnings**: furniture overlapping furniture; a door whose swing is blocked;
  too little space in front of a toilet (60 cm), basin (70), shower (70),
  kitchen units (90), tall cabinet or fridge (90), wardrobe (70) or washing
  machine (70); furniture outside every room; `attachedTo` naming a missing wall.

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

## The furniture library

Reusable furniture lives in the user's library, shared by all projects, at
`~/Documents/Odaja/Library/` (or `$ODAJA_HOME/Library/`). Each item is a folder:

```
Library/ikea-metod-sink-80/
  item.json      { "version": 1, "name": "IKEA METOD sink 80", "category": "Kitchen", "notes": "…",
                   "object": { "template": "base-cabinet", "params": { "width": 80 } } }
  model.glb      only for model items; then "object": { "model": { "src": "model.glb", "size": [w, d, h] } }
  preview.png    optional thumbnail
```

`object` holds the same fields as a scene object without `id`, `name` and
position: `template`+`params`, `parts` or `model`, plus an optional
`elevation`. Categories are Kitchen, Living, Bedroom, Bathroom, Lighting, Decor
and Other. To add something the user asked to keep (for example a piece you
built from a photo), write a new folder with an `item.json`; it shows up in the
app under **+ Add → My library**. To use a library item in a scene, copy its
`object` fields into a new scene object; for model items also copy `model.glb`
into the project's `assets/models/` and point `src` at the copy, and set the
object's `libraryItem` to `{ "id": "<folder name>", "category": "<category>" }`.
Materials added from the library carry the same `libraryItem` in `project.json`.

Library items travel as files too, both zips with an `odaja.json` that says
what they are:
- **`.odaja-item`**: one item (its `item.json`, `model.glb`, `preview.png`,
  `texture.*` at the top).
- **`.odaja-library`**: many items, each in a folder named by its id.

Opening either in Odaja adds the items to the library, skipping ones already
there (same id and same `item.json`).
