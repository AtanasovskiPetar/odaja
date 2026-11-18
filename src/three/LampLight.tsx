import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { add, dist, pointInPolygon, polygonArea, rotate, scale, type Vec } from "../model/geometry";
import type { Light, Room, SceneObject, Shell } from "../model/schema";
import { M, planToWorld } from "../model/units";
import { useOdaja } from "../store";
import { useLamps } from "../ui/lampState";

const EXPOSURE = 0.04;
const TINT = 0.45;
const LIT_LAMPS = 8;
const DRAG_MARGIN = 1;
const REFLECTANCE = 0.35;

export function kelvinColor(kelvin: number): THREE.Color {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => 1 - TINT * (1 - Math.min(255, Math.max(0, v)) / 255);
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

function bulbAt(object: SceneObject, light: Light): Vec {
  return add(object.position, rotate([light.at[0], light.at[1]], object.rotation));
}

function roomAround(shell: Shell, p: Vec): Room | undefined {
  return shell.rooms.find((r) => pointInPolygon(p, r.polygon));
}

function reach(room: Room, p: Vec, height: number): number {
  const far = Math.max(...room.polygon.map((c) => dist(c, p)));
  return M(Math.hypot(far, height));
}

type Lamp = THREE.PointLight | THREE.SpotLight;
const lamps = new Set<Lamp>();
const roomFills = new Set<THREE.PointLight>();
let lampsChanged = false;

export function LampLight({ light, object }: { light: Light; object: SceneObject }) {
  const [lamp, setLamp] = useState<Lamp | null>(null);
  const [target] = useState(() => new THREE.Object3D());
  const color = useMemo(() => kelvinColor(light.kelvin), [light.kelvin]);
  const shell = useOdaja((s) => s.shell);
  const exposure = EXPOSURE * useLamps((s) => s.brightness);
  const distance = useMemo(() => {
    if (!shell) return 0;
    const p = bulbAt(object, light);
    const room = roomAround(shell, p);
    return room ? reach(room, p, shell.wallHeight) : 0;
  }, [shell, object, light]);
  const [x, y, z] = light.at;
  const position: [number, number, number] = [M(x), M(z), M(y)];

  useEffect(() => {
    if (!lamp) return;
    lamp.visible = false;
    lamp.castShadow = false;
    lamp.shadow.autoUpdate = false;
    const size = lamp instanceof THREE.SpotLight ? 1024 : 768;
    lamp.shadow.mapSize.set(size, size);
    lamp.shadow.bias = -0.002;
    lamp.shadow.normalBias = 0.02;
    lamp.shadow.camera.near = 0.05;
    lamp.shadow.camera.far = 15;
    lamps.add(lamp);
    lampsChanged = true;
    return () => {
      lamps.delete(lamp);
      lampsChanged = true;
    };
  }, [lamp]);

  const half = ((light.angle / 2) * Math.PI) / 180;
  const candela = light.type === "spot" ? light.lumens / (2 * Math.PI * (1 - Math.cos(half))) : light.lumens / (4 * Math.PI);
  const intensity = candela * exposure;
  useEffect(() => {
    if (!lamp) return;
    lamp.userData.intensity = intensity;
    lampsChanged = true;
  }, [lamp, intensity]);

  if (light.type === "spot") {
    return (
      <>
        <primitive object={target} position={[position[0], position[1] - 1, position[2]]} />
        <spotLight ref={setLamp} position={position} target={target} color={color} intensity={0} angle={half} penumbra={0.3} decay={2} distance={distance} />
      </>
    );
  }
  return <pointLight ref={setLamp} position={position} color={color} intensity={0} decay={2} distance={distance} />;
}

export function LampBudget() {
  const since = useRef(0);
  const meshes = useRef(0);
  const stale = useRef(true);
  const dragged = useRef<Vec[] | null>(null);
  const at = useMemo(() => new THREE.Vector3(), []);
  const scene = useOdaja((s) => s.scene);
  const shell = useOdaja((s) => s.shell);
  const drag = useOdaja((s) => s.dragPreview);
  const walking = useOdaja((s) => s.viewMode === "walk");
  useEffect(() => {
    stale.current = true;
  }, [scene, shell]);
  useEffect(() => {
    if (!drag) return;
    const from = useOdaja.getState().scene?.objects.find((o) => o.id === drag.id)?.position;
    dragged.current = from ? [from, drag.position] : [drag.position];
  }, [drag]);
  useFrame(({ camera, scene: world }, delta) => {
    since.current += delta;
    if (!lampsChanged && !stale.current && !dragged.current && since.current < 0.25) return;
    since.current = 0;
    let count = 0;
    world.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) count++;
    });
    if (count !== meshes.current) {
      meshes.current = count;
      stale.current = true;
    }
    const planOf = (v: THREE.Vector3): Vec => [v.x * 100, v.z * 100];
    const here = walking && shell ? roomAround(shell, planOf(camera.position)) : undefined;
    const placed = [...lamps].map((lamp) => {
      lamp.getWorldPosition(at);
      const room = shell ? roomAround(shell, planOf(at)) : undefined;
      return { lamp, room, here: here !== undefined && room === here, d: at.distanceToSquared(camera.position) };
    });
    const ordered = (spot: boolean) => placed.filter((p) => p.lamp instanceof THREE.SpotLight === spot).sort((a, b) => Number(b.here) - Number(a.here) || a.d - b.d);
    const points = ordered(false);
    const spots = ordered(true);
    const perRoom = new Map<Room, { points: number; spots: number }>();
    for (const p of placed) {
      if (!p.room) continue;
      const count = perRoom.get(p.room) ?? { points: 0, spots: 0 };
      if (p.lamp instanceof THREE.SpotLight) count.spots++;
      else count.points++;
      perRoom.set(p.room, count);
    }
    const rooms = [...perRoom.values()];
    const mostSpots = Math.max(0, ...rooms.map((c) => c.spots));
    const everyRoomFits = Math.max(0, ...rooms.map((c) => c.points)) + mostSpots <= LIT_LAMPS;
    const spotsNeeded = everyRoomFits ? mostSpots : (here && perRoom.get(here)?.spots) || 0;
    const pointSlots = Math.min(points.length, LIT_LAMPS - Math.min(spotsNeeded, LIT_LAMPS));
    const spotSlots = Math.min(spots.length, LIT_LAMPS - pointSlots);
    const moved = dragged.current;
    const nearMove = (lamp: Lamp) => {
      if (!moved) return false;
      if (lamp.distance === 0) return true;
      lamp.getWorldPosition(at);
      return moved.some(([x, y]) => Math.hypot(at.x - M(x), at.z - M(y)) < lamp.distance + DRAG_MARGIN);
    };
    const litRooms = new Set<string>();
    const assign = ({ lamp, room, here: inRoom }: (typeof placed)[number], slot: boolean) => {
      const shines = slot && (!here || inRoom);
      if (shines && room) litRooms.add(room.id);
      if (slot && lamp.shadow.map === null) lamp.shadow.needsUpdate = true;
      if (shines && (stale.current || !lamp.userData.shining || nearMove(lamp))) lamp.shadow.needsUpdate = true;
      lamp.visible = slot;
      lamp.castShadow = slot;
      lamp.intensity = shines ? (lamp.userData.intensity ?? 0) : 0;
      lamp.userData.shining = shines;
    };
    points.forEach((p, i) => assign(p, i < pointSlots));
    spots.forEach((p, i) => assign(p, i < spotSlots));
    for (const fill of roomFills) fill.intensity = litRooms.has(fill.userData.room) ? (fill.userData.intensity ?? 0) : 0;
    stale.current = false;
    dragged.current = null;
    lampsChanged = false;
  });
  return null;
}

export function RoomBounce() {
  const objects = useOdaja((s) => s.scene?.objects);
  const shell = useOdaja((s) => s.shell);
  const off = useOdaja((s) => s.mode === "structure" || s.editingObjectId !== null);
  const brightness = useLamps((s) => s.brightness);
  const fills = useMemo(() => {
    if (!objects || !shell || off) return [];
    const rooms = new Map<Room, { lumens: number; at: Vec; color: THREE.Color }>();
    for (const object of objects) {
      const light = object.light;
      if (!light?.on || light.lumens <= 0) continue;
      const p = bulbAt(object, light);
      const room = roomAround(shell, p);
      if (!room) continue;
      const sum = rooms.get(room) ?? { lumens: 0, at: [0, 0], color: new THREE.Color(0, 0, 0) };
      sum.lumens += light.lumens;
      sum.at = add(sum.at, scale(p, light.lumens));
      sum.color.add(kelvinColor(light.kelvin).multiplyScalar(light.lumens));
      rooms.set(room, sum);
    }
    const height = shell.wallHeight;
    return [...rooms].map(([room, sum]) => {
      const at = scale(sum.at, 1 / sum.lumens);
      const perimeter = room.polygon.reduce((total, c, i) => total + dist(c, room.polygon[(i + 1) % room.polygon.length]), 0);
      const surfaces = 2 * M(M(polygonArea(room.polygon))) + M(perimeter) * M(height);
      const lux = (sum.lumens * REFLECTANCE) / (surfaces * (1 - REFLECTANCE));
      return {
        id: room.id,
        position: planToWorld(at[0], at[1], height / 2),
        color: sum.color.multiplyScalar(1 / sum.lumens),
        intensity: lux * EXPOSURE,
        distance: reach(room, at, height / 2),
      };
    });
  }, [objects, shell, off]);
  return fills.map((f) => <RoomFill key={f.id} room={f.id} position={f.position} color={f.color} intensity={f.intensity * brightness} distance={f.distance} />);
}

function RoomFill({ room, position, color, intensity, distance }: { room: string; position: [number, number, number]; color: THREE.Color; intensity: number; distance: number }) {
  const [fill, setFill] = useState<THREE.PointLight | null>(null);
  useEffect(() => {
    if (!fill) return;
    roomFills.add(fill);
    lampsChanged = true;
    return () => {
      roomFills.delete(fill);
      lampsChanged = true;
    };
  }, [fill]);
  useEffect(() => {
    if (!fill) return;
    fill.userData.room = room;
    fill.userData.intensity = intensity;
    lampsChanged = true;
  }, [fill, room, intensity]);
  return <pointLight ref={setFill} position={position} color={color} intensity={0} decay={0} distance={distance} />;
}
