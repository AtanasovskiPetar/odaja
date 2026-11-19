import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useOdaja } from "../../store";
import { useLamps } from "../../ui/lampState";
import { useSun } from "../../ui/sunState";
import { createAoPipeline, type AoPipeline } from "./ao";
import { applyAoToMaterial, createAoUniforms, updateAoUniforms } from "./aoMaterial";

function excluded(object: THREE.Object3D): boolean {
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
    if (parent.userData.noAo || /helper|gizmo|transformcontrols/i.test(parent.type) ||
        /^(grid|underlay|sunceiling)$/i.test(parent.name)) return true;
  }
  return false;
}

function matrixChanged(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  const ae = a.elements;
  const be = b.elements;
  for (let i = 0; i < 16; i++) {
    if (ae[i] !== be[i]) return true;
  }
  return false;
}

export function AoEffect({ enabled = true }: { enabled?: boolean }) {
  const { gl, scene, camera, size, viewport, invalidate } = useThree();
  const plan = useOdaja((s) => s.viewMode === "plan");
  const shell = useOdaja((s) => s.shell);
  const wholeShell = useOdaja((s) => s.wholeShell);
  const sceneDoc = useOdaja((s) => s.scene);
  const level = useOdaja((s) => s.level);
  const wallsCut = useOdaja((s) => s.wallsCut);
  const showRoofs = useOdaja((s) => s.showRoofs);
  const editingObjectId = useOdaja((s) => s.editingObjectId);
  const dragPreview = useOdaja((s) => s.dragPreview);
  const lampsOn = useLamps((s) => s.on);
  const sunOn = useSun((s) => s.on);
  const pipeline = useRef<AoPipeline | null>(null);
  const [uniforms] = useState(createAoUniforms);
  const [patched] = useState(() => new WeakSet<THREE.Material>());
  const [drawingSize] = useState(() => new THREE.Vector2());
  const [lastWorld] = useState(() => new THREE.Matrix4().set(NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  const [lastProj] = useState(() => new THREE.Matrix4().set(NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  const lastSize = useRef<[number, number]>([0, 0]);
  const sceneDirty = useRef(true);
  const materialsDirty = useRef(true);

  useEffect(() => {
    sceneDirty.current = true;
    materialsDirty.current = true;
  }, [shell, wholeShell, sceneDoc, level, wallsCut, showRoofs, editingObjectId, dragPreview, lampsOn, sunOn, plan, enabled]);

  useLayoutEffect(() => {
    gl.getDrawingBufferSize(drawingSize);
    const ao = createAoPipeline(gl, scene, camera, drawingSize.x, drawingSize.y, {
      strength: 1, radiusPx: 8, threshold: 0.015, autoRadius: true, rays: 4,
    });
    pipeline.current = ao;
    sceneDirty.current = true;
    materialsDirty.current = true;
    invalidate();
    return () => {
      updateAoUniforms(uniforms, null, 1, 1);
      pipeline.current = null;
      ao.dispose();
    };
  }, [gl, scene, camera, drawingSize, uniforms, invalidate]);

  useLayoutEffect(() => {
    gl.getDrawingBufferSize(drawingSize);
    pipeline.current?.resize(drawingSize.x, drawingSize.y);
    updateAoUniforms(uniforms, null, drawingSize.x, drawingSize.y);
    sceneDirty.current = true;
    invalidate();
  }, [gl, size.width, size.height, viewport.dpr, drawingSize, uniforms, invalidate]);

  // Clear synchronously on entering plan mode, also before screenshot rendering.
  useLayoutEffect(() => {
    pipeline.current?.setEnabled(enabled && !plan);
    if (plan || !enabled) updateAoUniforms(uniforms, null, drawingSize.x, drawingSize.y);
    sceneDirty.current = true;
    invalidate();
  }, [enabled, plan, uniforms, drawingSize, invalidate]);

  useFrame(() => {
    if (!enabled || plan) return;
    if (materialsDirty.current) {
      materialsDirty.current = false;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || excluded(object)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          // Grid, underlay, selection lines, shadow-only and guide/override
          // materials are not opaque standard/physical surface materials.
          if (patched.has(material) || !(material instanceof THREE.MeshStandardMaterial) ||
              material.transparent || !material.colorWrite || material.userData.noAo ||
              ("transmission" in material && Number(material.transmission) > 0)) continue;
          applyAoToMaterial(material, uniforms);
          patched.add(material);
        }
      });
    }
    gl.getDrawingBufferSize(drawingSize);
    const sizeChanged = drawingSize.x !== lastSize.current[0] || drawingSize.y !== lastSize.current[1];
    const camChanged = matrixChanged(camera.matrixWorld, lastWorld) || matrixChanged(camera.projectionMatrix, lastProj);
    if (!sceneDirty.current && !sizeChanged && !camChanged) return;
    sceneDirty.current = false;
    lastSize.current[0] = drawingSize.x;
    lastSize.current[1] = drawingSize.y;
    lastWorld.copy(camera.matrixWorld);
    lastProj.copy(camera.projectionMatrix);
    const ao = pipeline.current;
    // Also handles drawing-buffer changes made by screenshot capture.
    ao?.resize(drawingSize.x, drawingSize.y);
    const texture = ao?.render() ?? null;
    updateAoUniforms(uniforms, texture, drawingSize.x, drawingSize.y);
  }, 0);

  return null;
}
