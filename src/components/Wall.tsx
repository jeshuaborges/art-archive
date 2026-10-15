import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Summary } from "../types";
import { decadeOf, mediumOf, pct, STATUS_COLOR, yearLabel } from "../util";
import { masonry, wallColumns, type Layout } from "../layout";
import { ICheck, IStack } from "./Icons";
import { PreviewTile } from "./PreviewTile";

interface Props {
  list: Summary[];           // already filtered
  ranked: boolean;           // true when showing search results in relevance order
  matchOf?: (id: string) => number | undefined;
  onOpen: (id: string) => void;
  /** When set, tiles select instead of opening (bulk unarchive). */
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  layout: Layout;
}

type Section = { key: string; label: string; items: Summary[] };

export function Wall({ list, ranked, matchOf, onOpen, selected, onToggle, layout }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [contentW, setContentW] = useState(330);
  const cols = wallColumns(contentW, layout);
  const gap = layout.landscape ? 14 : 12;

  // Keep the tile at the top in place when the width changes (rotation, resize):
  // remember it while scrolling, put it back after the columns reflow.
  const anchor = useRef<{ id: string; dy: number; w: number } | null>(null);
  const laidW = useRef(0);
  const settleUntil = useRef(0);
  const remember = () => {
    const sc = scroller.current;
    if (!sc || sc.clientWidth !== laidW.current) return; // mid-reflow: keep the old anchor
    if (performance.now() < settleUntil.current) return; // our own corrections, not the reader
    if (sc.scrollTop < 4) { anchor.current = null; return; }
    // the topmost tile still showing below the sticky header, in the section at the top
    const r = sc.getBoundingClientRect(), edge = r.top + 56;
    let best: HTMLElement | null = null, bestTop = Infinity;
    for (const sec of sc.querySelectorAll<HTMLElement>("section")) {
      const sr = sec.getBoundingClientRect();
      if (sr.bottom <= edge) continue;
      if (sr.top > r.bottom) break;
      for (const t of sec.querySelectorAll<HTMLElement>("[data-id]")) {
        const tr = t.getBoundingClientRect();
        if (tr.bottom > edge && tr.top < bestTop) { best = t; bestTop = tr.top; }
      }
      if (best) break;
    }
    if (best) anchor.current = { id: best.dataset.id!, dy: bestTop - r.top, w: sc.clientWidth };
  };
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setContentW(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const sc = scroller.current, a = anchor.current;
    if (!sc) return;
    laidW.current = sc.clientWidth;
    if (!a || a.w === sc.clientWidth) return; // the tile at the top was noted at another width: put it back
    // Sections off screen are sized by estimate (content-visibility) until they
    // render, so put the anchor back now and again once the new layout settles.
    const fix = () => {
      const t = sc.querySelector<HTMLElement>(`[data-id="${CSS.escape(a.id)}"]`);
      if (!t) return;
      const d = t.getBoundingClientRect().top - sc.getBoundingClientRect().top - a.dy;
      if (Math.abs(d) > 1) sc.scrollTop += d;
    };
    settleUntil.current = performance.now() + 700;
    fix();
    const raf = requestAnimationFrame(fix);
    const timers = [80, 250, 600].map((ms) => setTimeout(fix, ms));
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, [contentW, cols]);
  const sections = useMemo<Section[]>(() => {
    if (ranked) return [{ key: "best", label: "Best matches", items: list }];
    const out: Section[] = [];
    const sorted = [...list].sort((a, b) => (b.yearStart ?? -1) - (a.yearStart ?? -1));
    for (const a of sorted) {
      const d = decadeOf(a.yearStart);
      const key = d == null ? "undated" : String(d);
      let s = out.find((x) => x.key === key);
      if (!s) { s = { key, label: d == null ? "Undated" : `${d}s`, items: [] }; out.push(s); }
      s.items.push(a);
    }
    return out;
  }, [list, ranked]);

  const jump = (key: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-dec="${key}"]`);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 2, behavior: "smooth" });
  };

  let k = 0;
  return (
    <>
      <div ref={scroller} className="scroll viewR" data-testid="wall" onScroll={remember}
        style={{ position: "absolute", left: 0, right: 0, top: `calc(${layout.landscape ? 70 : 118}px + var(--sat))`, bottom: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
        <div ref={inner} style={{ position: "relative", padding: "4px calc(44px + var(--sar)) calc(130px + var(--sab)) var(--gl)" }}>
          {sections.map((sec) => {
            const columns = masonry(sec.items.map((a) => a.aspect), cols).map((ix) => ix.map((i) => sec.items[i]));
            return (
              <section key={sec.key} data-dec={sec.key} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 900px" } as React.CSSProperties}>
                <h3 style={{ position: "sticky", top: 0, zIndex: 2, margin: "0 calc(-44px - var(--sar)) 0 calc(-1 * var(--gl))", padding: "12px calc(44px + var(--sar)) 10px var(--gl)", display: "flex", alignItems: "baseline", gap: 10, background: "rgba(16,15,14,.86)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
                  <span className="display" style={{ fontSize: 24, fontWeight: 700 }}>{sec.label}</span>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--muted)" }}>{sec.items.length} {sec.items.length === 1 ? "WORK" : "WORKS"}</span>
                </h3>
                <div style={{ display: "flex", gap, alignItems: "flex-start", padding: "6px 0 18px" }}>
                  {columns.map((col, ci) => (
                    <div key={ci} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
                      {col.map((a) => {
                        const m = matchOf?.(a.id);
                        const asp = Math.max(0.6, Math.min(1.7, a.aspect || 1));
                        const sel = selected?.has(a.id);
                        return (
                          <button key={a.id} data-id={a.id} className="press tilein" onClick={() => (selected && onToggle ? onToggle(a.id) : onOpen(a.id))} data-testid="wall-tile"
                            aria-label={selected ? `Select ${a.title || "Untitled"}` : `Open ${a.title || "Untitled"}`} aria-pressed={selected ? !!sel : undefined}
                            style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left", color: "var(--text)", animationDelay: `${Math.min(k++ * 40, 400)}ms` }}>
                            <div style={{ position: "relative", aspectRatio: String(asp), borderRadius: 14, overflow: "hidden", background: "#23201C", boxShadow: sel ? "0 0 0 3px var(--bg),0 0 0 5px var(--accent)" : "0 10px 24px rgba(0,0,0,.35)", transition: "box-shadow .25s" }}>
                              {a.thumb ? <img src={a.thumb} alt="" loading="lazy" draggable={false} className="art-img" /> : <PreviewTile state={a.preview} />}
                              {ranked && m !== undefined && <span style={{ position: "absolute", left: 8, top: 8, height: 24, padding: "0 8px", display: "flex", alignItems: "center", borderRadius: 99, background: "rgba(42,37,71,.92)", color: "var(--lupine-soft)", fontSize: 11, fontWeight: 700 }}>{pct(m)}</span>}
                              {a.archivedAt && !selected && <ArchivedBadge />}
                              {selected && (
                                <span aria-hidden style={{ position: "absolute", right: 8, top: 8, width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center", background: sel ? "var(--accent)" : "rgba(18,17,15,.6)", border: sel ? 0 : "2px solid rgba(243,239,232,.7)", color: "var(--on-accent)", transition: "background .2s" }}>{sel && <ICheck size={14} />}</span>
                              )}
                              {a.imageCount > 1 && <span style={{ position: "absolute", right: 8, bottom: 8, height: 22, padding: "0 7px", display: "flex", alignItems: "center", gap: 4, borderRadius: 99, background: "rgba(18,17,15,.72)", fontSize: 11, fontWeight: 600 }}><IStack />{a.imageCount}</span>}
                            </div>
                            <span className="clamp2" style={{ marginTop: 8, fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{a.title || "Untitled"}</span>
                            <span className="mono" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 10, letterSpacing: ".08em", color: "var(--muted)", textTransform: "uppercase" }}>
                              <span style={{ width: 6, height: 6, borderRadius: 9, background: STATUS_COLOR[a.status] }} />{[mediumOf(a), yearLabel(a)].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {!ranked && sections.length > 1 && (
        <nav className="viewR scroll" aria-label="Jump to decade" style={{ position: "absolute", right: "max(4px, var(--sar))", top: `calc(${layout.landscape ? 82 : 150}px + var(--sat))`, maxHeight: `calc(100% - ${layout.landscape ? 82 + 20 : 150 + 110}px - var(--sat) - var(--sab))`, overflowY: "auto", zIndex: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0", borderRadius: 99, background: "rgba(30,28,25,.6)" }}>
          {sections.map((s) => (
            <button key={s.key} onClick={() => jump(s.key)} aria-label={`Jump to ${s.label}`}
              style={{ flex: "none", width: 34, height: layout.compact ? 34 : 36, border: 0, background: "transparent", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>
              {s.key === "undated" ? "—" : `'${s.key.slice(2, 4)}`}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

/** Small pill on an archived piece's tile. */
export function ArchivedBadge({ style }: { style?: React.CSSProperties }) {
  return (
    <span className="mono" data-testid="archived-badge"
      style={{ position: "absolute", right: 8, top: 8, height: 22, padding: "0 8px", display: "flex", alignItems: "center", borderRadius: 99, background: "rgba(18,17,15,.8)", border: "1px solid var(--line-2)", color: "var(--text-2)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".1em", ...style }}>
      ARCHIVED
    </span>
  );
}
