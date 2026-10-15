import { useEffect, useRef, useState } from "react";
import type { ImageDTO } from "../types";
import { clamp, fmtBytes, GRADE_META, KIND_META } from "../util";
import { IClose, IDownload, IInfo } from "./Icons";
import { PreviewTile } from "./PreviewTile";

/**
 * Full screen: one image at a time on black, edge to edge in either orientation.
 * Pinch or double-tap to zoom, drag to pan while zoomed, swipe sideways for the
 * next image, swipe down to close. Shows the display preview (the original is a
 * download, from the bar at the bottom).
 */
export function Viewer({ images, start, onClose }: { images: ImageDTO[]; start: number; onClose: () => void }) {
  const [idx, setIdx] = useState(clamp(start, 0, images.length - 1));
  const [info, setInfo] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState({ dx: 0, dy: 0, live: false });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ startDist: 0, startS: 1, startX: 0, startY: 0, cx: 0, cy: 0, lastTap: 0, moved: false, t0: 0, ox: 0, oy: 0 });
  const im = images[idx];

  useEffect(() => { setZ({ s: 1, x: 0, y: 0 }); }, [idx]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(images.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [images.length, onClose]);
  if (!im) return null;

  const MAX = 4;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button,a")) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.current.values()];
    if (p.length === 2) {
      g.current.startDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      g.current.startS = z.s; g.current.startX = z.x; g.current.startY = z.y;
      g.current.cx = (p[0].x + p[1].x) / 2; g.current.cy = (p[0].y + p[1].y) / 2;
      setDrag({ dx: 0, dy: 0, live: false });
    } else if (p.length === 1) {
      g.current.ox = e.clientX; g.current.oy = e.clientY; g.current.startX = z.x; g.current.startY = z.y;
      g.current.moved = false; g.current.t0 = performance.now();
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.current.values()];
    if (p.length === 2) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const s = clamp(g.current.startS * (d / Math.max(1, g.current.startDist)), 1, MAX);
      const k = s / g.current.startS;
      const cx = g.current.cx - window.innerWidth / 2, cy = g.current.cy - window.innerHeight / 2;
      setZ({ s, x: cx - (cx - g.current.startX) * k, y: cy - (cy - g.current.startY) * k });
      g.current.moved = true;
      return;
    }
    const dx = e.clientX - g.current.ox, dy = e.clientY - g.current.oy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.current.moved = true;
    if (z.s > 1.02) setZ((v) => ({ ...v, x: g.current.startX + dx, y: g.current.startY + dy }));
    else setDrag({ dx, dy, live: true });
  };
  const up = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;   // began on a button: not a gesture
    pts.current.delete(e.pointerId);
    if (pts.current.size) return;
    if (z.s <= 1.02) {
      const { dx, dy } = drag;
      const fast = performance.now() - g.current.t0 < 250;
      if (Math.abs(dy) > Math.abs(dx) && dy > (fast ? 50 : 120)) { onClose(); return; }
      if (Math.abs(dx) > Math.abs(dy)) {
        if ((dx < -70 || (fast && dx < -30)) && idx < images.length - 1) setIdx(idx + 1);
        else if ((dx > 70 || (fast && dx > 30)) && idx > 0) setIdx(idx - 1);
      }
      setZ({ s: 1, x: 0, y: 0 });
    }
    setDrag({ dx: 0, dy: 0, live: false });
    if (!g.current.moved) {
      const t = performance.now();
      if (t - g.current.lastTap < 300) {
        // double tap: zoom in on the spot, or back out
        const cx = e.clientX - window.innerWidth / 2, cy = e.clientY - window.innerHeight / 2;
        setZ(z.s > 1.02 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: -cx * 1.5, y: -cy * 1.5 });
        g.current.lastTap = 0;
      } else {
        g.current.lastTap = t;
        const tap = t;
        setTimeout(() => { if (g.current.lastTap === tap) setChrome((c) => !c); }, 300);
      }
    }
  };

  const swipeDown = drag.live && Math.abs(drag.dy) > Math.abs(drag.dx) ? Math.max(0, drag.dy) : 0;
  const sideways = drag.live && Math.abs(drag.dx) >= Math.abs(drag.dy) ? drag.dx : 0;
  const t = im.tech, p = im.print;
  const grade = p ? GRADE_META[p.grade] : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Full screen image" data-testid="viewer"
      style={{ position: "fixed", inset: 0, zIndex: 80, background: `rgba(0,0,0,${1 - Math.min(0.6, swipeDown / 500)})`, touchAction: "none", userSelect: "none" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>
        <div style={{
          width: "100%", height: "100%", display: "grid", placeItems: "center",
          transform: `translate(${z.x + sideways}px, ${z.y + swipeDown}px) scale(${z.s * (1 - Math.min(0.25, swipeDown / 1200))})`,
          transition: drag.live || pts.current.size ? "none" : "transform .3s var(--ease-out)",
        }}>
          {im.display
            ? <img key={im.id} src={im.display} alt={im.role || KIND_META[im.kind].label} draggable={false} className="fadein"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", padding: "var(--sat) var(--sar) var(--sab) var(--sal)" }} />
            : <div style={{ position: "relative", width: 260, height: 260 }}><PreviewTile state={im.preview} /></div>}
        </div>
      </div>

      {/* top: close, position, details */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(10px + var(--sat)) max(12px, var(--sar)) 24px max(12px, var(--sal))", background: "linear-gradient(rgba(0,0,0,.6), transparent)", opacity: chrome ? 1 : 0, pointerEvents: chrome ? "auto" : "none", transition: "opacity .2s" }}>
        <button className="icon-btn press" aria-label="Close full screen" onClick={onClose} data-testid="viewer-close" style={{ background: "rgba(36,33,30,.75)" }}><IClose size={14} /></button>
        <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", color: "var(--text-2)" }}>{idx + 1} / {images.length}{z.s > 1.02 ? ` · ${z.s.toFixed(1)}×` : ""}</span>
        <button className="icon-btn press" aria-label="File details" aria-pressed={info} onClick={() => setInfo(!info)} data-testid="viewer-info" style={{ background: info ? "var(--text)" : "rgba(36,33,30,.75)", color: info ? "#12110F" : "var(--text)" }}><IInfo /></button>
      </div>

      {/* bottom: what it is, and the original */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: `28px max(14px, var(--sar)) calc(12px + var(--sab)) max(14px, var(--sal))`, background: "linear-gradient(transparent, rgba(0,0,0,.75) 40%)", opacity: chrome ? 1 : 0, pointerEvents: chrome ? "auto" : "none", transition: "opacity .2s" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {info && (
            <div className="inup" data-testid="viewer-details" style={{ marginBottom: 10, padding: "12px 14px", borderRadius: 16, background: "rgba(28,26,23,.92)", border: "1px solid var(--line)", fontSize: 13, lineHeight: 1.5 }}>
              {grade && p && <div><span style={{ color: grade.color, fontWeight: 700 }}>{grade.label}</span><span style={{ color: "var(--text-2)" }}> · {p.summary}</span></div>}
              <div className="mono" style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
                {[t?.format, im.width && im.height ? `${im.width} × ${im.height} px` : null, p ? `${p.megapixels} MP` : null, fmtBytes(im.bytes),
                  t?.bitsPerChannel ? `${t.bitsPerChannel}-bit` : null, t?.iccProfile, t?.dpi ? `${t.dpi} dpi` : null].filter(Boolean).join(" · ")}
              </div>
              {p?.warnings.map((w) => <div key={w} style={{ marginTop: 4, fontSize: 12, color: "#FFD678" }}>! {w}</div>)}
              <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>Showing a 1800 px preview. The original is the full file.</div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600 }}>
                <span style={{ width: 7, height: 7, borderRadius: 9, background: KIND_META[im.kind].color, flex: "none" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{im.role || KIND_META[im.kind].label}</span>
              </div>
              <div className="mono" style={{ marginTop: 3, fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {im.originalName || im.original?.split("/").pop()}
              </div>
            </div>
            <a href={im.download} download className="btn btn-light press" data-testid="viewer-download" style={{ height: 44, padding: "0 16px", fontSize: 14, textDecoration: "none", flex: "none" }}>
              <IDownload size={16} />Original
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
