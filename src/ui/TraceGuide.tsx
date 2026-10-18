// What to do in a home without walls yet, shown where the furniture list
// would be: with a floor plan in the background, set its scale and trace the
// walls (or hand the plan to the chat); without one, draw walls or add a plan.
import { platform } from "../platform";
import { useOdaja } from "../store";
import { useChat } from "./chat/chatStore";
import { PLAN_DRAFT } from "./NewHome";

function setScale() {
  const s = useOdaja.getState();
  s.setViewMode("plan");
  s.setUnderlayPanel(true);
  s.setUnderlayTool("calibrate");
}

function drawWalls() {
  const s = useOdaja.getState();
  s.setUnderlayTool(null);
  s.setMode("structure");
  s.setTool("wall");
}

function addPlan() {
  const s = useOdaja.getState();
  s.setViewMode("plan");
  s.setUnderlayPanel(true);
}

// The plan goes into the chat's message box, for the user to read and send.
async function askChat(image: string) {
  try {
    const blob = await (await fetch(platform.fileUrl(image))).blob();
    useChat.getState().startDraft(PLAN_DRAFT, [new File([blob], image.split("/").pop() ?? "plan.jpg", { type: blob.type })]);
  } catch (err) {
    useOdaja.getState().setNotice(`Couldn't hand the plan to the chat: ${(err as Error).message}`);
  }
}

export function TraceGuide() {
  const image = useOdaja((s) => s.projectDoc?.underlay?.image ?? null);
  if (!image)
    return (
      <div className="trace-guide">
        <p>No walls yet. Draw them, or put a floor plan underneath to trace.</p>
        <div className="actions">
          <button onClick={drawWalls}>Draw walls</button>
          <button onClick={addPlan}>Add a floor plan…</button>
        </div>
      </div>
    );
  return (
    <div className="trace-guide">
      <p className="trace-title">Trace your floor plan</p>
      <ol>
        <li>
          <span>
            <strong>Set the scale:</strong> click both ends of a wall or dimension whose length you know, then type it.
          </span>
          <button onClick={setScale}>Set scale</button>
        </li>
        <li>
          <span>
            <strong>Draw the walls</strong> over the plan, corner to corner. Then add doors and windows, and click inside each room to name it.
          </span>
          <button onClick={drawWalls}>Draw walls</button>
        </li>
      </ol>
      <p className="trace-or">
        Or let the chat trace it for you (it needs an AI connection, set up under ⚙ in the chat).{" "}
        <button className="link" onClick={() => askChat(image)}>
          Ask the chat
        </button>
      </p>
    </div>
  );
}
