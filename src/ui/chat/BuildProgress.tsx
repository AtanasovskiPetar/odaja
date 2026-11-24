// The home being built in front of you (the prompt-first start, or a reply on
// a home without walls once it starts building): the steps the AI is on, over
// the view, rather than a spinner. The camera frames the walls when they first
// appear, and moves into 3D when the reply is done.
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOdaja } from "../../store";
import { IconCheck } from "../icons";
import { useChat, type AssistantItem } from "./chatStore";

const PHASES: { label: string; tools: string[] }[] = [
  { label: "Looking at the home", tools: ["get_overview", "read_file", "list_templates", "list_library", "measure_object", "get_quantities"] },
  { label: "Reading the floor plan", tools: ["set_background", "view_background", "image_to_plan"] },
  { label: "Drawing the walls", tools: ["build_shell", "add_wall", "update_wall", "delete_wall", "set_room", "set_level", "set_stairs", "set_roof"] },
  { label: "Adding doors and windows", tools: ["add_opening", "update_opening", "delete_opening"] },
  { label: "Placing furniture", tools: ["add_object", "update_object", "delete_object", "edit_parts", "add_material_from_library"] },
  { label: "Choosing finishes", tools: ["set_material", "set_finish", "remove_finish", "edit_photo", "save_texture"] },
  { label: "Laying out the garden", tools: ["set_plot", "set_area", "set_fence"] },
  { label: "Checking the result", tools: ["check_issues", "screenshot"] },
];

const phaseOf = (tool: string) => PHASES.findIndex((p) => p.tools.includes(tool));
// Tools that build (not the ones that only look or check).
const builds = (tool: string) => {
  const p = phaseOf(tool);
  return p > 0 && p < PHASES.length - 1;
};

type ToolItem = Extract<AssistantItem, { type: "tool" }>;

// The phases a reply has been through, in order, and whether the last runs now.
export function phasesOf(tools: ToolItem[]): { label: string; done: boolean }[] {
  // Each phase once, in the order it was last worked on.
  const order: number[] = [];
  for (const t of tools) {
    const p = phaseOf(t.name);
    if (p === -1) continue;
    if (order.includes(p)) order.splice(order.indexOf(p), 1);
    order.push(p);
  }
  const running = tools.at(-1)?.ok === undefined && tools.length > 0;
  return order.map((p, i) => ({ label: PHASES[p]!.label, done: i < order.length - 1 || !running }));
}

export function BuildProgress() {
  const busy = useChat((s) => s.busy);
  // Asked for by the prompt-first start.
  const fromStart = useChat((s) => s.building);
  // The live reply's tools: re-rendered when a tool starts or ends, not for
  // every word of text that streams in.
  const tools = useChat(
    useShallow((s) => {
      const last = s.turns.at(-1);
      return s.busy && last?.role === "assistant" ? last.items.filter((i): i is ToolItem => i.type === "tool") : [];
    }),
  );
  const walls = useOdaja((s) => s.wholeShell?.walls.length ?? 0);
  const [building, setBuilding] = useState(false);
  const wallsBefore = useRef(walls);

  // A reply starting on a home without walls is a build.
  useEffect(() => {
    if (busy) setBuilding(useOdaja.getState().wholeShell?.walls.length === 0);
    else if (building) {
      setBuilding(false);
      if ((useOdaja.getState().wholeShell?.walls.length ?? 0) > 0) useOdaja.getState().setViewMode("3d");
    }
    // Only when a reply starts or ends.
  }, [busy]);

  // The first walls: frame them.
  useEffect(() => {
    if (building && wallsBefore.current === 0 && walls > 0) useOdaja.setState((s) => ({ frameRequest: s.frameRequest + 1 }));
    wallsBefore.current = walls;
  }, [walls, building]);

  // A question on an empty home isn't a build: wait until something is built.
  if (!building || !(fromStart || tools.some((t) => builds(t.name)))) return null;
  const phases = phasesOf(tools);
  const current = phases.at(-1);
  return (
    <div
      className="pointer-events-none absolute bottom-16 left-1/2 z-10 w-[280px] -translate-x-1/2 rounded-[12px] border border-line bg-card/95 px-4 py-3 text-[13px] text-ink shadow-float"
      role="status"
      aria-live="polite"
    >
      <div className="mb-1.5 font-medium">Building your home</div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {phases.slice(-4).map((p) => (
          <li key={p.label} className={`flex items-center gap-2 ${p.done ? "text-muted" : "text-ink"}`}>
            {p.done ? <IconCheck size={13} className="text-ok" /> : <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
            {p.label}
            {p.done ? "" : "…"}
          </li>
        ))}
        {(!current || current.done) && (
          <li className="flex items-center gap-2 text-ink">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            {current ? "Thinking about the next step…" : "Thinking…"}
          </li>
        )}
      </ul>
    </div>
  );
}
