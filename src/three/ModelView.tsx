// Renders an object's 3D model (a GLB in the project), stretched to the
// object's size. While it loads, or if it can't be loaded, the object's
// bounding box is shown instead.
import { Component, Suspense, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { M } from "../model/units";
import { platform } from "../platform";
import { configureGLTF } from "./modelImport";

function Model({ src, size, material }: { src: string; size: [number, number, number]; material?: THREE.Material }) {
  const gltf = useLoader(GLTFLoader, platform.fileUrl(src), configureGLTF);
  const { object, offset, scale } = useMemo(() => {
    const object = gltf.scene.clone(true);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (material) mesh.material = material;
    });
    // Models imported by Odaja are already centred and standing on the floor;
    // others (written by agents or tools) are centred here.
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const native = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const offset: [number, number, number] = [-center.x, -box.min.y, -center.z];
    const s = (want: number, have: number) => (have > 1e-9 ? M(want) / have : 1);
    const scale: [number, number, number] = [s(size[0], native.x), s(size[2], native.y), s(size[1], native.z)];
    return { object, offset, scale };
  }, [gltf, material, size[0], size[1], size[2]]);
  return (
    <group scale={scale}>
      <primitive object={object} position={offset} />
    </group>
  );
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[odaja] model failed to load", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ModelView(props: { src: string; size: [number, number, number]; material?: THREE.Material; fallback: ReactNode }) {
  return (
    <ModelErrorBoundary key={props.src} fallback={props.fallback}>
      <Suspense fallback={props.fallback}>
        <Model src={props.src} size={props.size} material={props.material} />
      </Suspense>
    </ModelErrorBoundary>
  );
}
