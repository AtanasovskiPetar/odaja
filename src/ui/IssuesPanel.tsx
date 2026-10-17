// Floating list of design issues in the open scene, with "show" and quick
// fixes. Issues never block anything; this is just a checklist.
import { useState } from "react";
import { issuesFor, type Issue } from "../model/issues";
import { useOdaja } from "../store";

function show(issue: Issue) {
  const s = useOdaja.getState();
  s.focusIssue(issue.key);
  if (s.viewMode !== "plan") s.setViewMode("plan");
  const target = issue.targets[0];
  if (target.kind === "object") {
    if (s.mode !== "furnish") s.setMode("furnish");
    s.select(target.id);
  } else {
    if (s.mode !== "structure") s.setMode("structure");
    s.selectStructure({ kind: target.kind, id: target.id });
  }
}

function fix(issue: Issue) {
  const s = useOdaja.getState();
  if (issue.fix?.scene) s.apply(issue.fix.scene);
  if (issue.fix?.shell) s.applyShell(issue.fix.shell);
  s.focusIssue(null);
}

export function IssuesPanel() {
  const scene = useOdaja((s) => s.scene);
  const shell = useOdaja((s) => s.shell);
  const focused = useOdaja((s) => s.focusedIssue);
  const [open, setOpen] = useState(false);
  const issues = issuesFor(scene, shell);
  const errors = issues.filter((i) => i.severity === "error").length;

  if (issues.length === 0) {
    return (
      <div className="issues-badge ok" title="No problems found in this scene">
        No issues
      </div>
    );
  }

  return (
    <div className={`issues ${open ? "open" : ""}`}>
      <button className={`issues-badge ${errors ? "error" : "warning"}`} onClick={() => setOpen(!open)}>
        {errors > 0 && `${errors} problem${errors > 1 ? "s" : ""}`}
        {errors > 0 && issues.length > errors && " · "}
        {issues.length > errors && `${issues.length - errors} warning${issues.length - errors > 1 ? "s" : ""}`}
        <span className="chevron">{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <ul>
          {issues.map((issue) => (
            <li key={issue.key} className={`${issue.severity} ${focused === issue.key ? "focused" : ""}`}>
              <span className="dot" />
              <span className="message">{issue.message}</span>
              <span className="issue-actions">
                <button onClick={() => show(issue)}>Show</button>
                {issue.fix && (
                  <button className="primary-small" onClick={() => fix(issue)}>
                    {issue.fix.label}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
