// First-person walking: click the view to look around with the mouse (Esc
// releases it) or drag to look; W A S D / arrow keys to move, Shift to hurry.
// You can't walk through walls or tall furniture; door openings are open.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { defaultStart, obstacles, walkStep } from "../model/walk";
import type { Vec } from "../model/geometry";
import { M } from "../model/units";
import { useOdaja } from "../store";

const WALK_SPEED = 140; // cm/s
const RUN_SPEED = 300;
const LOOK_SPEED = 0.0025; // radians per pixel
const KEY_TURN = 1.8; // radians per second with Q / E
const MAX_PITCH = 1.35;

export function WalkControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const shell = useOdaja((s) => s.shell);
  const scene = useOdaja((s) => s.scene);
  const walkStart = useOdaja((s) => s.walkStart);
  const eyeHeight = useOdaja((s) => s.eyeHeight);
  const setWalkPose = useOdaja((s) => s.setWalkPose);

  const segments = useMemo(() => (shell ? obstacles(shell, scene) : []), [shell, scene]);
  const pos = useRef<Vec>([0, 0]);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const keys = useRef(new Set<string>());
  const lastPublish = useRef(0);

  // Place the walker at the start (picked on the plan, or the entrance).
  useEffect(() => {
    if (!shell) return;
    const start = walkStart ?? defaultStart(shell);
    if (!start) return;
    pos.current = start.position;
    const [dx, dy] = start.heading;
    yaw.current = Math.atan2(-dx, -dy);
    pitch.current = 0;
    // Wider view feels more natural indoors.
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 70;
      camera.near = 0.05;
      camera.updateProjectionMatrix();
    }
    return () => {
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = 45;
        camera.updateProjectionMatrix();
      }
    };
    // Only when walking starts or a new start is picked.
  }, [walkStart, camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    let dragging = false;
    const look = (dx: number, dy: number) => {
      yaw.current -= dx * LOOK_SPEED;
      pitch.current = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch.current - dy * LOOK_SPEED));
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas || dragging) look(e.movementX, e.movementY);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      // Ask for pointer lock; if the browser refuses, dragging still works.
      canvas.requestPointerLock?.()?.catch?.(() => {});
    };
    const onMouseUp = () => (dragging = false);
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey) return;
      keys.current.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      keys.current.clear();
    };
  }, [gl]);

  useFrame((_, dt) => {
    const k = keys.current;
    const delta = Math.min(dt, 0.1);
    if (k.has("KeyQ")) yaw.current += KEY_TURN * delta;
    if (k.has("KeyE")) yaw.current -= KEY_TURN * delta;
    const forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const strafe = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    if (forward || strafe) {
      const speed = (k.has("ShiftLeft") || k.has("ShiftRight") ? RUN_SPEED : WALK_SPEED) * delta;
      const norm = Math.hypot(forward, strafe);
      // Plan directions for the current yaw (plan y = world z).
      const f: Vec = [-Math.sin(yaw.current), -Math.cos(yaw.current)];
      const r: Vec = [Math.cos(yaw.current), -Math.sin(yaw.current)];
      const move: Vec = [((f[0] * forward + r[0] * strafe) / norm) * speed, ((f[1] * forward + r[1] * strafe) / norm) * speed];
      pos.current = walkStep(pos.current, move, segments);
    }
    camera.position.set(M(pos.current[0]), M(eyeHeight), M(pos.current[1]));
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");

    // Tell the mini-map where we are, a few times a second.
    const now = performance.now();
    if (now - lastPublish.current > 80) {
      lastPublish.current = now;
      const pose = useOdaja.getState().walkPose;
      const next = { x: pos.current[0], y: pos.current[1], yaw: yaw.current };
      if (!pose || Math.abs(pose.x - next.x) > 0.5 || Math.abs(pose.y - next.y) > 0.5 || Math.abs(pose.yaw - next.yaw) > 0.01) setWalkPose(next);
    }
  });

  return null;
}
