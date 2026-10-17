// Three.js geometry for every part shape, used by the scene, the shape editor
// and library thumbnails. Each geometry is built in metres around the part's
// `at` point (its footprint centre, at its bottom), so a mesh is placed at
// `at` and turned by the part's rotation.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Hole, Part } from "../model/schema";
import { M } from "../model/units";

type Axis = "z" | "x" | "y";

// Profile (a, b) to the 2D shape plane, matching how extrude() lays it out.
const toShape = (a: number, b: number, axis: Axis): [number, number] => (axis === "z" ? [a, -b] : axis === "x" ? [-a, b] : [a, b]);

// Cut-outs as shape holes, in profile-plane cm.
function holePaths(holes: Hole[] | undefined, axis: Axis): THREE.Path[] {
  return (holes ?? []).map((h) => {
    const path = new THREE.Path();
    const [x, y] = toShape(h.at[0], h.at[1], axis);
    if ("radius" in h) {
      path.absarc(x, y, h.radius, 0, Math.PI * 2, true);
    } else {
      const [w, d] = h.size;
      path.moveTo(x - w / 2, y - d / 2);
      path.lineTo(x - w / 2, y + d / 2);
      path.lineTo(x + w / 2, y + d / 2);
      path.lineTo(x + w / 2, y - d / 2);
      path.closePath();
    }
    return path;
  });
}

// Extrude a 2D outline (cm) and lay it out according to the axis.
function extrude(profile: [number, number][], depth: number, axis: Axis, holes?: Hole[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([a, b]) => new THREE.Vector2(...toShape(a, b, axis))));
  shape.holes.push(...holePaths(holes, axis));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  if (axis === "z") {
    // Outline on the plan, raised by `depth`: (x, -y) shape turned flat.
    g.rotateX(-Math.PI / 2);
  } else if (axis === "y") {
    // Front view outline (x, up), pushed back along plan y, centred.
    g.translate(0, 0, -depth / 2);
  } else {
    // Side view outline (y, up), pushed along plan x, centred.
    g.rotateY(Math.PI / 2);
    g.translate(-depth / 2, 0, 0);
  }
  g.scale(0.01, 0.01, 0.01);
  return g;
}

export function partGeometry(part: Part): THREE.BufferGeometry {
  switch (part.shape) {
    case "box": {
      const [w, d, h] = part.size;
      if (part.holes?.length) {
        return extrude(
          [
            [-w / 2, -d / 2],
            [w / 2, -d / 2],
            [w / 2, d / 2],
            [-w / 2, d / 2],
          ],
          h,
          "z",
          part.holes,
        );
      }
      // RoundedBox needs a radius smaller than half the thinnest side.
      const radius = Math.min(part.radius, Math.min(w, d, h) / 2 - 0.01);
      const g = radius > 0.05 ? new RoundedBoxGeometry(M(w), M(h), M(d), 3, M(radius)) : new THREE.BoxGeometry(M(w), M(h), M(d));
      g.translate(0, M(h / 2), 0);
      return g;
    }
    case "cylinder": {
      const g = new THREE.CylinderGeometry(M(part.radius), M(part.radius), M(part.height), 32);
      if (part.axis === "x") {
        g.rotateZ(Math.PI / 2);
        g.translate(0, M(part.radius), 0);
      } else if (part.axis === "y") {
        g.rotateX(Math.PI / 2);
        g.translate(0, M(part.radius), 0);
      } else {
        g.translate(0, M(part.height / 2), 0);
      }
      return g;
    }
    case "sphere": {
      const g = new THREE.SphereGeometry(M(part.radius), 32, 16);
      g.translate(0, M(part.radius), 0);
      return g;
    }
    case "wedge": {
      const [w, d, h] = part.size;
      // Side view: low at the front (-y), full height at the back (+y).
      return extrude(
        [
          [-d / 2, 0],
          [d / 2, 0],
          [d / 2, h],
        ],
        w,
        "x",
      );
    }
    case "extrusion":
      return extrude(part.profile, part.depth, part.axis, part.holes);
  }
}

// Where a part's mesh goes inside its object (metres), and its turn.
export function partTransform(part: Part): { position: [number, number, number]; rotationY: number } {
  return { position: [M(part.at[0]), M(part.at[2]), M(part.at[1])], rotationY: (-part.rotation * Math.PI) / 180 };
}
