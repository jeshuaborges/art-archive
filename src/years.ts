/**
 * Year navigation as pure functions (the functional core): grouping pieces by
 * year, the density ruler's bars and slots, the side rail's rows and labels,
 * and the carousel's centring. Components measure and handle pointers; these
 * decide what to draw and which year a position means.
 *
 * Every piece belongs to the year it was started (`yearStart`), so a "c. 2012"
 * piece and a 2012–2014 piece both sit under 2012. Pieces with no year form
 * one "undated" group, always last: the dated run reads as an unbroken
 * chronology, and the undated pile (a third of the archive) is the least
 * informative place to land.
 */

export type YearKey = number | "undated";

export interface YearGroup {
  key: YearKey;
  /** The year, or null for the undated group. */
  year: number | null;
  /** Index of the group's first piece in the list it was built from. */
  first: number;
  count: number;
}

type Dated = { yearStart: number | null };

export const yearKeyOf = (y: number | null | undefined): YearKey =>
  y == null || !Number.isFinite(y) ? "undated" : y;

/**
 * Groups a list by year, in the order the years first appear. For a list
 * sorted by year (as the timeline's and the wall's are) the groups are
 * contiguous runs and `first` is where each run starts.
 */
export function groupYears(list: readonly Dated[]): YearGroup[] {
  const out: YearGroup[] = [];
  const at = new Map<YearKey, YearGroup>();
  list.forEach((a, i) => {
    const key = yearKeyOf(a.yearStart);
    const g = at.get(key);
    if (g) { g.count++; return; }
    const ng: YearGroup = { key, year: key === "undated" ? null : key, first: i, count: 1 };
    at.set(key, ng);
    out.push(ng);
  });
  return out;
}

/** Oldest first, undated last; ties by catalog number. The timeline's order. */
export function sortOldestFirst<T extends Dated & { catalogId: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.yearStart ?? Infinity) - (b.yearStart ?? Infinity) || a.catalogId.localeCompare(b.catalogId));
}

/** Newest first, undated last. The wall's order; otherwise keeps the list's order. */
export function sortNewestFirst<T extends Dated>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (b.yearStart ?? -Infinity) - (a.yearStart ?? -Infinity));
}

/**
 * Which group holds the piece at `index`, for groups of a sorted list
 * (contiguous runs): the last group starting at or before it.
 */
export function groupAt(groups: readonly YearGroup[], index: number): number {
  let lo = 0, hi = groups.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid].first <= index) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Where the timeline opens: the newest dated piece, not the end of the undated pile. */
export function defaultTimelineIndex(sorted: readonly Dated[]): number {
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].yearStart != null) return i;
  return Math.max(0, sorted.length - 1);
}

export const yearFull = (year: number | null) => (year == null ? "Undated" : String(year));
/** Two-digit label for tight spaces: '06, '79. Undated is a dash, as on the filmstrip. */
export const yearShort = (year: number | null) => (year == null ? "—" : `'${String(year).slice(-2)}`);
export const worksLabel = (n: number) => `${n} ${n === 1 ? "work" : "works"}`;

// ------------------------------------------------------------------ density ruler

/**
 * Bar heights for the density ruler: area-honest square-root scaling, so a
 * year with one piece still shows next to a year with a hundred. Dated years
 * are scaled against the busiest dated year; the undated pile (often bigger
 * than any year) is capped at the full height rather than flattening the rest.
 */
export function barHeights(groups: readonly Pick<YearGroup, "count" | "year">[], minH: number, maxH: number): number[] {
  const peak = Math.max(1, ...groups.filter((g) => g.year != null).map((g) => g.count));
  return groups.map((g) => {
    if (g.count <= 0) return 0;
    const f = Math.min(1, Math.sqrt(g.count / peak));
    return Math.round((minH + (maxH - minH) * f) * 10) / 10;
  });
}

export interface Slot { x: number; w: number; gapBefore: boolean }

/**
 * For each year in a run, whether time was skipped just before it: a missing
 * year (1979 → 2006, or 2026 → 2024 going newest first) or the step to or from
 * the undated group.
 */
export function yearBreaks(years: readonly (number | null)[]): boolean[] {
  return years.map((y, i) => {
    if (i === 0) return false;
    const p = years[i - 1];
    return y == null || p == null || Math.abs(y - p) > 1;
  });
}

/**
 * Horizontal slots for one bar per year across `width`. A break in the years
 * (1979 → 2006) or the step to the undated group leaves a gap of `gap` slot
 * widths, so the ruler shows that time was skipped without spending a slot on
 * every empty year.
 */
export function rulerSlots(years: readonly (number | null)[], width: number, gap = 0.7): Slot[] {
  const breaks = yearBreaks(years);
  const units = years.length + breaks.filter(Boolean).length * gap;
  const w = units > 0 ? width / units : 0;
  let x = 0;
  return years.map((_, i) => {
    if (breaks[i]) x += gap * w;
    const s = { x, w, gapBefore: breaks[i] };
    x += w;
    return s;
  });
}

/** The slot under (or nearest to) x. */
export function slotAt(x: number, slots: readonly Slot[]): number {
  if (!slots.length) return 0;
  let best = 0, bd = Infinity;
  slots.forEach((s, i) => {
    const d = x < s.x ? s.x - x : x > s.x + s.w ? x - s.x - s.w : 0;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/**
 * Which slots get a year under the axis. The first year, the undated group and
 * the last year first, then the year after a break, then every fifth year,
 * keeping only labels at least `minGap` px apart (centre to centre) from those
 * already placed.
 */
export function axisLabels(years: readonly (number | null)[], slots: readonly Slot[], minGap: number): number[] {
  const n = years.length;
  if (!n) return [];
  const lastDated = years.map((y, i) => (y == null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
  const order: number[] = [];
  const push = (i: number) => { if (i >= 0 && i < n && !order.includes(i)) order.push(i); };
  push(0); push(years.indexOf(null)); push(lastDated);
  years.forEach((y, i) => { if (i > 0 && years[i - 1] != null && y != null && y - (years[i - 1] as number) > 1) push(i); }); // after a break
  years.forEach((y, i) => { if (y != null && y % 5 === 0) push(i); });
  const cx = (i: number) => slots[i].x + slots[i].w / 2;
  const kept: number[] = [];
  for (const i of order) if (kept.every((k) => Math.abs(cx(k) - cx(i)) >= minGap)) kept.push(i);
  return kept.sort((a, b) => a - b);
}

/** Centre of the floating year label, kept inside the ruler. */
export function clampLabel(center: number, labelW: number, width: number): number {
  const half = labelW / 2;
  if (width <= labelW) return width / 2;
  return Math.max(half, Math.min(width - half, center));
}

// ------------------------------------------------------------------ side rail

export interface RailLayout {
  /** Height of one year's row. */
  row: number;
  /** Space above the first row (the rows are centred in the rail). */
  offset: number;
  /** Label every `step`th row; the rows between get a dot. */
  step: number;
}

/**
 * Rows for a vertical year index `height` px tall: as tall as fits up to
 * `maxRow`, centred. When rows are shorter than `labelMin` the labels thin out
 * to every second (third…) row so they stay legible.
 */
export function railLayout(n: number, height: number, opts: { maxRow?: number; labelMin?: number } = {}): RailLayout {
  const maxRow = opts.maxRow ?? 22, labelMin = opts.labelMin ?? 17;
  if (n <= 0 || height <= 0) return { row: 0, offset: 0, step: 1 };
  const row = Math.min(maxRow, height / n);
  return { row, offset: (height - row * n) / 2, step: Math.max(1, Math.ceil(labelMin / row)) };
}

/** The row at y (px from the top of the rail), clamped to the ends. */
export function railIndexAt(y: number, rl: RailLayout, n: number): number {
  if (n <= 0 || rl.row <= 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor((y - rl.offset) / rl.row)));
}

/**
 * Does row i show its label (otherwise a dot)? Every `step`th row from the top
 * and the last row (the undated group) always; a thinned row right before the
 * last gives way to it; the active row always shows, and when rows are thinned
 * its neighbours give way to its (wider, full-year) label.
 */
export function railLabelShown(i: number, n: number, step: number, active: number): boolean {
  if (i === active || i === n - 1) return true;
  if (step <= 1) return true;
  if (Math.abs(i - active) === 1) return false;
  return i % step === 0 && n - 1 - i >= step;
}

// ------------------------------------------------------------------ keys

/**
 * The year a key moves to from `active` of `n`: arrows step one (left/up back,
 * right/down on), Page keys five, Home/End to the ends. Null for other keys.
 */
export function stepYear(key: string, active: number, n: number): number | null {
  if (n <= 0) return null;
  const to = (i: number) => Math.max(0, Math.min(n - 1, i));
  switch (key) {
    case "ArrowLeft": case "ArrowUp": return to(active - 1);
    case "ArrowRight": case "ArrowDown": return to(active + 1);
    case "PageUp": return to(active - 5);
    case "PageDown": return to(active + 5);
    case "Home": return 0;
    case "End": return n - 1;
    default: return null;
  }
}
