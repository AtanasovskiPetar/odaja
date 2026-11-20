// Editing a lamp, from the inspector or the 3D handle bar: one of the
// object's lights (a fixture can have several, see `selectedLightIndex`),
// written back the way the file keeps it (`light`, or `lights` for several).
import { setObjectProps } from "../model/operations";
import { objectLights, type LightInput, type SceneObject } from "../model/schema";
import { useOdaja } from "../store";

// The usual bulb colours, warm to neutral.
export const LAMP_COLOURS: { kelvin: number; name: string }[] = [
  { kelvin: 2200, name: "Candle warm" },
  { kelvin: 2700, name: "Warm white" },
  { kelvin: 3000, name: "Soft white" },
  { kelvin: 4000, name: "Neutral white" },
];

export function useLightEdit(object: SceneObject) {
  const apply = useOdaja((s) => s.apply);
  const writtenObj = useOdaja((s) => s.sceneDoc?.objects?.find((o) => o.id === object.id));
  const selectedLightIndex = useOdaja((s) => s.selectedLightIndex);
  const lights = objectLights(object);
  const idx = Math.min(selectedLightIndex, Math.max(0, lights.length - 1));

  // The lights as written, or (for a template's light nobody changed yet)
  // as resolved.
  const written = (): LightInput[] => {
    if (writtenObj?.lights?.length) return writtenObj.lights.map((l) => ({ ...l }));
    if (writtenObj?.light) return [{ ...writtenObj.light }];
    return lights.map((l) => ({
      type: l.type,
      at: [...l.at],
      lumens: l.lumens,
      kelvin: l.kelvin,
      ...(l.type === "spot" ? { angle: l.angle } : {}),
      ...(l.type === "area" ? { size: [...l.size] } : {}),
      ...(l.penumbra !== undefined ? { penumbra: l.penumbra } : {}),
      ...(!l.on ? { on: false } : {}),
    }));
  };

  const writeList = (next: LightInput[]) => {
    if (next.length === 0) apply(setObjectProps(object.id, { light: undefined, lights: undefined }));
    else if (next.length === 1) apply(setObjectProps(object.id, { light: next[0], lights: undefined }));
    else apply(setObjectProps(object.id, { light: undefined, lights: next }));
  };

  // Change the selected light.
  const set = (patch: LightInput) => {
    const list = written();
    list[idx] = { ...list[idx], ...patch };
    writeList(list);
  };

  return { lights, idx, light: lights[idx], written, writeList, set };
}
