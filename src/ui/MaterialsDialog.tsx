// The project's materials: colours, paints, and tiles (size, grout, pattern,
// colour variation) or photo textures. Used by walls, floors, finishes,
// furniture parts and joinery.
import { useMemo, useState } from "react";
import { slugify } from "../model/defaults";
import { MaterialSchema, TILE_PATTERNS, type MaterialDoc } from "../model/schema";
import { useOdaja } from "../store";
import { materialSwatch } from "../three/textures";
import { platform } from "../platform";

const PATTERN_LABELS: Record<(typeof TILE_PATTERNS)[number], string> = {
  grid: "Straight grid",
  brick: "Brick (½ offset)",
  third: "⅓ offset",
  vertical: "Vertical (standing)",
  herringbone: "Herringbone",
  diagonal: "Diagonal (square tiles)",
};

function Swatch({ material }: { material: MaterialDoc }) {
  const src = useMemo(() => {
    const parsed = MaterialSchema.safeParse(material);
    return parsed.success && !parsed.data.tile?.image ? materialSwatch(parsed.data) : null;
  }, [material]);
  if (material.tile?.image) return <img className="swatch" src={platform.fileUrl(material.tile.image)} alt="" />;
  return src ? <img className="swatch" src={src} alt="" /> : <span className="swatch" style={{ background: material.color }} />;
}

function Num({ label, value, onChange, step = 1, min = 0, max = 1000, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-wrap">
        <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))} />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function MaterialsDialog({ focus }: { focus?: string }) {
  const materials = useOdaja((s) => s.projectDoc?.materials) ?? {};
  const applyProject = useOdaja((s) => s.applyProject);
  const close = () => useOdaja.getState().openDialog(null);
  const names = Object.keys(materials).sort();
  const [selected, setSelected] = useState<string | null>(focus && materials[focus] ? focus : (names[0] ?? null));
  const [newName, setNewName] = useState("");
  const current = selected ? materials[selected] : undefined;

  const save = (name: string, m: MaterialDoc) => applyProject((doc) => ({ ...doc, materials: { ...(doc.materials ?? {}), [name]: m } }));
  const set = (patch: Partial<MaterialDoc>) => selected && current && save(selected, { ...current, ...patch });
  const setTile = (patch: Partial<NonNullable<MaterialDoc["tile"]>>) =>
    selected && current?.tile && save(selected, { ...current, tile: { ...current.tile, ...patch } });

  const create = () => {
    const name = slugify(newName).replace(/[^a-z0-9-]/g, "") || "material";
    let unique = name;
    for (let n = 2; materials[unique]; n++) unique = `${name}-${n}`;
    save(unique, { color: "#e9e6e1", roughness: 0.6 });
    setSelected(unique);
    setNewName("");
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog materials-dialog">
        <h2>Materials</h2>
        <div className="materials-body">
          <div className="materials-list">
            {names.map((n) => (
              <button key={n} className={n === selected ? "active" : ""} onClick={() => setSelected(n)}>
                <Swatch material={materials[n]} />
                <span>{n}</span>
                {materials[n].tile && <span className="muted">{materials[n].tile!.image ? "photo" : `${materials[n].tile!.size[0]}×${materials[n].tile!.size[1]}`}</span>}
              </button>
            ))}
            <form
              className="new-material"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <input value={newName} placeholder="New material name" onChange={(e) => setNewName(e.target.value)} />
              <button type="submit" disabled={!newName.trim()}>
                Add
              </button>
            </form>
          </div>
          {current && selected ? (
            <div className="material-editor">
              <div className="material-preview">
                <Swatch material={current} />
                <strong>{selected}</strong>
              </div>
              {!current.tile?.image && (
                <label className="field">
                  <span>{current.tile ? "Tile colour" : "Colour"}</span>
                  <input type="color" value={current.color} onChange={(e) => set({ color: e.target.value })} />
                </label>
              )}
              <label className="field">
                <span>Finish: {(current.roughness ?? 0.8) < 0.3 ? "glossy" : (current.roughness ?? 0.8) < 0.7 ? "satin" : "matt"}</span>
                <input type="range" min={0} max={1} step={0.05} value={current.roughness ?? 0.8} onChange={(e) => set({ roughness: Number(e.target.value) })} />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!current.tile}
                  onChange={(e) => set({ tile: e.target.checked ? { size: [30, 60], grout: 0.2, groutColor: "#d9d5cc", pattern: "grid" } : undefined })}
                />
                Tiles / planks
              </label>
              {current.tile && (
                <>
                  <div className="grid-2">
                    <Num label={current.tile.image ? "Photo shows width" : "Tile width"} value={current.tile.size[0]} min={1} onChange={(v) => setTile({ size: [v, current.tile!.size[1]] })} suffix="cm" />
                    <Num label={current.tile.image ? "Photo shows height" : "Tile height"} value={current.tile.size[1]} min={1} onChange={(v) => setTile({ size: [current.tile!.size[0], v] })} suffix="cm" />
                  </div>
                  {!current.tile.image && (
                    <>
                      <label className="field">
                        <span>Pattern</span>
                        <select value={current.tile.pattern ?? "grid"} onChange={(e) => setTile({ pattern: e.target.value as (typeof TILE_PATTERNS)[number] })}>
                          {TILE_PATTERNS.map((p) => (
                            <option key={p} value={p}>
                              {PATTERN_LABELS[p]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid-2">
                        <Num label="Grout" value={current.tile.grout ?? 0.2} step={0.1} max={5} onChange={(v) => setTile({ grout: v })} suffix="cm" />
                        <label className="field">
                          <span>Grout colour</span>
                          <input type="color" value={current.tile.groutColor ?? "#d9d5cc"} onChange={(e) => setTile({ groutColor: e.target.value })} />
                        </label>
                      </div>
                      <label className="field">
                        <span>Colour variation</span>
                        <input type="range" min={0} max={1} step={0.05} value={current.tile.variation ?? 0} onChange={(e) => setTile({ variation: Number(e.target.value) })} />
                      </label>
                    </>
                  )}
                  {current.tile.image && <p className="hint">Photo texture: {current.tile.image}. Ask the chat to make one from a photo of a tile.</p>}
                </>
              )}
              <p className="hint">Changes apply everywhere this material is used, in every scene. ⌘Z undoes.</p>
            </div>
          ) : (
            <p className="muted">No materials yet.</p>
          )}
        </div>
        <div className="dialog-buttons">
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
