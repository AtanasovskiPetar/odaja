// UI-level actions that combine store state with scene operations.
import { roomAt, shellBounds, type Vec } from "../model/geometry";
import { TEMPLATES_BY_ID, templateParams } from "../model/library";
import { addObject, deleteObject, duplicateObject, uniqueId } from "../model/operations";
import { deleteOpening, deleteRoom, deleteWall } from "../model/shellOps";
import { round } from "../model/units";
import { useOdaja } from "../store";

// Where new objects appear: the middle of the plan view if it's showing,
// otherwise the middle of the flat.
export function dropPoint(): Vec {
  const { viewMode, planView, shell } = useOdaja.getState();
  if (viewMode === "plan" && planView) return [round(planView.centerX * 100), round(planView.centerZ * 100)];
  const b = shell ? shellBounds(shell) : null;
  return b ? [round((b.minX + b.maxX) / 2), round((b.minY + b.maxY) / 2)] : [0, 0];
}

export function addTemplateObject(templateId: string) {
  const { sceneDoc, shell, apply, select } = useOdaja.getState();
  const template = TEMPLATES_BY_ID.get(templateId);
  if (!sceneDoc || !template) return;
  const position = dropPoint();
  const id = uniqueId(sceneDoc, template.id);
  apply(
    addObject({
      id,
      name: template.name,
      template: template.id,
      params: templateParams(template),
      position,
      elevation: template.elevation,
      room: shell ? roomAt(shell, position) : undefined,
    }),
  );
  select(id);
}

export function duplicateSelected() {
  const { sceneDoc, selectedId, apply, select } = useOdaja.getState();
  if (!sceneDoc || !selectedId) return;
  const id = uniqueId(sceneDoc, selectedId);
  apply(duplicateObject(selectedId, id));
  select(id);
}

export function deleteSelected() {
  const { scene, selectedId, apply, select } = useOdaja.getState();
  const object = scene?.objects.find((o) => o.id === selectedId);
  if (!object || object.locked) return;
  apply(deleteObject(object.id));
  select(null);
}

export function deleteStructureSelection() {
  const { structureSelection: sel, applyShell, selectStructure } = useOdaja.getState();
  if (!sel || sel.kind === "area") return;
  applyShell(sel.kind === "wall" ? deleteWall(sel.id) : sel.kind === "opening" ? deleteOpening(sel.id) : deleteRoom(sel.id));
  selectStructure(null);
}
