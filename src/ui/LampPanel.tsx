import { useOdaja } from "../store";
import { IconClose } from "./icons";
import { useLamps } from "./lampState";
import { useSun } from "./sunState";

export function LampBrightness() {
  const brightness = useLamps((s) => s.brightness);
  const setBrightness = useLamps((s) => s.setBrightness);
  return (
    <label className="field" title="Double-click the slider for 100%">
      <span>
        Lamp brightness <strong className="value">{Math.round(brightness * 100)}%</strong>
      </span>
      <input type="range" min={-2} max={2} step={0.1} value={Math.log2(brightness)} onChange={(e) => setBrightness(2 ** Number(e.target.value))} onDoubleClick={() => setBrightness(1)} />
    </label>
  );
}

export function LampPanel() {
  const on = useLamps((s) => s.on);
  const setOn = useLamps((s) => s.setOn);
  const sunOn = useSun((s) => s.on);
  const plan = useOdaja((s) => s.viewMode === "plan");
  if (!on || plan || sunOn) return null;
  return (
    <div className="underlay-panel sun-panel">
      <div className="underlay-head">
        <strong>Evening</strong>
        <button className="icon" onClick={() => setOn(false)} title="Turn the lamps off">
          <IconClose size={15} />
        </button>
      </div>
      <LampBrightness />
    </div>
  );
}
