import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { vibrate } from "../util";
import {
  axisLabels, barHeights, clampLabel, railIndexAt, railLabelShown, railLayout, rulerSlots, slotAt,
  stepYear, worksLabel, yearBreaks, yearFull, yearShort,
} from "../years";

/** One year in a year navigation control. */
export interface YearEntry {
  key: string;
  year: number | null;
  count: number;
  /** Thumbnail of the year's first piece, for the scrubbing bubble. */
  thumb: string | null;
}

interface NavProps {
  entries: YearEntry[];
  active: number;
  onPick: (i: number) => void;
  compact?: boolean;
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** A pointer position in the element's own (unscaled) pixels. */
function localPoint(el: HTMLElement, cx: number, cy: number) {
  const r = el.getBoundingClientRect();
  const sx = r.width / (el.offsetWidth || 1) || 1, sy = r.height / (el.offsetHeight || 1) || 1;
  return { x: (cx - r.left) / sx, y: (cy - r.top) / sy };
}

const valueText = (e: YearEntry | undefined) => (e ? `${yearFull(e.year)}, ${worksLabel(e.count)}` : "");

/** The floating card shown while scrubbing a year index: the year, its count and its first piece. */
export function YearBubble({ entry, style }: { entry: YearEntry; style?: React.CSSProperties }) {
  return (
    <div aria-hidden data-testid="year-bubble"
      style={{ position: "absolute", zIndex: 20, display: "flex", alignItems: "center", gap: 12, padding: "8px 16px 8px 8px", borderRadius: 18, background: "rgba(26,24,22,.95)", border: "1px solid var(--line-2)", boxShadow: "0 18px 44px rgba(0,0,0,.6)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", pointerEvents: "none", whiteSpace: "nowrap", ...style }}>
      <div style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", background: "#23201C", flex: "none" }}>
        {entry.thumb && <img src={entry.thumb} alt="" draggable={false} className="art-img" />}
      </div>
      <div>
        <div className="display" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, letterSpacing: "-.03em", color: "var(--text)" }}>{yearFull(entry.year)}</div>
        <div className="mono" style={{ marginTop: 6, fontSize: 11, letterSpacing: ".1em", color: "var(--accent-soft)", textTransform: "uppercase" }}>{worksLabel(entry.count)}</div>
      </div>
    </div>
  );
}

// ======================================================================== density ruler (the timeline)
/**
 * A. Density ruler: one bar per year, as tall as the year is busy, the current
 * year in the accent with its name riding above it. Press and drag along it to
 * scrub year by year (a tick at each year); tap a bar to jump.
 */
export function DensityRuler({ entries, active, onPick, compact }: NavProps) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const n = entries.length;
  const years = useMemo(() => entries.map((e) => e.year), [entries]);
  const slots = useMemo(() => rulerSlots(years, w), [years, w]);
  const LBL = compact ? 24 : 28, BAR = compact ? 26 : 34, AX = 16;
  const heights = useMemo(() => barHeights(entries, 3, BAR), [entries, BAR]);
  const axis = useMemo(() => axisLabels(years, slots, compact ? 34 : 38), [years, slots, compact]);
  const [press, setPressState] = useState(false);
  const pressing = useRef(false);
  const setPress = (v: boolean) => { pressing.current = v; setPressState(v); };
  const last = useRef(-1);
  const labelRef = useRef<HTMLDivElement>(null);
  const [lw, setLw] = useState(100);
  const cur = entries[active];
  useLayoutEffect(() => { if (labelRef.current) setLw(labelRef.current.offsetWidth); }, [active, entries]);

  const pickAt = (cx: number, cy: number) => {
    const i = slotAt(localPoint(ref.current!, cx, cy).x, slots);
    if (i === last.current) return;
    last.current = i;
    onPick(i); vibrate(3);
  };
  const s = slots[active];
  const center = s ? s.x + s.w / 2 : 0;
  const base = LBL + BAR; // bars stand on this line
  const inset = (sl: { w: number }) => Math.min(3, sl.w * 0.22);

  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label="Year" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.max(0, n - 1)} aria-valuenow={active}
      aria-valuetext={valueText(cur)} data-testid="year-ruler"
      onKeyDown={(e) => { const i = stepYear(e.key, active, n); if (i !== null) { e.preventDefault(); if (i !== active) { onPick(i); vibrate(4); } } }}
      onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } last.current = active; setPress(true); pickAt(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (pressing.current) pickAt(e.clientX, e.clientY); }}
      onPointerUp={() => setPress(false)} onPointerCancel={() => setPress(false)}
      style={{ position: "relative", height: base + 4 + AX, flex: "none", touchAction: "none", cursor: press ? "grabbing" : "pointer", borderRadius: 6 }}>
      {/* the current year, riding above its bar */}
      {cur && s && (
        <div ref={labelRef} aria-hidden data-testid="ruler-year"
          style={{ position: "absolute", top: 0, left: clampLabel(center, lw, w), transform: "translateX(-50%)", display: "flex", alignItems: "baseline", gap: 7, whiteSpace: "nowrap", transition: press ? "none" : "left .25s var(--ease-out)" }}>
          <span className="display" style={{ fontSize: compact ? 17 : 20, fontWeight: 800, lineHeight: 1, letterSpacing: "-.02em", color: "var(--text)" }}>{yearFull(cur.year)}</span>
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: ".08em", color: "var(--muted)", textTransform: "uppercase" }}>{worksLabel(cur.count)}</span>
        </div>
      )}
      {/* a hairline from the label down to the bar */}
      {s && <div aria-hidden style={{ position: "absolute", left: center - 0.5, top: LBL - 4, width: 1, height: Math.max(0, BAR - heights[active] + 2), background: "rgba(var(--accent-rgb), .55)", transition: press ? "none" : "left .25s var(--ease-out)" }} />}
      {entries.map((e, i) => {
        const sl = slots[i];
        if (!sl) return null;
        const on = i === active, und = e.year == null;
        return (
          <div key={e.key}>
            {sl.gapBefore && (
              <span aria-hidden style={{ position: "absolute", left: sl.x - (sl.w * 0.35), top: base - 7, transform: "translateX(-50%)", fontFamily: "var(--mono)", fontSize: 9, color: "var(--faint)" }}>⁄⁄</span>
            )}
            <div aria-hidden style={{ position: "absolute", left: sl.x + inset(sl) / 2, width: Math.max(2, sl.w - inset(sl)), top: base - heights[i], height: heights[i], borderRadius: "2px 2px 1px 1px",
              background: on ? "var(--accent)" : und ? "repeating-linear-gradient(135deg, rgba(243,239,232,.42) 0 2px, rgba(243,239,232,.12) 2px 4px)" : "rgba(243,239,232,.3)",
              boxShadow: on ? "0 0 12px rgba(var(--accent-rgb), .65)" : "none", transition: "background .2s, box-shadow .2s" }} />
            <div aria-hidden style={{ position: "absolute", left: sl.x, width: sl.w, top: base + 1, height: 1, background: "rgba(243,239,232,.14)" }} />
          </div>
        );
      })}
      {axis.filter((i) => i !== active).map((i) => {
        const sl = slots[i];
        return (
          <span key={i} aria-hidden className="mono" style={{ position: "absolute", top: base + 5, left: clampLabel(sl.x + sl.w / 2, 30, w), transform: "translateX(-50%)", fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap" }}>
            {entries[i].year == null ? "—" : entries[i].year}
          </span>
        );
      })}
    </div>
  );
}

// ======================================================================== year rail (the wall)
/**
 * C. Side year index, like the A–Z index in Contacts: a column of years down an
 * edge. Press and drag along it to scrub (a tick at each year) with a large
 * bubble showing the year, its count and its first piece. Labels thin out to
 * every other year (dots between) when the column is short.
 */
export function YearRail({ entries, active, onPick, label = "Jump to year", style, bubbleSide = "left" }: NavProps & { label?: string; style?: React.CSSProperties; bubbleSide?: "left" | "right" }) {
  const [ref, { h }] = useSize<HTMLDivElement>();
  const PAD = 8;
  const n = entries.length;
  const rl = railLayout(n, Math.max(0, h - PAD * 2));
  const [press, setPressState] = useState<number | null>(null);
  const pressing = useRef(false);
  const setPress = (i: number | null) => { pressing.current = i !== null; setPressState(i); };
  const [flash, setFlash] = useState<number | null>(null);
  const flashT = useRef<ReturnType<typeof setTimeout>>();
  const last = useRef(-1);

  const at = (cx: number, cy: number) => railIndexAt(localPoint(ref.current!, cx, cy).y - PAD, rl, n);
  const pick = (i: number) => {
    setPress(i);
    if (i === last.current) return;
    last.current = i;
    onPick(i); vibrate(3);
  };
  const shown = press ?? flash;
  const rowY = (i: number) => PAD + rl.offset + (i + 0.5) * rl.row;
  const bubbleTop = shown == null ? 0 : Math.max(-6, Math.min(h - 66, rowY(shown) - 36));

  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.max(0, n - 1)} aria-valuenow={active}
      aria-valuetext={valueText(entries[active])} data-testid="year-rail"
      onKeyDown={(e) => {
        const i = stepYear(e.key, active, n);
        if (i === null) return;
        e.preventDefault();
        if (i !== active) { onPick(i); vibrate(4); }
        setFlash(i); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 900);
      }}
      onBlur={() => setFlash(null)}
      onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } last.current = active; setFlash(null); pick(at(e.clientX, e.clientY)); }}
      onPointerMove={(e) => { if (pressing.current) pick(at(e.clientX, e.clientY)); }}
      onPointerUp={() => setPress(null)} onPointerCancel={() => setPress(null)}
      style={{ position: "absolute", width: 38, zIndex: 4, touchAction: "none", cursor: "pointer", ...style }}>
      <div aria-hidden style={{ position: "absolute", left: 3, right: 3, top: rl.offset, bottom: rl.offset, borderRadius: 99, background: press !== null ? "rgba(36,33,30,.9)" : "rgba(30,28,25,.6)", border: "1px solid var(--line)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", transition: "background .2s" }} />
      {rl.row > 0 && entries.map((e, i) => {
        const on = i === active;
        const lab = railLabelShown(i, n, rl.step, active);
        return (
          <div key={e.key} aria-hidden style={{ position: "absolute", left: 0, right: 0, top: PAD + rl.offset + i * rl.row, height: rl.row, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            {on && <span style={{ position: "absolute", left: 5, right: 5, top: "50%", height: Math.max(16, Math.min(20, rl.row)), transform: "translateY(-50%)", borderRadius: 99, background: "var(--accent)" }} />}
            {lab
              ? <span style={{ position: "relative", fontFamily: "var(--mono)", fontSize: on ? 10 : 10.5, fontWeight: on ? 700 : 600, letterSpacing: on ? "-.04em" : 0, color: on ? "var(--on-accent)" : "var(--text-2)" }}>{on && e.year != null ? e.year : yearShort(e.year)}</span>
              : <span style={{ width: 3, height: 3, borderRadius: 3, background: "var(--muted)" }} />}
          </div>
        );
      })}
      {shown != null && entries[shown] && (
        <YearBubble entry={entries[shown]} style={{ top: bubbleTop, ...(bubbleSide === "left" ? { right: "calc(100% + 10px)" } : { left: "calc(100% + 10px)" }) }} />
      )}
    </div>
  );
}
