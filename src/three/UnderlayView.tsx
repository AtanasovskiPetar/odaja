// The floor plan image under the Plan view: flat on the floor, just above
// the room floors and below walls and furniture, at its real scale.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { M } from "../model/units";
import { platform } from "../platform";
import { useOdaja } from "../store";

export function UnderlayView() {
  const underlay = useOdaja((s) => s.project?.underlay);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const image = underlay?.image;
  const texture = useMemo(() => {
    if (!image) return null;
    const t = new THREE.TextureLoader().load(platform.fileUrl(image));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [image]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!underlay || !texture || !plan || !underlay.visible) return null;
  const w = underlay.width * underlay.scale;
  const h = underlay.height * underlay.scale;
  return (
    <mesh
      position={[M(underlay.center[0]), 0.004, M(underlay.center[1])]}
      rotation={[-Math.PI / 2, 0, (-underlay.rotation * Math.PI) / 180]}
      renderOrder={1}
      raycast={() => null}
    >
      <planeGeometry args={[M(w), M(h)]} />
      <meshBasicMaterial map={texture} transparent opacity={underlay.opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
