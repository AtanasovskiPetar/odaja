// Sizes and footprints of parts, for every shape. Coordinates are an
// object's own frame (cm): x right, y back (+y) / front (-y), z up from the
// object's elevation.
import type { Vec } from "./geometry";
import type { Part } from "./schema";

export interface PartBox {
  // Footprint corners on the plan, after the part's own rotation.
  corners: Vec[];
  bottom: number;
  top: number;
}

const rotate = ([x, y]: Vec, degrees: number): Vec => {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

// Extent of a part around its `at` point before its rotation:
// [minX, maxX, minY, maxY, minZ, maxZ] relative to `at`.
export function partExtent(part: Part): [number, number, number, number, number, number] {
  switch (part.shape) {
    case "box":
    case "wedge":
      return [-part.size[0] / 2, part.size[0] / 2, -part.size[1] / 2, part.size[1] / 2, 0, part.size[2]];
    case "sphere":
      return [-part.radius, part.radius, -part.radius, part.radius, 0, 2 * part.radius];
    case "cylinder": {
      const { radius: r, height: h } = part;
      if (part.axis === "x") return [-h / 2, h / 2, -r, r, 0, 2 * r];
      if (part.axis === "y") return [-r, r, -h / 2, h / 2, 0, 2 * r];
      return [-r, r, -r, r, 0, h];
    }
    case "extrusion": {
      const as = part.profile.map((p) => p[0]);
      const bs = part.profile.map((p) => p[1]);
      const [a0, a1, b0, b1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
      const d = part.depth;
      if (part.axis === "y") return [a0, a1, -d / 2, d / 2, b0, b1];
      if (part.axis === "x") return [-d / 2, d / 2, a0, a1, b0, b1];
      return [a0, a1, b0, b1, 0, d];
    }
  }
}

export function partBox(part: Part): PartBox {
  const [x0, x1, y0, y1, z0, z1] = partExtent(part);
  const corners = ([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as Vec[]).map((c) => {
    const [x, y] = rotate(c, part.rotation);
    return [x + part.at[0], y + part.at[1]] as Vec;
  });
  return { corners, bottom: part.at[2] + z0, top: part.at[2] + z1 };
}

// Footprint of a part on the plan, for an object at `position` turned by `rotation`.
export function partFootprint(part: Part, position: Vec, rotation: number): { poly: Vec[]; bottom: number; top: number } {
  const b = partBox(part);
  return {
    poly: b.corners.map((c) => {
      const [x, y] = rotate(c, rotation);
      return [x + position[0], y + position[1]] as Vec;
    }),
    bottom: b.bottom,
    top: b.top,
  };
}
