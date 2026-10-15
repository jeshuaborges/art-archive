import { useEffect, useRef, useState } from "react";

/** Bottom sheet with a scrim and drag-down-to-dismiss on its header. */
export function Sheet({ open, onClose, label, children, header, footer, maxHeight = "92%", testId }: {
  open: boolean; onClose: () => void; label: string; children: React.ReactNode;
  header?: React.ReactNode; footer?: React.ReactNode; maxHeight?: string; testId?: string;
}) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef({ y: 0, sc: 1 });
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves into the sheet when it opens and back where it was when it closes.
  // Depends on `open` only, so re-renders while it's open never steal focus.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const t = setTimeout(() => { if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true }); }, 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    el?.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); el?.removeEventListener("keydown", onKey); prev?.focus?.({ preventScroll: true }); };
  }, [open]);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button,input,textarea")) return;
    const r = e.currentTarget.getBoundingClientRect();
    g.current = { y: e.clientY, sc: r.width / e.currentTarget.offsetWidth || 1 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    setDragging(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging) return;
    const d = (e.clientY - g.current.y) / g.current.sc;
    setDy(d > 0 ? d : d * 0.2);
  };
  const up = () => {
    if (!dragging) return;
    setDragging(false);
    if (dy > 110) onClose();
    setDy(0);
  };

  return (
    <>
      <div className="scrim" aria-hidden onClick={onClose} style={{ opacity: open ? Math.max(0, 1 - dy / 420) : 0, pointerEvents: open ? "auto" : "none" }} />
      <section ref={panel} role="dialog" aria-modal="true" aria-label={label} aria-hidden={!open} tabIndex={-1} data-testid={testId}
        className="sheet" style={{
          maxHeight, display: "flex", flexDirection: "column", outline: "none",
          transform: open ? `translateY(${dy}px)` : "translateY(106%)",
          // hidden (and out of the tab order) once the slide-out finishes
          visibility: open ? "visible" : "hidden",
          transition: dragging ? "none" : open ? "transform .55s cubic-bezier(.2,.9,.25,1), visibility 0s" : "transform .55s cubic-bezier(.2,.9,.25,1), visibility 0s linear .55s",
        }}>
        <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ flex: "none", padding: "10px 20px 6px", touchAction: "none", cursor: "grab" }}>
          <div className="sheet-handle" />
          {header}
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{open || dy ? children : null}</div>
        {footer}
      </section>
    </>
  );
}
