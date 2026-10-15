import { describe, expect, it } from "vitest";
import {
  axisLabels, barHeights, clampLabel, defaultTimelineIndex, groupAt, groupYears, railIndexAt,
  railLabelShown, railLayout, rulerSlots, slotAt, sortNewestFirst, sortOldestFirst, stepYear, yearBreaks, yearFull, yearKeyOf, yearShort,
} from "../../src/years";
import { countLabel } from "../../src/types";

const p = (catalogId: string, yearStart: number | null, circa = false) => ({ catalogId, yearStart, circa });

describe("grouping by year", () => {
  const list = sortOldestFirst([p("c", 2012, true), p("u1", null), p("a", 2012), p("b", 1979), p("d", 2013), p("u2", null), p("e", 2012)]);

  it("sorts oldest first with undated last, ties by catalog number", () => {
    expect(list.map((a) => a.catalogId)).toEqual(["b", "a", "c", "e", "d", "u1", "u2"]);
  });
  it("puts circa pieces under their year and the undated in one group at the end", () => {
    const g = groupYears(list);
    expect(g.map((x) => [x.key, x.first, x.count])).toEqual([[1979, 0, 1], [2012, 1, 3], [2013, 4, 1], ["undated", 5, 2]]);
    expect(g[3].year).toBeNull();
  });
  it("sorts newest first for the wall, undated still last", () => {
    expect(groupYears(sortNewestFirst(list)).map((x) => x.key)).toEqual([2013, 2012, 1979, "undated"]);
  });
  it("keeps one group per year even for an unsorted list", () => {
    expect(groupYears([p("a", 2012), p("b", 2013), p("c", 2012)]).map((x) => [x.key, x.count])).toEqual([[2012, 2], [2013, 1]]);
  });
  it("maps a piece index to its year's group", () => {
    const g = groupYears(list);
    expect([0, 1, 3, 4, 5, 6].map((i) => groupAt(g, i))).toEqual([0, 1, 1, 2, 3, 3]);
    expect(groupAt([], 3)).toBe(0);
  });
  it("opens the timeline on the newest dated piece, not the undated pile", () => {
    expect(defaultTimelineIndex(list)).toBe(4);
    expect(defaultTimelineIndex([p("u", null), p("v", null)])).toBe(1);
    expect(defaultTimelineIndex([])).toBe(0);
  });
  it("labels years long and short", () => {
    expect(yearKeyOf(null)).toBe("undated");
    expect(yearKeyOf(NaN)).toBe("undated");
    expect([yearFull(2006), yearFull(null), yearShort(2006), yearShort(1979), yearShort(null)]).toEqual(["2006", "Undated", "'06", "'79", "—"]);
  });
});

describe("density ruler", () => {
  it("scales bars by square root against the busiest dated year, capping the undated pile", () => {
    const h = barHeights([{ year: 2006, count: 100 }, { year: 2007, count: 25 }, { year: 1979, count: 1 }, { year: null, count: 369 }], 3, 33);
    expect(h).toEqual([33, 18, 6, 33]);
  });
  it("gives every year a visible bar and handles an all-undated archive", () => {
    expect(barHeights([{ year: 2000, count: 1 }], 3, 30)).toEqual([30]);
    expect(barHeights([{ year: null, count: 5 }], 3, 30)).toEqual([30]);
    expect(barHeights([{ year: 2000, count: 0 }], 3, 30)).toEqual([0]);
  });
  it("finds breaks in the years and before the undated group", () => {
    expect(yearBreaks([1979, 2006, 2007, null])).toEqual([false, true, false, true]);
    expect(yearBreaks([2026, 2025, 2023])).toEqual([false, false, true]);
  });
  it("lays out one slot per year, with gaps at breaks, filling the width", () => {
    const s = rulerSlots([1979, 2006, 2007, null], 340, 0.7);
    const w = 340 / (4 + 1.4);
    expect(s[0]).toEqual({ x: 0, w, gapBefore: false });
    expect(s[1].x).toBeCloseTo(1.7 * w);
    expect(s[2].x).toBeCloseTo(2.7 * w);
    expect(s[3].x + s[3].w).toBeCloseTo(340);
    expect(rulerSlots([], 300)).toEqual([]);
  });
  it("maps a position to the slot under it, or the nearest across a gap", () => {
    const s = rulerSlots([1979, 2006, 2007, null], 340, 0.7);
    expect(slotAt(1, s)).toBe(0);
    expect(slotAt(s[2].x + 2, s)).toBe(2);
    expect(slotAt(-50, s)).toBe(0);
    expect(slotAt(9999, s)).toBe(3);
    expect(slotAt(s[1].x - 2, s)).toBe(1); // in the gap, nearer 2006
  });
  it("labels the axis without crowding: ends and undated first, then fives", () => {
    const years = [1979, ...Array.from({ length: 21 }, (_, i) => 2006 + i), null];
    const s = rulerSlots(years, 358);
    const ix = axisLabels(years, s, 38);
    const labels = ix.map((i) => years[i]);
    expect(labels[0]).toBe(1979);
    expect(labels).toContain(null);
    expect(labels).toContain(2010);
    for (let k = 1; k < ix.length; k++) {
      const c = (i: number) => s[i].x + s[i].w / 2;
      expect(c(ix[k]) - c(ix[k - 1])).toBeGreaterThanOrEqual(38);
    }
  });
  it("keeps the floating year label inside the ruler", () => {
    expect(clampLabel(5, 80, 300)).toBe(40);
    expect(clampLabel(295, 80, 300)).toBe(260);
    expect(clampLabel(150, 80, 300)).toBe(150);
    expect(clampLabel(10, 400, 300)).toBe(150);
  });
});

describe("side rail", () => {
  it("uses full rows when they fit, centred", () => {
    const rl = railLayout(23, 584);
    expect(rl.row).toBe(22);
    expect(rl.offset).toBe((584 - 22 * 23) / 2);
    expect(rl.step).toBe(1);
  });
  it("thins labels to every other row in a short landscape rail", () => {
    const rl = railLayout(23, 270);
    expect(rl.row).toBeCloseTo(270 / 23);
    expect(rl.offset).toBe(0);
    expect(rl.step).toBe(2);
    expect(railLayout(0, 300)).toEqual({ row: 0, offset: 0, step: 1 });
  });
  it("maps y to a row, clamped to the ends", () => {
    const rl = railLayout(10, 300); // rows of 22, offset 40
    expect(railIndexAt(41, rl, 10)).toBe(0);
    expect(railIndexAt(40 + 22 * 3 + 1, rl, 10)).toBe(3);
    expect(railIndexAt(-100, rl, 10)).toBe(0);
    expect(railIndexAt(1000, rl, 10)).toBe(9);
  });
  it("shows labels on every step-th row, the active row and the undated row; neighbours of the active give way", () => {
    const shown = (step: number, active: number) => Array.from({ length: 7 }, (_, i) => railLabelShown(i, 7, step, active));
    expect(shown(1, 3)).toEqual([true, true, true, true, true, true, true]);
    expect(shown(2, 0)).toEqual([true, false, true, false, true, false, true]);
    expect(shown(2, 3)).toEqual([true, false, false, true, false, false, true]);
    expect(shown(3, 0)).toEqual([true, false, false, true, false, false, true]);
    expect(railLabelShown(4, 6, 2, 0)).toBe(false); // gives way to the undated row right after it
  });
});

describe("keys", () => {
  it("steps years with arrows, pages and ends", () => {
    expect(stepYear("ArrowRight", 3, 10)).toBe(4);
    expect(stepYear("ArrowUp", 0, 10)).toBe(0);
    expect(stepYear("ArrowDown", 9, 10)).toBe(9);
    expect(stepYear("PageDown", 7, 10)).toBe(9);
    expect(stepYear("PageUp", 7, 10)).toBe(2);
    expect(stepYear("Home", 7, 10)).toBe(0);
    expect(stepYear("End", 2, 10)).toBe(9);
    expect(stepYear("a", 2, 10)).toBeNull();
    expect(stepYear("End", 0, 0)).toBeNull();
  });
});

describe("count label", () => {
  const base = { total: 1326, shown: 1326, searching: false, archived: "exclude" as const, filtered: false };
  it("says nothing for the whole archive or while loading", () => {
    expect(countLabel(base)).toBeNull();
    expect(countLabel({ ...base, total: null })).toBeNull();
    expect(countLabel({ ...base, archived: "include" })).toBeNull();
  });
  it("counts search results, filter results and archived pieces", () => {
    expect(countLabel({ ...base, searching: true, shown: 1 })).toBe("1 CLOSE MATCH");
    expect(countLabel({ ...base, searching: true, shown: 12 })).toBe("12 CLOSE MATCHES");
    expect(countLabel({ ...base, filtered: true, shown: 40 })).toBe("40 OF 1326");
    expect(countLabel({ ...base, filtered: true })).toBeNull();
    expect(countLabel({ ...base, archived: "only", total: 3, shown: 3 })).toBe("3 ARCHIVED");
    expect(countLabel({ ...base, archived: "only", total: 3, shown: 1, filtered: true })).toBe("1 OF 3 ARCHIVED");
  });
});
