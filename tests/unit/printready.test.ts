import { describe, expect, it } from "vitest";
import { assessPrint, bestOf, fixityState, parsePhysicalSize } from "../../worker/printready";
import type { Tech } from "../../worker/techmeta";

const tech = (o: Partial<Tech> = {}): Tech => ({
  format: "TIFF", width: null, height: null, bitsPerChannel: 8, colorMode: "RGB", hasAlpha: false, iccProfile: "Adobe RGB (1998)", dpi: 300,
  compression: "None", lossy: false, jpegQuality: null, camera: null, software: null, capturedAt: null, orientation: null, ...o,
});

describe("painting sizes", () => {
  it("reads the size field in inches or centimetres", () => {
    expect(parsePhysicalSize("24 × 36 in")).toEqual({ w: 24, h: 36 });
    expect(parsePhysicalSize("10 × 13.3 in")).toEqual({ w: 10, h: 13.3 });
    expect(parsePhysicalSize("24x36")).toEqual({ w: 24, h: 36 });
    expect(parsePhysicalSize('24" x 36"')).toEqual({ w: 24, h: 36 });
    expect(parsePhysicalSize("11 1/2 x 14 inches")).toEqual({ w: 11.5, h: 14 });
    expect(parsePhysicalSize("61 × 91 cm")).toEqual({ w: 24, h: 35.8 });
    expect(parsePhysicalSize("30 × 40 × 2 in")).toEqual({ w: 30, h: 40 });
  });
  it("gives up on anything else", () => {
    for (const s of ["", "large", "about 3 feet", null, 42]) expect(parsePhysicalSize(s)).toBeNull();
  });
});

describe("print readiness", () => {
  it("calls a file that prints the painting at its own size at 300 ppi an archival master", () => {
    const a = assessPrint({ width: 3000, height: 3000 }, tech(), { w: 9, h: 9 })!;
    expect(a.grade).toBe("master");
    expect(a.ppiAtSize).toBe(333);
    expect(a.summary).toBe("Prints at full size (9 × 9 in) at 333 ppi");
    expect(a.notes).toContain("Colour profile: Adobe RGB (1998)");
  });
  it("matches the image to the painting's orientation", () => {
    expect(assessPrint({ width: 7200, height: 4800 }, null, { w: 16, h: 24 })!.ppiAtSize).toBe(300);
  });
  it("grades by what the pixels can do at the painting's size", () => {
    expect(assessPrint({ width: 3650, height: 2700 }, null, { w: 24, h: 18 })!.grade).toBe("print");   // 150 ppi
    expect(assessPrint({ width: 3000, height: 2250 }, null, { w: 48, h: 36 })!.grade).toBe("small");   // 62 ppi, still 10 in at 300
    expect(assessPrint({ width: 1200, height: 900 }, null, { w: 48, h: 36 })!.grade).toBe("reference");
  });
  it("without a size, judges by pixels and says to add one", () => {
    const big = assessPrint({ width: 6000, height: 4000 }, null, null)!;
    expect(big.grade).toBe("print");
    expect(big.summary).toBe("Prints up to 20 × 13.3 in at 300 ppi");
    expect(big.warnings).toContain("Add the painting's size to check full-size prints");
    expect(assessPrint({ width: 2784, height: 2096 }, null, null)!.grade).toBe("small");
    expect(assessPrint({ width: 800, height: 600 }, null, null)!.grade).toBe("reference");
  });
  it("holds back heavily compressed files and flags missing colour profiles", () => {
    const a = assessPrint({ width: 3000, height: 3000 }, tech({ format: "JPEG", lossy: true, jpegQuality: 62, iccProfile: null }), { w: 9, h: 9 })!;
    expect(a.grade).toBe("print");
    expect(a.warnings.join(" ")).toMatch(/quality ≈62/);
    expect(a.warnings.join(" ")).toMatch(/No colour profile/);
  });
  it("notices a file that isn't the painting's shape", () => {
    expect(assessPrint({ width: 3000, height: 1000 }, null, { w: 20, h: 20 })!.warnings.join(" ")).toMatch(/shape/);
  });
  it("can't judge a file with no pixel size", () => {
    expect(assessPrint({ width: null, height: 100 }, null, null)).toBeNull();
  });
  it("picks a piece's best file by grade, then pixels", () => {
    const f = (id: string, w: number) => ({ id, print: assessPrint({ width: w, height: w }, null, { w: 10, h: 10 }) });
    expect(bestOf([f("a", 1600), f("b", 3200), f("c", 3100)])!.id).toBe("b");
    expect(bestOf([{ id: "x", print: null }])).toBeNull();
  });
});

describe("fixity", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  it("is verified for 90 days after a matching check", () => {
    expect(fixityState("2026-09-01T00:00:00Z", 1, now)).toBe("verified");
    expect(fixityState("2026-06-01T00:00:00Z", 1, now)).toBe("due");
    expect(fixityState("2026-10-01T00:00:00Z", 0, now)).toBe("failed");
    expect(fixityState(null, null, now)).toBe("unchecked");
  });
});
