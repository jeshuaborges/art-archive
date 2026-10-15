import { useRef, useState } from "react";
import { IClose, ISearch, ISpark, ITimeline, IWall } from "./Icons";
import { vibrate } from "../util";

const SUGGEST = ["warm sunsets over water", "bold graphic shapes", "music and crowds", "golden rolling hills"];

interface Props {
  view: "timeline" | "wall";
  onView: (v: "timeline" | "wall") => void;
  q: string;
  onQ: (q: string) => void;
  searching: boolean;
  filterCount: number;
  onOpenFilters: () => void;
}

/** One row: Timeline/Wall toggle · expanding search · filters. */
export function TopBar({ view, onView, q, onQ, searching, filterCount, onOpenFilters }: Props) {
  const [openState, setOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const open = openState || !!q.trim();
  const isWall = view === "wall";

  const openSearch = () => {
    if (!openState) { setOpen(true); vibrate(5); }
    try { input.current?.focus({ preventScroll: true }); } catch { input.current?.focus(); }
  };
  const close = () => {
    input.current?.blur();
    onQ(""); setOpen(false); setFocus(false); vibrate(5);
  };

  return (
    <>
      <div style={{ position: "absolute", left: 16, right: 16, top: "calc(16px + env(safe-area-inset-top))", height: 48, zIndex: 6 }} data-testid="topbar">
        {/* view toggle; folds to a single icon while searching */}
        <div role="tablist" aria-label="View" style={{
          position: "absolute", left: 0, top: 0, height: 48, width: open ? 48 : 178, borderRadius: 999, background: "var(--glass)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid var(--line)", overflow: "hidden",
          transition: "width .6s cubic-bezier(.3,1.18,.5,1)",
        }}>
          <div aria-hidden={open} {...(open ? { inert: "" } : {})} style={{ position: "absolute", left: 0, top: 0, width: 176, height: 46, opacity: open ? 0 : 1, transform: `scale(${open ? 0.6 : 1})`, transformOrigin: "0 50%", pointerEvents: open ? "none" : "auto", transition: "opacity .22s, transform .45s cubic-bezier(.3,1.2,.5,1)" }}>
            <div aria-hidden style={{ position: "absolute", top: 4, left: isWall ? 88 : 4, width: 84, height: 38, borderRadius: 999, background: "var(--text)", boxShadow: "0 4px 14px rgba(0,0,0,.3)", transition: "left .5s cubic-bezier(.3,1.35,.5,1)" }} />
            {(["timeline", "wall"] as const).map((v, i) => (
              <button key={v} role="tab" aria-selected={view === v} tabIndex={open ? -1 : 0} onClick={() => onView(v)}
                style={{ position: "absolute", left: 4 + i * 84, top: 4, width: 84, height: 38, border: 0, background: "transparent", borderRadius: 999,
                  color: view === v ? "#12110F" : "var(--muted)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "color .3s" }}>
                {v === "timeline" ? <ITimeline /> : <IWall />}{v === "timeline" ? "Timeline" : "Wall"}
              </button>
            ))}
          </div>
          <button aria-label={`Switch to ${isWall ? "Timeline" : "Wall"} view`} tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={() => { onView(isWall ? "timeline" : "wall"); vibrate(6); }}
            style={{ position: "absolute", left: 0, top: 0, width: 46, height: 46, border: 0, background: "transparent", display: "grid", placeItems: "center", color: "var(--text)",
              opacity: open ? 1 : 0, transform: `rotate(${isWall ? 180 : 0}deg) scale(${open ? 1 : 0.4})`, pointerEvents: open ? "auto" : "none", transition: "opacity .25s .12s, transform .5s cubic-bezier(.3,1.4,.5,1)" }}>
            {isWall ? <IWall size={18} /> : <ITimeline size={18} />}
          </button>
        </div>

        {/* expanding search */}
        <div style={{
          position: "absolute", top: 0, height: 48, left: open ? 56 : "calc(100% - 104px)", width: open ? "calc(100% - 112px)" : 48,
          borderRadius: 24, background: open ? "rgba(38,35,31,.95)" : "var(--glass)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          border: `1px solid ${focus ? "var(--lupine)" : open ? "rgba(255,255,255,.14)" : "var(--line)"}`,
          boxShadow: focus ? "0 0 0 4px rgba(167,150,255,.18), 0 16px 36px rgba(0,0,0,.45)" : "none", overflow: "hidden",
          transition: "left .6s cubic-bezier(.3,1.18,.5,1), width .6s cubic-bezier(.3,1.18,.5,1), border-color .3s, box-shadow .4s, background .3s",
        }}>
          <button className="press" aria-label="Search the archive" aria-expanded={open} onClick={openSearch}
            style={{ position: "absolute", left: 0, top: 0, width: 46, height: 46, border: 0, background: "transparent", display: "grid", placeItems: "center", color: focus ? "var(--lupine-soft)" : "var(--text)", transition: "color .3s" }}>
            {searching ? <span className="spinner" /> : <ISearch size={19} style={{ transform: `rotate(${open ? 360 : 0}deg)`, transition: "transform .6s cubic-bezier(.3,1.4,.5,1)" }} />}
          </button>
          <input ref={input} value={q} onChange={(e) => onQ(e.target.value)} onFocus={() => { setFocus(true); setOpen(true); }}
            onBlur={() => { setFocus(false); if (!q.trim()) setOpen(false); }}
            onKeyDown={(e) => { if (e.key === "Escape") close(); else if (e.key === "Enter") e.currentTarget.blur(); }}
            tabIndex={open ? 0 : -1} aria-hidden={!open} enterKeyHint="search" placeholder="Describe a painting…" aria-label="Search the archive by words or meaning"
            style={{ position: "absolute", left: 42, right: 44, top: 0, height: 46, padding: 0, border: 0, background: "transparent", fontSize: 16, outline: "none",
              color: "var(--text)", opacity: open ? 1 : 0, transform: `translateX(${open ? 0 : -14}px)`, pointerEvents: open ? "auto" : "none",
              transition: `opacity .3s ${open ? ".16s" : "0s"}, transform .5s ${open ? ".16s" : "0s"} cubic-bezier(.2,.9,.25,1)`, userSelect: "text" }} />
          <button aria-label="Clear and close search" tabIndex={open ? 0 : -1} aria-hidden={!open} onPointerDown={(e) => e.preventDefault()} onClick={close}
            style={{ position: "absolute", right: 7, top: 7, width: 32, height: 32, borderRadius: 99, border: 0, background: "#3A3631", display: "grid", placeItems: "center",
              color: "var(--text)", opacity: open ? 1 : 0, transform: `scale(${open ? 1 : 0.3}) rotate(${open ? 0 : -120}deg)`, pointerEvents: open ? "auto" : "none",
              transition: `opacity .25s ${open ? ".16s" : "0s"}, transform .5s ${open ? ".16s" : "0s"} cubic-bezier(.3,1.5,.5,1)` }}>
            <IClose />
          </button>
        </div>

        {/* filters */}
        <button className="press" onClick={onOpenFilters} aria-label={`Filters${filterCount ? `, ${filterCount} active` : ""}`}
          style={{ position: "absolute", right: 0, top: 0, width: 48, height: 48, borderRadius: 24, border: `1px solid ${filterCount ? "rgba(255,138,76,.55)" : "var(--line)"}`,
            background: filterCount ? "rgba(255,138,76,.16)" : "var(--glass)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            display: "grid", placeItems: "center", color: filterCount ? "var(--poppy-soft)" : "var(--text)", transition: "background .35s, border-color .35s, color .35s" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 17h16" opacity=".55" />
            <circle cx="9" cy="7" r="2.6" fill={filterCount ? "#3A2519" : "#1E1C19"} style={{ transform: `translateX(${filterCount ? 6 : 0}px)`, transition: "transform .55s cubic-bezier(.3,1.6,.5,1)" }} />
            <circle cx="15" cy="17" r="2.6" fill={filterCount ? "#3A2519" : "#1E1C19"} style={{ transform: `translateX(${filterCount ? -6 : 0}px)`, transition: "transform .55s .05s cubic-bezier(.3,1.6,.5,1)" }} />
          </svg>
          {filterCount > 0 && (
            <span className="popin" style={{ position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, padding: "0 5px", borderRadius: 99, background: "var(--poppy)", color: "#1A110A", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", border: "2px solid var(--bg)" }}>{filterCount}</span>
          )}
        </button>
      </div>

      {focus && !q.trim() && (
        <div className="dropin" role="dialog" aria-label="Search suggestions" style={{ position: "absolute", left: 16, right: 16, top: "calc(72px + env(safe-area-inset-top))", zIndex: 7, padding: 14, borderRadius: 18, background: "var(--surface-2)", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 24px 50px rgba(0,0,0,.55)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--lupine-soft)" }}><ISpark size={13} />Searches by meaning, not just titles</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {SUGGEST.map((t, i) => (
              <button key={t} className="chip chipin" style={{ height: 36, color: "var(--text)", animationDelay: `${60 + i * 50}ms`, fontWeight: 500 }}
                onPointerDown={(e) => e.preventDefault()} onClick={() => { onQ(t); input.current?.blur(); }}>{t}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
