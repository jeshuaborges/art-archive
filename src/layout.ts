/**
 * Layout decisions as pure functions of measured sizes (the functional core).
 * Components measure (window size, ResizeObserver boxes) and ask these what to
 * draw; nothing here touches the DOM.
 */

/** A window wider than this and wider than tall gets the landscape layout. */
export const LANDSCAPE_MIN_W = 560;
/** A landscape window this short or shorter is a phone on its side: compact chrome. */
export const COMPACT_MAX_H = 500;

export interface Layout {
  /** Side-by-side layout: art on one side, details on the other. */
  landscape: boolean;
  /** Short landscape (a phone on its side): smaller chrome, more room for art. */
  compact: boolean;
  w: number;
  h: number;
  /** Width of the side panel (timeline label, top-bar cluster) in landscape; 0 in portrait. */
  panel: number;
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Portrait keeps the phone column (≤ 520px wide, centered); a window wider than
 * it is tall, and at least LANDSCAPE_MIN_W wide, uses the whole width.
 * Mirrors the CSS rule keyed off `.app[data-layout="landscape"]`.
 */
export function layoutFor(w: number, h: number): Layout {
  const landscape = w > h && w >= LANDSCAPE_MIN_W;
  const compact = landscape && h <= COMPACT_MAX_H;
  return { landscape, compact, w, h, panel: landscape ? panelWidth(w) : 0 };
}

/** The timeline's label panel (and the top-bar cluster above it) in landscape. */
export function panelWidth(w: number): number {
  return Math.round(clampN(w * 0.36, 300, 420));
}

/** Vertical positions of the landscape chrome (px below the top safe area). */
export function landscapeChrome(compact: boolean): { barTop: number; chipsTop: number; panelTop: number } {
  return compact ? { barTop: 10, chipsTop: 62, panelTop: 100 } : { barTop: 20, chipsTop: 76, panelTop: 124 };
}

const okAspect = (a: number | null | undefined) => (a && Number.isFinite(a) && a > 0 ? a : 1);

/** The largest size of an image with this aspect that fits inside maxW × maxH. */
export function fitArt(maxW: number, maxH: number, aspect: number | null | undefined): { w: number; h: number } {
  const a = okAspect(aspect);
  const W = Math.max(1, maxW), H = Math.max(1, maxH);
  let w = Math.min(W, H * a), h = w / a;
  if (h > H) { h = H; w = h * a; }
  return { w, h };
}

/**
 * The box the timeline's hero artwork must fit in, from the hero area's size.
 * Portrait keeps the original sizing: at most 320 wide (32px side margins),
 * never taller than it is wide, and clear of the year above it. Landscape lets
 * the painting fill its side of the screen.
 */
export function heroBox(landscape: boolean, cw: number, ch: number): { w: number; h: number } {
  if (landscape) {
    // frame padding (~11px a side) plus a little air for the shadow
    return { w: Math.max(80, cw - 40), h: Math.max(80, ch - 30) };
  }
  const w = Math.min(320, cw - 64);
  const h = Math.max(160, ch - 24) - 30;
  return { w, h: Math.min(w, h) };
}

/** Geometry of the scrubbable filmstrip. Portrait values are the original ones. */
export interface StripSpec {
  sp: number;      // px between thumbnails
  thumb: number;   // thumbnail size
  top: number;     // thumbnail top
  label: number;   // year label top
  tick: number;    // tick ruler top
  tickH: number;
  head: number;    // playhead height
  height: number;  // whole strip
  lift: number;    // how far the current thumb rises
  grow: number;    // how much the current thumb grows
}

export function stripSpec(compact: boolean): StripSpec {
  return compact
    ? { sp: 62, thumb: 46, top: 13, label: 67, tick: 81, tickH: 7, head: 89, height: 92, lift: 5, grow: 0.3 }
    : { sp: 78, thumb: 60, top: 16, label: 84, tick: 100, tickH: 9, head: 112, height: 124, lift: 8, grow: 0.32 };
}

/**
 * Wall columns for a content width: two on a phone held upright; in landscape,
 * as many as fit at a comfortable tile width (3–6).
 */
export function wallColumns(contentW: number, layout: Pick<Layout, "landscape" | "compact">): number {
  if (!layout.landscape) return 2;
  const minCol = layout.compact ? 180 : 220, gap = 14;
  return clampN(Math.floor((contentW + gap) / (minCol + gap)), 3, 6);
}

/**
 * Masonry: each tile goes to the currently shortest column (leftmost on a tie).
 * Returns item indices per column. Tile height is 1/aspect (aspect clamped to
 * 0.6–1.7, as drawn) plus room for the caption.
 */
export function masonry(aspects: (number | null | undefined)[], cols: number): number[][] {
  const n = Math.max(1, Math.floor(cols));
  const out: number[][] = Array.from({ length: n }, () => []);
  const hgt = new Array<number>(n).fill(0);
  aspects.forEach((raw, i) => {
    const asp = clampN(raw || 1, 0.6, 1.7);
    let c = 0;
    for (let k = 1; k < n; k++) if (hgt[k] < hgt[c]) c = k;
    out[c].push(i);
    hgt[c] += 1 / asp + 0.38;
  });
  return out;
}

/** Piece view in landscape: width of the image pane (the details pane gets the rest, ≤ 520). */
export function pieceSplit(w: number): number {
  return Math.round(Math.max(w * 0.54, w - 520));
}

/** The box a piece-view slide must fit in. Portrait keeps the original 320 × 290. */
export function slideBox(landscape: boolean, cw: number, ch: number): { w: number; h: number } {
  if (!landscape) return { w: 320, h: 290 };
  return { w: Math.max(120, cw - 56), h: Math.max(120, ch - 40) };
}


/**
 * How much of the layout viewport the on-screen keyboard covers at the bottom.
 * iOS overlays the keyboard rather than shrinking the page, so it shows only as
 * a shorter (and possibly scrolled) visual viewport. Pinch-zoom also shrinks
 * the visual viewport, so a zoomed page reports no keyboard.
 */
export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number; scale?: number }): number {
  if (vv.scale != null && Math.abs(vv.scale - 1) > 0.01) return 0;
  const inset = Math.round(innerHeight - vv.height - vv.offsetTop);
  return inset > 0 ? inset : 0;
}

/**
 * How far to scroll a container so a focused field sits inside the visible
 * band (the part of the container above the keyboard), with a margin. Positive
 * scrolls down. A field taller than the band is aligned to its top.
 */
export function revealDelta(field: { top: number; bottom: number }, band: { top: number; bottom: number }, margin = 16): number {
  const top = band.top + margin, bottom = band.bottom - margin;
  if (field.bottom - field.top > bottom - top) return Math.round(field.top - top);
  if (field.bottom > bottom) return Math.round(field.bottom - bottom);
  if (field.top < top) return Math.round(field.top - top);
  return 0;
}
