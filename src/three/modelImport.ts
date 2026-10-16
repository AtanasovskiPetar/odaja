// Importing 3D models: load any common format (with its side files, like
// .bin, .mtl and textures), let the user fix units, up axis and facing,
// optionally simplify heavy models, and convert to GLB, the one format the
// app renders.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import { VRMLLoader } from "three/examples/jsm/loaders/VRMLLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MeshoptSimplifier } from "three/examples/jsm/libs/meshopt_simplifier.module.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Unit = "m" | "cm" | "mm" | "in";
export type UpAxis = "y" | "z";

export const UNIT_TO_M: Record<Unit, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };

// Main model formats, in order of preference when several are dropped together.
export const MODEL_EXTENSIONS = ["glb", "gltf", "fbx", "obj", "dae", "3ds", "usdz", "usd", "usda", "usdc", "3mf", "stl", "ply", "wrl"];
// Side files that come with a model (geometry buffers, materials, textures).
export const SIDE_EXTENSIONS = ["bin", "mtl", "png", "jpg", "jpeg", "webp", "tga", "bmp", "gif", "ktx2"];
export const ACCEPT = [...MODEL_EXTENSIONS, ...SIDE_EXTENSIONS].map((e) => `.${e}`).join(",");

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const base = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split(/[\\/]/).pop() ?? "").toLowerCase();

export interface LoadedModel {
  object: THREE.Object3D;
  name: string; // file name without extension
  format: string;
  triangles: number;
  // Best guesses for the import settings.
  unit: Unit;
  up: UpAxis;
}

export function countTriangles(object: THREE.Object3D): number {
  let n = 0;
  object.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!(o as THREE.Mesh).isMesh || !g) return;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}

// Pick a unit that makes the model a plausible piece of furniture
// (largest side between 10 cm and 8 m).
function guessUnit(object: THREE.Object3D, fallback: Unit): Unit {
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!(largest > 0)) return fallback;
  const fits = (u: Unit) => largest * UNIT_TO_M[u] >= 0.1 && largest * UNIT_TO_M[u] <= 8;
  if (fits(fallback)) return fallback;
  return (["m", "cm", "mm", "in"] as Unit[]).find(fits) ?? fallback;
}

function asMesh(geometry: THREE.BufferGeometry) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: "#d9d6d0", roughness: 0.7, vertexColors: !!geometry.attributes.color });
  return new THREE.Mesh(geometry, material);
}

// Load a model from dropped/picked files. Side files are found by name, so
// relative references inside the model (textures, .bin, .mtl) resolve.
export async function loadModelFiles(files: File[]): Promise<LoadedModel> {
  const main = MODEL_EXTENSIONS.map((e) => files.find((f) => ext(f.name) === e)).find(Boolean);
  if (!main) {
    if (files.some((f) => ext(f.name) === "skp")) {
      throw new Error("SketchUp files (.skp) can't be read outside SketchUp. In SketchUp, export as COLLADA (.dae) or glTF (.glb), or download the Collada version from 3D Warehouse.");
    }
    throw new Error(`No model file found. Supported: ${MODEL_EXTENSIONS.map((e) => "." + e).join(", ")}.`);
  }

  const urls = new Map(files.map((f) => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => urls.get(base(url)) ?? url);
  const mainUrl = urls.get(main.name.toLowerCase())!;
  const format = ext(main.name);
  const name = main.name.replace(/\.[^.]+$/, "");

  try {
    let object: THREE.Object3D;
    let unit: Unit = "m";
    let up: UpAxis = "y";
    switch (format) {
      case "glb":
      case "gltf": {
        const loader = new GLTFLoader(manager);
        loader.setDRACOLoader(new DRACOLoader(manager).setDecoderPath("/draco/"));
        loader.setMeshoptDecoder(MeshoptDecoder);
        object = (await loader.loadAsync(mainUrl)).scene;
        break;
      }
      case "fbx":
        object = await new FBXLoader(manager).loadAsync(mainUrl);
        unit = "cm";
        break;
      case "obj": {
        const loader = new OBJLoader(manager);
        const mtl = files.find((f) => ext(f.name) === "mtl");
        if (mtl) {
          const materials = new MTLLoader(manager).parse(await mtl.text(), "");
          materials.preload();
          loader.setMaterials(materials);
        }
        object = await loader.loadAsync(mainUrl);
        unit = "cm";
        break;
      }
      case "dae":
        // The Collada loader applies the file's units and up axis itself.
        object = (await new ColladaLoader(manager).loadAsync(mainUrl))!.scene;
        break;
      case "3ds":
        object = await new TDSLoader(manager).loadAsync(mainUrl);
        unit = "mm";
        up = "z";
        break;
      case "usdz":
      case "usd":
      case "usda":
      case "usdc":
        object = await new USDLoader(manager).loadAsync(mainUrl);
        break;
      case "3mf":
        object = await new ThreeMFLoader(manager).loadAsync(mainUrl);
        unit = "mm";
        up = "z";
        break;
      case "stl":
        object = asMesh(await new STLLoader(manager).loadAsync(mainUrl));
        unit = "mm";
        up = "z";
        break;
      case "ply":
        object = asMesh(await new PLYLoader(manager).loadAsync(mainUrl));
        up = "z";
        break;
      case "wrl":
        object = await new VRMLLoader(manager).loadAsync(mainUrl);
        break;
      default:
        throw new Error(`Unsupported format .${format}`);
    }
    object.updateMatrixWorld(true);
    return { object, name, format, triangles: countTriangles(object), unit: guessUnit(object, unit), up };
  } finally {
    // Textures are decoded by now; the blob URLs can go once loading settles.
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 10000);
  }
}

export interface ImportSettings {
  unit: Unit;
  up: UpAxis;
  // Extra turn (degrees, clockwise from above) so the model's front faces
  // north, which is how Odaja objects face at rotation 0.
  turn: 0 | 90 | 180 | 270;
}

// The model in Odaja's frame: metres, Y up, front towards -Z (north on the
// plan), footprint centred on the origin, standing on Y = 0. Returns the
// group and its size in cm [width, depth, height].
export function normalize(source: THREE.Object3D, s: ImportSettings): { group: THREE.Group; size: [number, number, number] } {
  const inner = source.clone(true);
  const oriented = new THREE.Group();
  oriented.add(inner);
  if (s.up === "z") oriented.rotation.x = -Math.PI / 2;
  const turned = new THREE.Group();
  turned.add(oriented);
  turned.rotation.y = (-s.turn * Math.PI) / 180;
  turned.scale.setScalar(UNIT_TO_M[s.unit]);
  turned.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(turned);
  const center = box.getCenter(new THREE.Vector3());
  turned.position.set(-center.x, -box.min.y, -center.z);
  const group = new THREE.Group();
  group.add(turned);
  group.updateMatrixWorld(true);
  const size = box.getSize(new THREE.Vector3());
  const cm = (m: number) => Math.round(m * 1000) / 10;
  return { group, size: [cm(size.x), cm(size.z), cm(size.y)] };
}

// Reduce a model to about `target` triangles, keeping its outline.
export async function simplify(object: THREE.Object3D, target: number) {
  await MeshoptSimplifier.ready;
  const total = countTriangles(object);
  if (total <= target) return;
  const ratio = target / total;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry = mesh.geometry as THREE.BufferGeometry;
    // Only simplify with positions, normals and UVs; merge duplicates first so
    // neighbouring triangles share vertices.
    for (const key of Object.keys(geometry.attributes)) {
      if (!["position", "normal", "uv"].includes(key)) geometry.deleteAttribute(key);
    }
    geometry = mergeVertices(geometry);
    const index = geometry.index;
    if (!index) return;
    const positions = new Float32Array(geometry.attributes.position.array);
    const targetCount = Math.max(3, Math.floor((index.count * ratio) / 3) * 3);
    const [simplified] = MeshoptSimplifier.simplify(new Uint32Array(index.array), positions, 3, targetCount, 0.02, ["LockBorder"]);
    geometry.setIndex(new THREE.BufferAttribute(simplified, 1));
    mesh.geometry = geometry;
  });
}

export async function toGLB(object: THREE.Object3D): Promise<ArrayBuffer> {
  const result = await new GLTFExporter().parseAsync(object, { binary: true, onlyVisible: true });
  return result as ArrayBuffer;
}

// Loader for models stored in projects (always GLB, possibly compressed if
// an agent or another tool wrote them).
export function configureGLTF(loader: GLTFLoader) {
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath("/draco/"));
  loader.setMeshoptDecoder(MeshoptDecoder);
}
