import { useRef } from "react";
import type { FieldDef, Filters, Summary } from "../types";
import { clamp, STATUS_COLOR, SWATCHES, vibrate } from "../util";
import { Sheet } from "./Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  fields: FieldDef[];
  items: Summary[];
  statuses: { value: string; label: string }[];
  filters: Filters;
  onChange: (f: Filters) => void;
  resultCount: number;
  bounds: [number, number];
}

export function FilterSheet({ open, onClose, fields, items, statuses, filters, onChange, resultCount, bounds }: Props) {
  // select fields offer their choices; filterable text fields offer the distinct values in use
  const filterable = fields.filter((f) => f.filterable && !f.archived && (f.type === "select" || f.type === "multi_select" || f.type === "text"));
  const choicesFor = (f: FieldDef) => {
    if (f.type !== "text") return f.options.choices || [];
    const counts = new Map<string, number>();
    items.forEach((a) => { const v = typeof a.attrs[f.key] === "string" ? (a.attrs[f.key] as string).trim() : ""; if (v) counts.set(v, (counts.get(v) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  };
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const countFor = (key: string, v: string) => items.filter((a) => {
    const val = a.attrs[key];
    return Array.isArray(val) ? val.includes(v) : typeof val === "string" ? val.trim() === v : val === v;
  }).length;
  const usedStatuses = statuses.filter((s) => items.some((a) => a.status === s.value) || filters.status.includes(s.value));
  const [y0, y1] = filters.years || bounds;

  return (
    <Sheet open={open} onClose={onClose} label="Filters" testId="filter-sheet" maxHeight="90%"
      header={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 className="display" style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Filters</h2>
          <button className="press" onClick={() => { onChange({ values: {}, status: [], color: null, years: null }); vibrate(6); }}
            style={{ height: 40, padding: "0 14px", borderRadius: 999, border: 0, background: "transparent", color: "#FF9A5C", fontSize: 14, fontWeight: 600 }}>Reset</button>
        </div>
      }
      footer={
        <div style={{ flex: "none", padding: "12px 20px calc(16px + env(safe-area-inset-bottom))", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <button className="btn btn-light press" style={{ width: "100%" }} onClick={onClose} data-testid="show-results">
            {resultCount ? `Show ${resultCount} ${resultCount === 1 ? "work" : "works"}` : "No matches — loosen a filter"}
          </button>
        </div>
      }>
      <div style={{ padding: "6px 20px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
        {filterable.map((f) => {
          const sel = filters.values[f.key] || [];
          const choices = choicesFor(f).filter((c) => countFor(f.key, c) > 0 || sel.includes(c));
          if (!choices.length) return null;
          return (
            <div key={f.key}>
              <div className="lbl">{f.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {choices.map((c) => (
                  <button key={c} className="chip press" aria-pressed={sel.includes(c)}
                    onClick={() => onChange({ ...filters, values: { ...filters.values, [f.key]: toggle(sel, c) } })}>
                    {c}<span className="n">{countFor(f.key, c)}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div>
          <div className="lbl">Where it is</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {usedStatuses.map((s) => (
              <button key={s.value} className="chip press" aria-pressed={filters.status.includes(s.value)} onClick={() => onChange({ ...filters, status: toggle(filters.status, s.value) })}>
                <span className="dot" style={{ background: STATUS_COLOR[s.value] }} />{s.label}<span className="n">{items.filter((a) => a.status === s.value).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="lbl">Color</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {SWATCHES.map(([c, name]) => {
              const on = filters.color === c;
              return (
                <button key={c} className="press" aria-pressed={on} aria-label={name} onClick={() => onChange({ ...filters, color: on ? null : c })}
                  style={{ width: 36, height: 36, borderRadius: 99, border: 0, padding: 0, background: c, transform: `scale(${on ? 1.12 : 1})`,
                    boxShadow: on ? `0 0 0 3px var(--surface),0 0 0 5px ${c}` : "inset 0 0 0 1px rgba(255,255,255,.12)", transition: "transform .3s cubic-bezier(.3,1.5,.5,1), box-shadow .25s" }} />
              );
            })}
          </div>
        </div>
        <YearRange bounds={bounds} value={[y0, y1]} onChange={(v) => onChange({ ...filters, years: v[0] === bounds[0] && v[1] === bounds[1] ? null : v })} />
      </div>
    </Sheet>
  );
}

function YearRange({ bounds, value, onChange }: { bounds: [number, number]; value: [number, number]; onChange: (v: [number, number]) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const which = useRef<0 | 1 | null>(null);
  const span = Math.max(1, bounds[1] - bounds[0]);
  const pos = (y: number) => ((clamp(y, bounds[0], bounds[1]) - bounds[0]) / span) * 100;
  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(bounds[0] + clamp((clientX - r.left) / r.width, 0, 1) * span);
  };
  const set = (w: 0 | 1, y: number) => {
    const v: [number, number] = [...value] as [number, number];
    if (w === 0) v[0] = Math.min(y, v[1]); else v[1] = Math.max(y, v[0]);
    if (v[0] !== value[0] || v[1] !== value[1]) onChange(v);
  };
  const thumb = (w: 0 | 1) => (
    <div role="slider" tabIndex={0} aria-label={w === 0 ? "From year" : "To year"} aria-valuemin={bounds[0]} aria-valuemax={bounds[1]} aria-valuenow={value[w]}
      data-testid={w === 0 ? "year-from" : "year-to"}
      onPointerDown={(e) => { which.current = w; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } }}
      onPointerMove={(e) => { if (which.current === w) set(w, fromX(e.clientX)); }}
      onPointerUp={() => (which.current = null)} onPointerCancel={() => (which.current = null)}
      onKeyDown={(e) => { const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0; if (d) { e.preventDefault(); set(w, value[w] + d); } }}
      style={{ position: "absolute", top: 0, left: `${pos(value[w])}%`, width: 44, height: 44, marginLeft: -22, display: "grid", placeItems: "center", touchAction: "none", cursor: "grab", zIndex: w === 0 && value[0] === bounds[1] ? 2 : 1 }}>
      <span style={{ width: 24, height: 24, borderRadius: 99, background: "var(--text)", boxShadow: "0 3px 10px rgba(0,0,0,.5)" }} />
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="lbl">Years</div>
        <div className="display" style={{ fontSize: 18, fontWeight: 700 }} data-testid="year-label">{value[0]} – {value[1]}</div>
      </div>
      <div ref={track} style={{ position: "relative", height: 44, margin: "10px 12px 0" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 20, height: 4, borderRadius: 9, background: "#34312C" }} />
        <div style={{ position: "absolute", top: 20, height: 4, borderRadius: 9, background: "var(--poppy)", left: `${pos(value[0])}%`, width: `${pos(value[1]) - pos(value[0])}%` }} />
        {thumb(0)}{thumb(1)}
      </div>
    </div>
  );
}
