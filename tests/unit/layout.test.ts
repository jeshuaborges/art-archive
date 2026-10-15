import { describe, expect, it } from "vitest";
import {
  fitArt, heroBox, keyboardInset, landscapeChrome, layoutFor, masonry, panelWidth, pieceSplit, revealDelta, slideBox, stripSpec, wallColumns,
} from "../../src/layout";

describe("layoutFor", () => {
  it("keeps phones held upright in portrait", () => {
    expect(layoutFor(390, 844)).toMatchObject({ landscape: false, compact: false, panel: 0 });
    expect(layoutFor(768, 1024)).toMatchObject({ landscape: false, compact: false });
  });
  it("treats a phone on its side as compact landscape", () => {
    expect(layoutFor(844, 390)).toMatchObject({ landscape: true, compact: true });
    expect(layoutFor(932, 430)).toMatchObject({ landscape: true, compact: true });
  });
  it("gives tablets and desktops a roomy landscape", () => {
    expect(layoutFor(1024, 768)).toMatchObject({ landscape: true, compact: false });
    expect(layoutFor(1366, 1024)).toMatchObject({ landscape: true, compact: false });
  });
  it("keeps the phone column for narrow or square windows", () => {
    expect(layoutFor(540, 400).landscape).toBe(false); // wider than tall, but too narrow for two panes
    expect(layoutFor(700, 700).landscape).toBe(false); // square counts as portrait, like CSS orientation
    expect(layoutFor(560, 559).landscape).toBe(true);
  });
  it("sizes the side panel only in landscape", () => {
    expect(layoutFor(844, 390).panel).toBe(panelWidth(844));
  });
});

describe("panelWidth", () => {
  it("is about a third of the width, within 300–420", () => {
    expect(panelWidth(560)).toBe(300);
    expect(panelWidth(844)).toBe(304);
    expect(panelWidth(1024)).toBe(369);
    expect(panelWidth(1366)).toBe(420);
    expect(panelWidth(2560)).toBe(420);
  });
});

describe("fitArt", () => {
  it("fits a wide image to the width", () => {
    expect(fitArt(400, 300, 2)).toEqual({ w: 400, h: 200 });
  });
  it("fits a tall image to the height", () => {
    expect(fitArt(400, 300, 0.5)).toEqual({ w: 150, h: 300 });
  });
  it("treats a missing or bad aspect as square", () => {
    expect(fitArt(400, 300, null)).toEqual({ w: 300, h: 300 });
    expect(fitArt(400, 300, 0)).toEqual({ w: 300, h: 300 });
    expect(fitArt(400, 300, Number.NaN)).toEqual({ w: 300, h: 300 });
  });
  it("never returns a non-positive size", () => {
    const r = fitArt(-10, 0, 1.5);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });
});

/** The portrait hero sizing the app shipped with, kept to check heroBox + fitArt against. */
function legacyHero(cw: number, ch: number, asp: number) {
  const W = Math.min(320, cw - 64), H = Math.max(160, ch - 24);
  let w = Math.min(W, W * asp), hh = w / asp;
  if (hh > H - 30) { hh = H - 30; w = hh * asp; }
  return { w, h: hh };
}

describe("heroBox", () => {
  it("matches the original portrait sizing exactly", () => {
    for (const [cw, ch] of [[390, 420], [390, 300], [375, 250], [320, 180], [520, 600]])
      for (const asp of [0.5, 0.75, 1, 1.33, 1.6, 2.4]) {
        const b = heroBox(false, cw, ch);
        const got = fitArt(b.w, b.h, asp), want = legacyHero(cw, ch, asp);
        expect(got.w).toBeCloseTo(want.w, 6);
        expect(got.h).toBeCloseTo(want.h, 6);
      }
  });
  it("caps the portrait hero at 320 wide", () => {
    expect(heroBox(false, 520, 900).w).toBe(320);
  });
  it("lets the landscape hero fill its area, with no 320 cap", () => {
    const b = heroBox(true, 484, 276);
    expect(b).toEqual({ w: 444, h: 246 });
    expect(heroBox(true, 946, 860).w).toBeGreaterThan(320);
  });
  it("a tall painting fills the landscape height", () => {
    const b = heroBox(true, 484, 276);
    expect(fitArt(b.w, b.h, 0.8).h).toBe(b.h);
  });
});

describe("stripSpec", () => {
  it("keeps the original portrait filmstrip", () => {
    expect(stripSpec(false)).toMatchObject({ sp: 78, thumb: 60, top: 16, label: 84, tick: 100, head: 112, height: 124 });
  });
  it("is shorter on a phone held sideways, with everything inside it", () => {
    const s = stripSpec(true);
    expect(s.height).toBeLessThan(stripSpec(false).height);
    expect(s.sp).toBeGreaterThan(s.thumb);
    expect(s.top + s.thumb).toBeLessThan(s.label);
    expect(s.label).toBeLessThan(s.tick);
    expect(s.tick + s.tickH).toBeLessThanOrEqual(s.head);
    expect(s.head).toBeLessThanOrEqual(s.height);
  });
});

describe("landscapeChrome", () => {
  it("stacks top bar, chips and panel without overlap", () => {
    for (const compact of [true, false]) {
      const c = landscapeChrome(compact);
      expect(c.chipsTop).toBeGreaterThanOrEqual(c.barTop + 48);
      expect(c.panelTop).toBeGreaterThan(c.chipsTop);
    }
  });
});

describe("wallColumns", () => {
  const portrait = { landscape: false, compact: false }, phoneSide = { landscape: true, compact: true }, wide = { landscape: true, compact: false };
  it("is two columns in portrait, whatever the width", () => {
    expect(wallColumns(330, portrait)).toBe(2);
    expect(wallColumns(460, portrait)).toBe(2);
  });
  it("is 3–4 columns on a phone held sideways", () => {
    expect(wallColumns(784, phoneSide)).toBe(4); // 844 wide
    expect(wallColumns(872, phoneSide)).toBe(4); // 932 wide
    expect(wallColumns(560, phoneSide)).toBe(3);
  });
  it("scales up on tablets and desktops, at most six", () => {
    expect(wallColumns(964, wide)).toBe(4);  // 1024 wide
    expect(wallColumns(1306, wide)).toBe(5); // 1366 wide
    expect(wallColumns(4000, wide)).toBe(6);
  });
});

describe("masonry", () => {
  /** The two-column split the wall shipped with. */
  function legacy(aspects: number[]) {
    const cols: number[][] = [[], []], hgt = [0, 0];
    aspects.forEach((a, i) => {
      const asp = Math.max(0.6, Math.min(1.7, a || 1)), c = hgt[0] <= hgt[1] ? 0 : 1;
      cols[c].push(i); hgt[c] += 1 / asp + 0.38;
    });
    return cols;
  }
  it("matches the original two-column split", () => {
    const aspects = [1.33, 0.78, 1, 1.6, 0.75, 1.25, 1.25, 1.5, 1.2, 0.8, 0, 2.5];
    expect(masonry(aspects, 2)).toEqual(legacy(aspects));
  });
  it("keeps every item exactly once, in order within each column", () => {
    const aspects = Array.from({ length: 23 }, (_, i) => 0.5 + ((i * 37) % 13) / 10);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const cols = masonry(aspects, n);
      expect(cols).toHaveLength(n);
      const all = cols.flat().sort((a, b) => a - b);
      expect(all).toEqual(aspects.map((_, i) => i));
      cols.forEach((c) => expect([...c].sort((a, b) => a - b)).toEqual(c));
    }
  });
  it("fills the first row left to right", () => {
    expect(masonry([1, 1, 1, 1], 4)).toEqual([[0], [1], [2], [3]]);
  });
  it("handles nothing, and a bad column count", () => {
    expect(masonry([], 3)).toEqual([[], [], []]);
    expect(masonry([1, 1], 0)).toEqual([[0, 1]]);
  });
});

describe("pieceSplit and slideBox", () => {
  it("gives the image a bit more than half, and details at most 520", () => {
    expect(pieceSplit(844)).toBe(456);
    expect(pieceSplit(1366)).toBe(846);
    for (const w of [600, 844, 932, 1024, 1366, 1920]) expect(w - pieceSplit(w)).toBeLessThanOrEqual(520);
  });
  it("keeps the original portrait slide box", () => {
    expect(slideBox(false, 999, 999)).toEqual({ w: 320, h: 290 });
  });
  it("sizes landscape slides by the pane", () => {
    expect(slideBox(true, 456, 340)).toEqual({ w: 400, h: 300 });
  });
});

describe("keyboardInset", () => {
  it("is 0 with no keyboard", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
  });
  it("is the covered height when the keyboard is up", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
  });
  it("discounts the part Safari scrolled the visual viewport down by", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 120, scale: 1 })).toBe(216);
  });
  it("never goes negative and rounds sub-pixel heights", () => {
    expect(keyboardInset(844, { height: 850, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(390, { height: 189.6, offsetTop: 0 })).toBe(200);
  });
  it("ignores a pinch-zoomed page", () => {
    expect(keyboardInset(844, { height: 422, offsetTop: 100, scale: 2 })).toBe(0);
  });
});

describe("revealDelta", () => {
  const band = { top: 100, bottom: 500 };
  it("leaves a field that is already visible", () => {
    expect(revealDelta({ top: 200, bottom: 246 }, band)).toBe(0);
  });
  it("scrolls down to bring a field up from behind the keyboard", () => {
    expect(revealDelta({ top: 600, bottom: 646 }, band)).toBe(646 - 484);
  });
  it("scrolls up to a field above the band", () => {
    expect(revealDelta({ top: 40, bottom: 86 }, band)).toBe(40 - 116);
  });
  it("aligns a field taller than the band to its top", () => {
    expect(revealDelta({ top: 300, bottom: 900 }, band)).toBe(300 - 116);
  });
  it("takes a custom margin", () => {
    expect(revealDelta({ top: 480, bottom: 500 }, band, 0)).toBe(0);
  });
});
