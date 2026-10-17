// The shape editor in 3D: the object being edited, part by part. Click a part
// to select it (Shift adds to the selection); drag the handles to move,
// rotate (around the vertical) or resize it. Moving snaps to other parts'
// faces and to 1 cm; rotating snaps to 15°.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { replacePart, snapPart } from "../model/partOps";
import { expandRepeats, PartSchema, type Part, type PartInput } from "../model/schema";
import { planToWorld, rotationToWorld } from "../model/units";
import { useOdaja } from "../store";
import { sceneTheme } from "./theme";
import { gizmo, PartMesh } from "./ObjectsView";
import { partGeometry, partTransform } from "./partGeometry";

const r1 = (n: number) => Math.round(n * 10) / 10;
// Drawn on top of everything so the selection is visible through other parts.
const ACCENT = new THREE.LineBasicMaterial({ color: sceneTheme().accent, depthTest: false, transparent: true });

function Outline({ part }: { part: Part }) {
  const geometry = useMemo(() => new THREE.EdgesGeometry(partGeometry(part), 30), [part]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { position, rotationY } = partTransform(part);
  return <lineSegments geometry={geometry} material={ACCENT} position={position} rotation={[0, rotationY, 0]} raycast={() => null} renderOrder={10} />;
}

// A part resized by the handle's scale (x across, y up, z depth), per shape.
function resized(part: PartInput, sx: number, sy: number, sz: number): PartInput {
  switch (part.shape) {
    case "box":
    case "wedge":
      return { ...part, size: [r1(part.size[0] * sx), r1(part.size[1] * sz), r1(part.size[2] * sy)] };
    case "cylinder": {
      const axis = part.axis ?? "z";
      const across = axis === "x" ? Math.max(sy, sz) : axis === "y" ? Math.max(sx, sy) : Math.max(sx, sz);
      const along = axis === "x" ? sx : axis === "y" ? sz : sy;
      return { ...part, radius: r1(part.radius * across), height: r1(part.height * along) };
    }
    case "sphere":
      return { ...part, radius: r1(part.radius * Math.max(sx, sy, sz)) };
    case "extrusion": {
      const axis = part.axis ?? "z";
      const [ka, kb, kd] = axis === "z" ? [sx, sz, sy] : axis === "y" ? [sx, sy, sz] : [sz, sy, sx];
      return { ...part, profile: part.profile.map(([a, b]) => [r1(a * ka), r1(b * kb)] as [number, number]), depth: r1(part.depth * kd) };
    }
  }
}

export function ShapeEditorView() {
  const editingId = useOdaja((s) => s.editingObjectId);
  const doc = useOdaja((s) => s.sceneDoc?.objects?.find((o) => o.id === s.editingObjectId));
  const object = useOdaja((s) => s.scene?.objects.find((o) => o.id === s.editingObjectId));
  const selection = useOdaja((s) => s.partSelection);
  const tool = useOdaja((s) => s.partTool);
  const selectParts = useOdaja((s) => s.selectParts);
  const apply = useOdaja((s) => s.apply);
  const [preview, setPreview] = useState<{ index: number; part: PartInput } | null>(null);
  const [helper, setHelper] = useState<THREE.Group | null>(null);
  const base = useRef<PartInput | null>(null);

  const raw = doc?.parts ?? [];
  const parts = raw.map((p, i) => (preview?.index === i ? preview.part : p));
  // Parsed (with defaults), each with its copies if repeated.
  const parsed = parts.map((p) => {
    const r = PartSchema.safeParse(p);
    return r.success ? r.data : null;
  });
  const single = selection.length === 1 && parsed[selection[0]] ? selection[0] : null;

  // Keep the handle on the selected part (when not dragging).
  useEffect(() => {
    if (!helper || single === null || preview) return;
    const p = parsed[single]!;
    const { position, rotationY } = partTransform(p);
    helper.position.set(...position);
    helper.rotation.set(0, rotationY, 0);
    helper.scale.set(1, 1, 1);
  });

  if (!editingId || !doc || !object) return null;

  const pick = (index: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.shiftKey) selectParts(selection.includes(index) ? selection.filter((i) => i !== index) : [...selection, index]);
    else selectParts([index]);
  };

  const onChange = () => {
    if (!helper || single === null) return;
    const start = base.current ?? raw[single];
    base.current = start;
    if (tool === "move") {
      const at: [number, number, number] = [r1(helper.position.x * 100), r1(helper.position.z * 100), r1(helper.position.y * 100)];
      const snapped = snapPart(raw, single, at);
      helper.position.set(snapped[0] / 100, snapped[2] / 100, snapped[1] / 100);
      setPreview({ index: single, part: { ...start, at: snapped } });
    } else if (tool === "rotate") {
      const deg = Math.round(((-helper.rotation.y * 180) / Math.PI) * 10) / 10;
      setPreview({ index: single, part: { ...start, rotation: ((deg % 360) + 360) % 360 || undefined } });
    } else {
      const s = helper.scale;
      setPreview({ index: single, part: resized(start, Math.max(0.05, s.x), Math.max(0.05, s.y), Math.max(0.05, s.z)) });
    }
  };

  const onEnd = () => {
    gizmo.lastUsed = performance.now();
    base.current = null;
    if (preview && single !== null) apply(replacePart(editingId, single, preview.part));
    setPreview(null);
    helper?.scale.set(1, 1, 1);
  };

  return (
    <>
      <group position={planToWorld(object.position[0], object.position[1], object.elevation)} rotation={[0, rotationToWorld(object.rotation), 0]}>
        {parsed.map((p, i) =>
          p
            ? expandRepeats([p]).map((copy, k) => (
                <PartMesh key={`${i}-${k}`} part={copy} ghost={false} onClick={pick(i)} userData={{ part: i }} />
              ))
            : null,
        )}
        {selection.map((i) => (parsed[i] ? expandRepeats([parsed[i]!]).map((copy, k) => <Outline key={`o${i}-${k}`} part={copy} />) : null))}
        <group ref={setHelper} />
      </group>
      {/* The handles live at the scene root: they place themselves in world
          space, so inside the object's group its transform would apply twice. */}
      {helper && single !== null && (
        <TransformControls
          object={helper}
          mode={tool === "move" ? "translate" : tool === "rotate" ? "rotate" : "scale"}
          showX={tool !== "rotate"}
          showZ={tool !== "rotate"}
          translationSnap={0.01}
          rotationSnap={Math.PI / 12}
          space="local"
          size={0.7}
          onMouseDown={() => (gizmo.lastUsed = performance.now())}
          onObjectChange={onChange}
          onMouseUp={onEnd}
        />
      )}
    </>
  );
}
