import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Summary } from "../types";
import { clamp, decadeOf, frameStyle, mediumOf, pct, STATUS_COLOR, vibrate, yearLabel } from "../util";
import { PreviewTile } from "./PreviewTile";
import { ArchivedBadge } from "./Wall";

const SP = 78; // px between thumbnails on the strip
const WINDOW = 14;

interface Props {
  list: Summary[];
  index: number;
  onIndex: (i: number) => void;
  onOpen: (id: string) => void;
  matchOf?: (id: string) => number | undefined;
  statusLabel: (s: string) => string;
}

export function Timeline({ list, index, onIndex, onOpen, matchOf, statusLabel }: Props) {
  const n = list.length;
  const [drag, setDrag] = useState<number | null>(null); // live offset while dragging
  const offset = drag ?? index * SP;
  const cur = clamp(Math.round(offset / SP), 0, Math.max(0, n - 1));
  const item = list[cur];
  const stripRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroBox, setHeroBox] = useState({ w: 300, h: 280 });
  const [stripW, setStripW] = useState(390);
  const g = useRef({ sx: 0, start: 0, lt: 0, lx: 0, v: 0, moved: false, sc: 1, left: 0, last: -1 });
  const h = useRef<{ x: number; y: number; sc: number } | null>(null);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      if (heroRef.current) setHeroBox({ w: Math.min(320, heroRef.current.clientWidth - 64), h: Math.max(160, heroRef.current.clientHeight - 24) });
      if (stripRef.current) setStripW(stripRef.current.clientWidth);
    });
    if (heroRef.current) ro.observe(heroRef.current);
    if (stripRef.current) ro.observe(stripRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { if (index > n - 1 && n) onIndex(n - 1); }, [index, n, onIndex]);

  const cx = stripW / 2;
  const decades = useMemo(() => {
    const out: { key: string; label: string; first: number }[] = [];
    list.forEach((a, i) => {
      const d = decadeOf(a.yearStart);
      const key = d == null ? "undated" : String(d);
      if (!out.some((x) => x.key === key)) out.push({ key, label: d == null ? "Undated" : `'${String(d).slice(2)}s`, first: i });
    });
    return out;
  }, [list]);
  const curDecade = item ? (decadeOf(item.yearStart) == null ? "undated" : String(decadeOf(item.yearStart))) : "";

  const scaleOf = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { sc: r.width / el.offsetWidth || 1, left: r.left }; };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { sc, left } = scaleOf(e.currentTarget);
    g.current = { sx: e.clientX, start: index * SP, lt: performance.now(), lx: e.clientX, v: 0, moved: false, sc, left, last: index };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    setDrag(index * SP);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const s = g.current, dx = (e.clientX - s.sx) / s.sc;
    if (Math.abs(dx) > 6) s.moved = true;
    const t = performance.now();
    s.v = 0.75 * s.v + 0.25 * (((e.clientX - s.lx) / s.sc) / Math.max(1, t - s.lt));
    s.lt = t; s.lx = e.clientX;
    const maxO = (n - 1) * SP;
    let o = s.start - dx;
    if (o < 0) o *= 0.35;
    if (o > maxO) o = maxO + (o - maxO) * 0.35;
    const i = clamp(Math.round(o / SP), 0, n - 1);
    if (i !== s.last) { s.last = i; vibrate(3); }
    setDrag(o);
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag === null) return;
    const s = g.current;
    let i: number;
    if (!s.moved) i = clamp(Math.round(((e.clientX - s.left) / s.sc - cx + s.start) / SP), 0, n - 1);
    else i = clamp(Math.round((drag - s.v * 240) / SP), 0, n - 1);
    setDrag(null);
    onIndex(i);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); onIndex(clamp(index + 1, 0, n - 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onIndex(clamp(index - 1, 0, n - 1)); }
    else if (e.key === "Home") onIndex(0);
    else if (e.key === "End") onIndex(n - 1);
    else if (e.key === "Enter" && item) onOpen(item.id);
  };

  const heroDown = (e: React.PointerEvent) => { const { sc } = scaleOf(e.currentTarget as HTMLElement); h.current = { x: e.clientX, y: e.clientY, sc }; };
  const heroUp = (e: React.PointerEvent) => {
    if (!h.current) return;
    const dx = (e.clientX - h.current.x) / h.current.sc, dy = (e.clientY - h.current.y) / h.current.sc;
    h.current = null;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { if (item) onOpen(item.id); return; }
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) onIndex(clamp(cur + (dx < 0 ? 1 : -1), 0, n - 1));
  };

  if (!item) return null;
  const lo = Math.max(0, cur - 2), hi = Math.min(n - 1, cur + 2);
  const years: { label: string; dir: number }[] = [];
  for (let i = Math.max(0, cur - 3); i <= Math.min(n - 1, cur + 3); i++) {
    const label = list[i].yearStart == null ? "—" : String(list[i].yearStart);
    if (!years.some((y) => y.label === label)) years.push({ label, dir: i < cur ? -1 : i > cur ? 1 : 0 });
  }
  const curYear = item.yearStart == null ? "—" : String(item.yearStart);
  const match = matchOf?.(item.id);
  const trackX = cx - 30 - offset;
  const tlo = Math.max(0, Math.floor(offset / SP) - WINDOW), thi = Math.min(n - 1, Math.ceil(offset / SP) + WINDOW);

  return (
    <div className="viewL" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", paddingTop: "calc(118px + env(safe-area-inset-top))", paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }} data-testid="timeline">
      <div ref={heroRef} style={{ position: "relative", flex: 1, minHeight: 200 }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: -6, height: 150, overflow: "hidden", pointerEvents: "none" }}>
          {years.map((y) => {
            const on = y.label === curYear;
            const dir = on ? 0 : (y.label < curYear ? -1 : 1);
            return (
              <div key={y.label} style={{ position: "absolute", left: 0, right: 0, top: 0, textAlign: "center", fontFamily: "var(--display)", fontSize: "min(140px, 36vw)", lineHeight: 1, fontWeight: 800, letterSpacing: "-.05em", color: "transparent", WebkitTextStroke: "1.5px rgba(243,239,232,.24)", opacity: on ? 1 : 0, transform: `translateY(${dir * 34}px)`, transition: "opacity .55s, transform .7s var(--ease-out)" }}>{y.label}</div>
            );
          })}
        </div>
        <div onPointerDown={heroDown} onPointerUp={heroUp} onPointerCancel={() => (h.current = null)} data-testid="hero"
          style={{ position: "absolute", inset: "28px 0 0", touchAction: "pan-y", cursor: "pointer" }}>
          {list.slice(lo, hi + 1).map((a, j) => {
            const i = lo + j, dir = i < cur ? -1 : i > cur ? 1 : 0;
            const asp = a.aspect || 1;
            let w = Math.min(heroBox.w, heroBox.w * asp), hh = w / asp;
            if (hh > heroBox.h - 30) { hh = heroBox.h - 30; w = hh * asp; }
            return (
              <div key={a.id} className={dir === 0 ? "heroin" : ""} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: dir === 0 ? 1 : 0, transform: `translateX(${dir * 60}px) scale(${dir === 0 ? 1 : 0.92})`, transition: "opacity .5s, transform .7s var(--ease-out)", pointerEvents: "none" }}>
                <div style={frameStyle(mediumOf(a))}>
                  {a.display ? <img src={a.display} alt={dir === 0 ? a.title || "Untitled" : ""} draggable={false} style={{ width: Math.round(w), height: Math.round(hh), objectFit: "cover", background: "#23201C" }} />
                    : <div style={{ position: "relative", width: Math.round(w), height: Math.round(hh) }}><PreviewTile state={a.preview} /></div>}
                </div>
              </div>
            );
          })}
          {item.archivedAt && <ArchivedBadge style={{ left: 28, right: "auto", top: 0, height: 28, fontSize: 10.5 }} />}
          {match !== undefined && <span className="popin" style={{ position: "absolute", right: 28, top: 0, height: 28, padding: "0 10px", display: "flex", alignItems: "center", borderRadius: 99, background: "var(--lupine-deep)", color: "var(--lupine-soft)", fontSize: 12, fontWeight: 700 }}>{pct(match)} match</span>}
        </div>
      </div>

      <button onClick={() => onOpen(item.id)} key={item.id} className="fadein" data-testid="hero-title"
        style={{ margin: "12px 24px 0", padding: 0, border: 0, background: "transparent", textAlign: "center", color: "var(--text)", minHeight: 72 }}>
        <span className="clamp2 display" style={{ fontSize: 23, lineHeight: 1.1, fontWeight: 700 }}>{item.title || "Untitled"}</span>
        <span style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 7, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".1em", color: "var(--muted)", textTransform: "uppercase" }}>
          <span>{yearLabel(item)}</span>·<span>{mediumOf(item) || "Medium?"}</span>·
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 9, background: STATUS_COLOR[item.status] }} />{statusLabel(item.status)}</span>
        </span>
      </button>

      <nav aria-label="Jump to decade" className="scroll" style={{ marginTop: 12, overflowX: "auto", flex: "none" }}>
        <div style={{ display: "flex", gap: 6, padding: "0 16px", width: "max-content", margin: "0 auto" }}>
          {decades.map((d) => (
            <button key={d.key} className="chip press" aria-pressed={d.key === curDecade} onClick={() => { onIndex(d.first); vibrate(5); }}
              style={{ height: 34, minWidth: 50, padding: "0 10px", fontFamily: "var(--mono)", fontSize: 12, justifyContent: "center" }}>{d.label}</button>
          ))}
        </div>
      </nav>

      <div ref={stripRef} role="slider" tabIndex={0} aria-label="Scrub through the years" aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={cur}
        aria-valuetext={`${item.title || "Untitled"}, ${yearLabel(item)}`} onKeyDown={onKey} data-testid="strip"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
        style={{ position: "relative", height: 124, marginTop: 10, flex: "none", touchAction: "none", cursor: drag !== null ? "grabbing" : "grab", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 100, height: 9, background: "repeating-linear-gradient(90deg,rgba(243,239,232,.2) 0 1px,transparent 1px 19.5px)", backgroundPosition: `${trackX + 30}px 0`, transition: drag !== null ? "none" : "background-position .6s var(--ease-out)" }} />
        <div aria-hidden style={{ position: "absolute", left: cx - 1, top: 0, width: 2, height: 112, borderRadius: 2, background: "var(--poppy)", boxShadow: "0 0 14px rgba(255,138,76,.7)" }} />
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", transform: `translateX(${trackX}px)`, transition: drag !== null ? "none" : "transform .6s var(--ease-out)" }}>
          {list.slice(tlo, thi + 1).map((a, j) => {
            const i = tlo + j, d = Math.abs(i * SP - offset) / SP, near = Math.max(0, 1 - d), on = i === cur;
            return (
              <div key={a.id}>
                <button tabIndex={-1} aria-label={`${a.title || "Untitled"}, ${yearLabel(a)}`} onClick={() => onIndex(i)}
                  style={{ position: "absolute", top: 16, left: i * SP, width: 60, height: 60, padding: 0, border: 0, borderRadius: 14, overflow: "hidden", background: "#23201C",
                    transform: `translateY(${-near * 8}px) scale(${1 + near * 0.32 - Math.min(d, 3) * 0.04})`, opacity: 1 - Math.min(d, 4) * 0.16,
                    boxShadow: on ? "0 12px 26px rgba(0,0,0,.55),0 0 0 2px #F3EFE8" : "0 4px 10px rgba(0,0,0,.35)",
                    transition: drag !== null ? "none" : "transform .45s var(--ease-out), opacity .3s, box-shadow .3s" }}>
                  {a.thumb ? <img src={a.thumb} alt="" draggable={false} loading="lazy" className="art-img" /> : <PreviewTile state={a.preview} compact />}
                </button>
                <span aria-hidden style={{ position: "absolute", top: 84, left: i * SP, width: 60, textAlign: "center", fontFamily: "var(--mono)", fontSize: 10, color: on ? "var(--text)" : "#6E685F" }}>{a.yearStart ?? "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
