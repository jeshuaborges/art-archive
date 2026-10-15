import { describe, expect, it } from "vitest";
import { DISPLAY_MAX, sameShape, scaledSize, THUMB_MAX } from "../../src/imageprep";

describe("scaledSize", () => {
  it("caps the long edge, keeping proportions (same rounding as before)", () => {
    expect(scaledSize(8064, 6048, DISPLAY_MAX)).toEqual({ w: 1800, h: 1350 }); // 48 MP landscape
    expect(scaledSize(6048, 8064, DISPLAY_MAX)).toEqual({ w: 1350, h: 1800 });
    expect(scaledSize(4032, 3024, THUMB_MAX)).toEqual({ w: 560, h: 420 });
    expect(scaledSize(3000, 2001, DISPLAY_MAX)).toEqual({ w: 1800, h: 1201 });
  });
  it("never scales up", () => {
    expect(scaledSize(1200, 800, DISPLAY_MAX)).toEqual({ w: 1200, h: 800 });
  });
  it("keeps at least one pixel", () => {
    expect(scaledSize(10000, 2, THUMB_MAX)).toEqual({ w: 560, h: 1 });
  });
});

describe("sameShape", () => {
  it("accepts a bitmap of the requested proportions, at any size", () => {
    expect(sameShape({ width: 1800, height: 1350 }, { w: 1800, h: 1350 })).toBe(true);
    expect(sameShape({ width: 8064, height: 6048 }, { w: 1800, h: 1350 })).toBe(true); // resize ignored: still usable
  });
  it("rejects a bitmap whose rotation was lost", () => {
    expect(sameShape({ width: 1800, height: 1350 }, { w: 1350, h: 1800 })).toBe(false);
  });
});
