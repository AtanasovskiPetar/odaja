import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Portal-based popover that clamps itself inside the viewport, so dropdowns
// never clip off the left/right/bottom edge or inside overflow-hidden panels.
export function Popover({
  open,
  onClose,
  anchorRef,
  align = "end",
  width = 240,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: "start" | "end";
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const pad = 10;
      const w = Math.min(width, window.innerWidth - pad * 2);
      const rawLeft = align === "end" ? rect.right - w : rect.left;
      const left = Math.max(pad, Math.min(rawLeft, window.innerWidth - w - pad));
      const top = Math.min(rect.bottom + 6, window.innerHeight - pad - 120);
      setPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 20) }}
      className="fixed z-50 rounded-[10px] bg-card p-2.5 shadow-float border border-line text-ink"
    >
      {children}
    </div>,
    document.body,
  );
}
