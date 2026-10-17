// Preview images for library items: render an object from the front-right,
// slightly above, on a transparent background.
import * as THREE from "three";
import type { Material, Part } from "../model/schema";
import { partGeometry, partTransform } from "./partGeometry";

const SIZE = 256;
let renderer: THREE.WebGLRenderer | null = null;

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(1);
  }
  return renderer;
}

// A plain three.js version of an object built from parts.
export function partsObject(parts: Part[], materials: Record<string, Material> = {}): THREE.Group {
  const group = new THREE.Group();
  for (const part of parts) {
    const m = (part.material && materials[part.material]) || { color: "#c8c8c8", roughness: 0.8, metalness: 0, opacity: 1 };
    const material = new THREE.MeshStandardMaterial({
      color: part.color ?? m.color,
      roughness: m.roughness,
      metalness: m.metalness,
      transparent: m.opacity < 1,
      opacity: m.opacity,
    });
    const mesh = new THREE.Mesh(partGeometry(part), material);
    const { position, rotationY } = partTransform(part);
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    group.add(mesh);
  }
  return group;
}

export async function renderThumbnail(object: THREE.Object3D): Promise<Blob> {
  const r = getRenderer();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#b8b0a4", 2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.6);
  sun.position.set(2, 4, -3);
  scene.add(sun);
  scene.add(object);
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  const camera = new THREE.PerspectiveCamera(30, 1, radius / 100, radius * 100);
  // Objects face -Z (north), so look at their front from the front-right.
  const dir = new THREE.Vector3(0.75, 0.6, -1).normalize();
  camera.position.copy(center).addScaledVector(dir, radius / Math.sin((15 * Math.PI) / 180));
  camera.lookAt(center);

  r.setClearColor(0x000000, 0);
  r.render(scene, camera);
  scene.remove(object);
  return new Promise((resolve, reject) => r.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("thumbnail failed"))), "image/png"));
}
