import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Summary } from "../types";
import { mediumOf, pct, STATUS_COLOR, yearLabel } from "../util";
import { masonry, masonryHeight, wallColumns, type Layout } from "../layout";
import { groupYears, sortNewestFirst, yearFull } from "../years";
import { YearRail, type YearEntry } from "./YearNav";
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
  /** px below the top safe area where the wall starts (under the top bar, and the chips when shown). */
  top: number;
}

type Section = { key: string; label: string; items: Summary[] };

/**
 * Masonry grouped by year, newest first, undated last, with sticky year headers
 * and a year index down the right edge (press and drag to scrub).
 */
export function Wall({ list, ranked, matchOf, onOpen, selected, onToggle, layout, top }: Props) {
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
    const sorted = sortNewestFirst(list);
    return groupYears(sorted).map((g) => ({ key: String(g.key), label: yearFull(g.year), items: sorted.slice(g.first, g.first + g.count) }));
  }, [list, ranked]);
  const entries = useMemo<YearEntry[]>(() => sections.map((s) => ({ key: s.key, year: s.key === "undated" ? null : Number(s.key), count: s.items.length, thumb: s.items[0]?.thumb ?? null })), [sections]);
  // off-screen sections are sized by estimate (content-visibility): estimate well, so a jump to a far year lands on it
  const colW = Math.max(60, (contentW - gap * (cols - 1)) / cols);
  const estimate = (sec: Section) => masonryHeight(sec.items.map((a) => a.aspect), cols, colW) + 50 + 24;

  // the year at the top of the scroll, for the rail
  const [activeYear, setActiveYear] = useState(0);
  const spyRaf = useRef(0);
  const spy = () => {
    cancelAnimationFrame(spyRaf.current);
    spyRaf.current = requestAnimationFrame(() => {
      const sc = scroller.current;
      if (!sc || jumping.current) return;
      const secs = sc.querySelectorAll<HTMLElement>("section[data-year]");
      let a = 0;
      secs.forEach((el, i) => { if (el.offsetTop <= sc.scrollTop + 12) a = i; });
      setActiveYear(a);
    });
  };
  useEffect(() => () => cancelAnimationFrame(spyRaf.current), []);

  // jump straight to a year (no smooth scroll: the rail is scrubbed live); put it
  // back once the sections it passed have rendered at their real height
  const jumping = useRef<string | null>(null);
  const jumpTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const jump = (i: number) => {
    const key = sections[i]?.key, sc = scroller.current;
    if (!key || !sc) return;
    setActiveYear(i);
    jumping.current = key;
    const fix = () => {
      if (jumping.current !== key) return;
      const el = sc.querySelector<HTMLElement>(`[data-year="${key}"]`);
      if (el && Math.abs(sc.scrollTop - el.offsetTop) > 1) sc.scrollTop = el.offsetTop;
    };
    fix();
    jumpTimers.current.forEach(clearTimeout);
    jumpTimers.current = [setTimeout(fix, 16), setTimeout(fix, 90), setTimeout(fix, 260), setTimeout(() => { fix(); if (jumping.current === key) jumping.current = null; }, 420)];
  };
  useEffect(() => () => jumpTimers.current.forEach(clearTimeout), []);

  let k = 0;
  return (
    <>
      <div ref={scroller} className="scroll viewR" data-testid="wall" onScroll={() => { remember(); spy(); }}
        onWheel={() => { jumping.current = null; }} onTouchStart={() => { jumping.current = null; }}
        style={{ position: "absolute", left: 0, right: 0, top: `calc(${top}px + var(--sat))`, bottom: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
        <div ref={inner} style={{ position: "relative", padding: "4px calc(44px + var(--sar)) calc(130px + var(--sab)) var(--gl)" }}>
          {sections.map((sec) => {
            const columns = masonry(sec.items.map((a) => a.aspect), cols).map((ix) => ix.map((i) => sec.items[i]));
            return (
              <section key={sec.key} data-year={sec.key} style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${estimate(sec)}px` } as React.CSSProperties}>
                {/* Search results have no heading: the "N close matches" line above already says what they are. */}
                {ranked ? <h3 className="sr-only">{sec.label}</h3> : (
                  <h3 className="wall-head">
                    <span className="display">{sec.label}</span>
                    <span aria-hidden className="wall-head-rule" />
                  </h3>
                )}
                <div style={{ display: "flex", gap, alignItems: "flex-start", padding: "6px 0 18px" }}>
                  {columns.map((col, ci) => (
                    <div key={ci} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
                      {col.map((a) => {
                        const m = matchOf?.(a.id);
                        const asp = Math.max(0.6, Math.min(1.7, a.aspect || 1));
                        const sel = selected?.has(a.id);
                        return (
                          <button key={a.id} data-id={a.id} className={k < 12 ? "press tilein" : "press"} onClick={() => (selected && onToggle ? onToggle(a.id) : onOpen(a.id))} data-testid="wall-tile"
                            aria-label={selected ? `Select ${a.title || "Untitled"}` : `Open ${a.title || "Untitled"}`} aria-pressed={selected ? !!sel : undefined}
                            style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left", color: "var(--text)", animationDelay: `${Math.min(k++ * 40, 400)}ms` }}>
                            <div style={{ position: "relative", aspectRatio: String(asp), borderRadius: 14, overflow: "hidden", background: "#23201C", boxShadow: sel ? "0 0 0 3px var(--bg),0 0 0 5px var(--accent)" : "0 10px 24px rgba(0,0,0,.35)", transition: "box-shadow .25s" }}>
                              {a.thumb ? <img src={a.thumb} alt="" loading="lazy" decoding="async" draggable={false} className="art-img" /> : <PreviewTile state={a.preview} />}
                              {ranked && m !== undefined && <span style={{ position: "absolute", left: 8, top: 8, height: 24, padding: "0 8px", display: "flex", alignItems: "center", borderRadius: 99, background: "rgba(42,37,71,.92)", color: "var(--lupine-soft)", fontSize: 11, fontWeight: 700 }}>{pct(m)}</span>}
                              {a.archivedAt && !selected && <ArchivedBadge />}
                              {selected && (
                                <span aria-hidden style={{ position: "absolute", right: 8, top: 8, width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center", background: sel ? "var(--accent)" : "rgba(18,17,15,.6)", border: sel ? 0 : "2px solid rgba(243,239,232,.7)", color: "var(--on-accent)", transition: "background .2s" }}>{sel && <ICheck size={14} />}</span>
                              )}
                              {a.imageCount > 1 && <span style={{ position: "absolute", right: 8, bottom: 8, height: 22, padding: "0 7px", display: "flex", alignItems: "center", gap: 4, borderRadius: 99, background: "rgba(18,17,15,.72)", fontSize: 11, fontWeight: 600 }}><IStack />{a.imageCount}</span>}
                            </div>
                            <span className="clamp2" style={{ marginTop: 8, fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{a.title || "Untitled"}</span>
                            <span className="mono" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, letterSpacing: ".08em", color: "var(--muted)", textTransform: "uppercase" }}>
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
        <YearRail entries={entries} active={Math.min(activeYear, entries.length - 1)} onPick={jump}
          style={{ right: "max(3px, var(--sar))", top: `calc(${top + 10}px + var(--sat))`, bottom: `calc(${layout.landscape ? 12 : 24}px + var(--sab))`, zIndex: 4 }} />
      )}
    </>
  );
}

/** Small pill on an archived piece's tile. */
export function ArchivedBadge({ style }: { style?: React.CSSProperties }) {
  return (
    <span className="mono" data-testid="archived-badge"
      style={{ position: "absolute", right: 8, top: 8, height: 22, padding: "0 8px", display: "flex", alignItems: "center", borderRadius: 99, background: "rgba(18,17,15,.8)", border: "1px solid var(--line-2)", color: "var(--text-2)", fontSize: 11, fontWeight: 600, letterSpacing: ".1em", ...style }}>
      ARCHIVED
    </span>
  );
}
