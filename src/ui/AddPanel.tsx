import { TEMPLATES, type Template } from "../model/library";
import { addTemplateObject } from "./actions";

const CATEGORIES: Template["category"][] = ["Kitchen", "Living", "Bedroom", "Bathroom", "Basic"];

// Catalogue of built-in templates. Clicking one drops it in the middle of the
// view, selected, ready to drag into place.
export function AddPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="add-panel">
      {CATEGORIES.map((category) => (
        <div key={category}>
          <h3>{category}</h3>
          <div className="add-grid">
            {TEMPLATES.filter((t) => t.category === category).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  addTemplateObject(t.id);
                  onClose();
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
