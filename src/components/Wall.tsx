import { useMemo, useRef } from "react";
import type { Summary } from "../types";
import { decadeOf, mediumOf, pct, STATUS_COLOR, yearLabel } from "../util";
import { IStack } from "./Icons";

interface Props {
  list: Summary[];           // already filtered
  ranked: boolean;           // true when showing search results in relevance order
  matchOf?: (id: string) => number | undefined;
  onOpen: (id: string) => void;
}

type Section = { key: string; label: string; items: Summary[] };

export function Wall({ list, ranked, matchOf, onOpen }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
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
      <div ref={scroller} className="scroll viewR" data-testid="wall"
        style={{ position: "absolute", left: 0, right: 0, top: "calc(118px + env(safe-area-inset-top))", bottom: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
        <div style={{ position: "relative", padding: "4px 44px calc(130px + env(safe-area-inset-bottom)) 16px" }}>
          {sections.map((sec) => {
            const cols: Summary[][] = [[], []], hgt = [0, 0];
            for (const a of sec.items) {
              const asp = Math.max(0.6, Math.min(1.7, a.aspect || 1)), c = hgt[0] <= hgt[1] ? 0 : 1;
              cols[c].push(a); hgt[c] += 1 / asp + 0.38;
            }
            return (
              <section key={sec.key} data-dec={sec.key} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 900px" } as React.CSSProperties}>
                <h3 style={{ position: "sticky", top: 0, zIndex: 2, margin: "0 -44px 0 -16px", padding: "12px 44px 10px 16px", display: "flex", alignItems: "baseline", gap: 10, background: "rgba(16,15,14,.86)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
                  <span className="display" style={{ fontSize: 24, fontWeight: 700 }}>{sec.label}</span>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--muted)" }}>{sec.items.length} {sec.items.length === 1 ? "WORK" : "WORKS"}</span>
                </h3>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "6px 0 18px" }}>
                  {cols.map((col, ci) => (
                    <div key={ci} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
                      {col.map((a) => {
                        const m = matchOf?.(a.id);
                        const asp = Math.max(0.6, Math.min(1.7, a.aspect || 1));
                        return (
                          <button key={a.id} className="press tilein" onClick={() => onOpen(a.id)} aria-label={`Open ${a.title || "Untitled"}`} data-testid="wall-tile"
                            style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left", color: "var(--text)", animationDelay: `${Math.min(k++ * 40, 400)}ms` }}>
                            <div style={{ position: "relative", aspectRatio: String(asp), borderRadius: 14, overflow: "hidden", background: "#23201C", boxShadow: "0 10px 24px rgba(0,0,0,.35)" }}>
                              {a.thumb ? <img src={a.thumb} alt="" loading="lazy" draggable={false} className="art-img" /> : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, color: "var(--faint)" }}>No image yet</div>}
                              {ranked && m !== undefined && <span style={{ position: "absolute", left: 8, top: 8, height: 24, padding: "0 8px", display: "flex", alignItems: "center", borderRadius: 99, background: "rgba(42,37,71,.92)", color: "var(--lupine-soft)", fontSize: 11, fontWeight: 700 }}>{pct(m)}</span>}
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
        <nav className="viewR" aria-label="Jump to decade" style={{ position: "absolute", right: 4, top: "calc(150px + env(safe-area-inset-top))", zIndex: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0", borderRadius: 99, background: "rgba(30,28,25,.6)" }}>
          {sections.map((s) => (
            <button key={s.key} onClick={() => jump(s.key)} aria-label={`Jump to ${s.label}`}
              style={{ width: 34, height: 36, border: 0, background: "transparent", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>
              {s.key === "undated" ? "—" : `'${s.key.slice(2, 4)}`}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
