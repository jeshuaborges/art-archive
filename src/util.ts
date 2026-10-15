import type { ImageKind, Summary } from "./types";

export const STATUS_COLOR: Record<string, string> = {
  in_studio: "#E3D3B4", on_show: "#A796FF", sold: "#FF8A4C", gifted: "#8FC79E",
  consigned: "#FFD678", on_loan: "#7FC8D9", lost: "#9A938A", unknown: "#6E685F",
};

export const KIND_META: Record<ImageKind, { label: string; plural: string; short: string; color: string; order: number }> = {
  reference: { label: "Reference", plural: "References", short: "REFERENCE", color: "#A9DDB5", order: 0 },
  study: { label: "Study", plural: "Studies", short: "STUDY", color: "#C9BEFF", order: 1 },
  progress: { label: "Progress", plural: "Progress", short: "PROGRESS", color: "#FFD678", order: 2 },
  work: { label: "Finished", plural: "Finished", short: "FINISHED", color: "#FF9A5C", order: 3 },
};

export const SWATCHES: [string, string][] = [
  ["#E9505F", "Red"], ["#F7894A", "Orange"], ["#F2C14E", "Gold"], ["#8FA548", "Green"],
  ["#4F9DA6", "Teal"], ["#3E5BA9", "Blue"], ["#8E6AA8", "Purple"], ["#C08497", "Rose"],
];

export function hexToHsl(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 0 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s: d / (1 - Math.abs(2 * l - 1)), l };
}
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function paletteHas(palette: string[], swatch: string) {
  const t = hexToHsl(swatch);
  return palette.some((c) => { const x = hexToHsl(c); return x.s > 0.2 && x.l > 0.1 && x.l < 0.92 && hueDist(x.h, t.h) < 26; });
}

export const decadeOf = (y: number | null) => (y == null ? null : Math.floor(y / 10) * 10);

export function yearLabel(a: Pick<Summary, "yearStart" | "yearEnd" | "circa">) {
  if (a.yearStart == null) return "Undated";
  const base = a.yearEnd && a.yearEnd !== a.yearStart ? `${a.yearStart}–${a.yearEnd}` : String(a.yearStart);
  return a.circa ? `c. ${base}` : base;
}

/** Frame treatment by medium, echoing how the work would hang. */
export function frameStyle(medium: unknown): React.CSSProperties {
  const m = String(medium || "").toLowerCase();
  if (m === "oil" || m === "acrylic") return { padding: 8, background: "#2B231D", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08), 0 30px 64px rgba(0,0,0,.6)" };
  if (m === "print" || m === "serigraph") return { padding: 8, background: "#F3EEE5", border: "3px solid #161412", boxShadow: "0 30px 64px rgba(0,0,0,.6)" };
  return { padding: 11, background: "#F3EEE5", boxShadow: "0 30px 64px rgba(0,0,0,.6)" };
}

export function vibrate(p: number | number[]) {
  try { navigator.vibrate?.(p); } catch { /* not supported */ }
}

export function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const pct = (m: number) => `${Math.round(m * 100)}%`;

export function mediumOf(a: { attrs: Record<string, unknown> }) { return (a.attrs.medium as string) || ""; }
