// Shaders compile in the background instead of freezing the page. A home
// opened, or a light setup seen, for the first time needs new GPU programs,
// and three would compile them in the middle of a frame (a second or two).
// Here they're compiled ahead with compileAsync and a mesh is only drawn once
// its programs are ready: the house shell first (`userData.compileFirst`),
// then the rest. When something already on screen needs new programs (the
// lights changed), the last picture stays until they're ready. This
// component draws the frame (useFrame priority 1).
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { create } from "zustand";

const SHOW_AFTER = 150; // ms of waiting before the indicator shows

// `waiting` while meshes wait for their shaders, `preparing` once that has
// taken a moment (the indicator); `version` changes when they appear, for
// effects that cache what they drew (AO).
export const useShaders = create(() => ({ waiting: false, preparing: false, version: 0 }));

// For pictures: wait until everything is drawn (or give up and draw anyway).
export function whenShadersReady(timeout = 10_000): Promise<void> {
  if (!useShaders.getState().waiting) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, timeout);
    const stop = useShaders.subscribe((s) => !s.waiting && done());
  });
}

const materialsOf = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

// A material's version changes when it needs a new program, except that three
// bumps it itself every time it draws or compiles a see-through double-sided
// material (back faces, then front): for those it means nothing, and trusting
// it would hold them back for ever (the move arrows).
const versionOf = (m: THREE.Material) => (m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? -1 : m.version);

// Per material version: the light setups it was compiled for, and those it's ready for.
type Compiled = { version: number; asked: WeakSet<object>; ready: WeakSet<object> };

export function ShaderGate() {
  // Never drawn: three's program for it stands for the light setup (lights,
  // shadows, environment, output), so a new one means new programs.
  const probe = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    mesh.receiveShadow = true;
    return mesh;
  }, []);
  const compiled = useRef(new WeakMap<THREE.Material, Compiled>()).current;
  // Meshes held back, with their layers: off every layer, the render, shadow
  // and AO passes and pointer events skip them.
  const held = useRef(new WeakMap<THREE.Object3D, number>()).current;
  const shown = useRef(new WeakSet<THREE.Mesh>()).current;
  const waitingSince = useRef<number | null>(null);
  const lists = useRef({ first: [] as THREE.Mesh[], rest: [] as THREE.Mesh[] }).current;
  const batch = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => () => {
    probe.geometry.dispose();
    probe.material.dispose();
    useShaders.setState({ waiting: false, preparing: false });
  }, [probe]);

  useFrame(({ gl, scene, camera, invalidate }) => {
    gl.compile(probe, camera, scene);
    const setup = (gl.properties.get(probe.material) as { currentProgram: object }).currentProgram;
    const record = (m: THREE.Material) => {
      let r = compiled.get(m);
      const version = versionOf(m);
      if (r?.version !== version) compiled.set(m, (r = { version, asked: new WeakSet(), ready: new WeakSet() }));
      return r;
    };
    const ready = (mesh: THREE.Mesh) => materialsOf(mesh).every((m) => record(m).ready.has(setup));

    const { first, rest } = lists;
    first.length = rest.length = 0;
    const gather = (o: THREE.Object3D, inFirst: boolean) => {
      if (!o.visible) return;
      const f = inFirst || o.userData.compileFirst === true;
      if ((o as THREE.Mesh).isMesh) (f ? first : rest).push(o as THREE.Mesh);
      for (const child of o.children) gather(child, f);
    };
    gather(scene, false);

    // Compile what hasn't been asked for, as one batch outside the scene.
    const ask = (meshes: THREE.Mesh[]) => {
      const stale = meshes.filter((mesh) => materialsOf(mesh).some((m) => !record(m).asked.has(setup)));
      if (!stale.length) return;
      const records = stale.flatMap((mesh) => materialsOf(mesh).map(record));
      records.forEach((r) => r.asked.add(setup));
      batch.children = stale;
      const done = gl.compileAsync(batch, camera, scene);
      batch.children = [];
      done.then(() => {
        records.forEach((r) => r.ready.add(setup));
        invalidate();
      });
    };
    // The shell first; the rest once it's ready, or at once when what's on
    // screen changed (the picture waits for everything anyway).
    const changed = first.some((m) => shown.has(m) && !ready(m)) || rest.some((m) => shown.has(m) && !ready(m));
    ask(first);
    if (changed || first.every(ready)) ask(rest);

    let waiting = false;
    let keepPicture = false;
    let appeared = false;
    for (const meshes of [first, rest]) {
      for (const mesh of meshes) {
        const mask = held.get(mesh);
        if (ready(mesh)) {
          shown.add(mesh);
          if (mask === undefined) continue;
          mesh.layers.mask = mask;
          held.delete(mesh);
          appeared = true;
        } else {
          waiting = true;
          if (shown.has(mesh)) keepPicture = true;
          if (mask !== undefined) continue;
          held.set(mesh, mesh.layers.mask);
          mesh.layers.mask = 0;
        }
      }
    }

    const now = performance.now();
    if (waiting && waitingSince.current === null) setTimeout(invalidate, SHOW_AFTER); // to show the indicator
    waitingSince.current = waiting ? (waitingSince.current ?? now) : null;
    const preparing = waitingSince.current !== null && now - waitingSince.current >= SHOW_AFTER;
    const state = useShaders.getState();
    if (state.waiting !== waiting || state.preparing !== preparing || appeared) {
      useShaders.setState({ waiting, preparing, version: state.version + (appeared ? 1 : 0) });
    }
    if (appeared) {
      gl.shadowMap.needsUpdate = true;
      invalidate(); // once more, for AO with the new meshes
    }

    if (!keepPicture) gl.render(scene, camera);
  }, 1);

  return null;
}

export function PreparingIndicator() {
  const preparing = useShaders((s) => s.preparing);
  if (!preparing) return null;
  return (
    <div className="preparing" role="status">
      Preparing the 3D view…
    </div>
  );
}
