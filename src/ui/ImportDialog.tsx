// Import a 3D model: preview it, fix units / up axis / which side is the
// front, set its real size, then save it to the library and/or place it.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Bounds, Grid, OrbitControls } from "@react-three/drei";
import { loadModelFiles, normalize, type ImportSettings, type LoadedModel, type Unit } from "../three/modelImport";
import { useOdaja } from "../store";
import { CATEGORIES, finishImport } from "./libraryActions";

const HEAVY = 150_000; // triangles
const SIMPLIFY_TO = 100_000;

function Preview({ loaded, settings }: { loaded: LoadedModel; settings: ImportSettings }) {
  const { group, size } = useMemo(() => normalize(loaded.object, settings), [loaded, settings]);
  // Arrow on the floor pointing to the front: Odaja objects face -Z (north on the plan).
  const arrow = useMemo(() => {
    const length = Math.max(0.4, (size[1] / 100) * 0.5 + 0.3);
    return new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.01, 0), length, "#c2541b", 0.15, 0.1);
  }, [size]);
  return (
    <Canvas camera={{ position: [1.6, 1.4, -2.2], fov: 35 }} className="import-preview">
      <color attach="background" args={["#f4f2ee"]} />
      <hemisphereLight args={["#ffffff", "#b8b0a4", 2]} />
      <directionalLight position={[2, 4, -3]} intensity={1.5} />
      <Bounds fit clip observe margin={1.8}>
        <primitive object={group} />
      </Bounds>
      <Grid args={[10, 10]} cellSize={0.1} sectionSize={1} cellColor="#d6d2cb" sectionColor="#bdb7ad" infiniteGrid fadeDistance={12} />
      <primitive object={arrow} />
      <OrbitControls makeDefault />
    </Canvas>
  );
}

export function ImportDialog({ files }: { files: File[] }) {
  const close = () => useOdaja.getState().openDialog(null);
  const hasScene = useOdaja((s) => s.scene !== null);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<ImportSettings>({ unit: "m", up: "y", turn: 180 });
  const [size, setSize] = useState<[number, number, number] | null>(null);
  const [lock, setLock] = useState(true);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [simplifyOn, setSimplifyOn] = useState(true);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [placeInScene, setPlaceInScene] = useState(hasScene);

  useEffect(() => {
    loadModelFiles(files)
      .then((m) => {
        setLoaded(m);
        setName(m.name.replace(/[_-]+/g, " ").trim());
        setSettings({ unit: m.unit, up: m.up, turn: 180 });
      })
      .catch((err) => setError((err as Error).message));
  }, [files]);

  // The model's size with the current settings; typed sizes start from it.
  const natural = useMemo(() => (loaded ? normalize(loaded.object, settings).size : null), [loaded, settings]);
  useEffect(() => setSize(natural), [natural]);

  const setDim = (i: 0 | 1 | 2, value: number) => {
    if (!size || !natural || !(value > 0)) return;
    if (lock) {
      const k = value / size[i];
      setSize(size.map((v) => Math.round(v * k * 10) / 10) as [number, number, number]);
    } else {
      const next = [...size] as [number, number, number];
      next[i] = value;
      setSize(next);
    }
  };

  const submit = async () => {
    if (!loaded || !size) return;
    setBusy(true);
    setError(null);
    try {
      await finishImport(loaded, {
        name: name.trim() || loaded.name,
        category,
        settings,
        size,
        simplifyTo: loaded.triangles > HEAVY && simplifyOn ? SIMPLIFY_TO : undefined,
        saveToLibrary,
        placeInScene,
      });
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="dialog import-dialog">
        <h2>Import model</h2>
        {!loaded && !error && <p className="muted">Loading {files.map((f) => f.name).join(", ")}…</p>}
        {error && <div className="inline-error">{error}</div>}
        {loaded && settings && size && (
          <div className="import-body">
            <div>
              <Preview loaded={loaded} settings={settings} />
              <p className="hint">
                The orange arrow is the front. Turn the model until its front points the same way.
              </p>
            </div>
            <div className="import-fields">
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span>Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>File units</span>
                  <select value={settings.unit} onChange={(e) => setSettings({ ...settings, unit: e.target.value as Unit })}>
                    <option value="m">metres</option>
                    <option value="cm">centimetres</option>
                    <option value="mm">millimetres</option>
                    <option value="in">inches</option>
                  </select>
                </label>
                <label className="field">
                  <span>Up axis</span>
                  <select value={settings.up} onChange={(e) => setSettings({ ...settings, up: e.target.value as "y" | "z" })}>
                    <option value="y">Y up</option>
                    <option value="z">Z up (CAD)</option>
                  </select>
                </label>
              </div>
              <div className="actions">
                <button onClick={() => setSettings({ ...settings, turn: ((settings.turn + 90) % 360) as ImportSettings["turn"] })}>Turn 90°</button>
              </div>
              <div className="group-title">Real size</div>
              <div className="grid-3">
                {(["Width", "Depth", "Height"] as const).map((label, i) => (
                  <label className="field" key={label}>
                    <span>{label}</span>
                    <span className="input-wrap">
                      <input
                        key={size[i]}
                        defaultValue={size[i]}
                        inputMode="decimal"
                        onBlur={(e) => setDim(i as 0 | 1 | 2, Number(e.target.value.replace(",", ".")))}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                      <span className="suffix">cm</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
                Keep proportions
              </label>
              <p className="hint">Check these against the product's real dimensions; the file's units are a guess.</p>
              {loaded.triangles > HEAVY && (
                <label className="check">
                  <input type="checkbox" checked={simplifyOn} onChange={(e) => setSimplifyOn(e.target.checked)} />
                  Simplify ({Math.round(loaded.triangles / 1000)}k triangles → {SIMPLIFY_TO / 1000}k)
                </label>
              )}
              <label className="check">
                <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
                Save to my library
              </label>
              <label className="check">
                <input type="checkbox" checked={placeInScene} disabled={!hasScene} onChange={(e) => setPlaceInScene(e.target.checked)} />
                Place in this scene
              </label>
            </div>
          </div>
        )}
        <div className="dialog-buttons">
          <button onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={!loaded || busy || (!saveToLibrary && !placeInScene)}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
