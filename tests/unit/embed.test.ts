import { describe, expect, it } from "vitest";
import { colorName, cosine, localEmbed, tokenize } from "../../worker/embed";
import { kmeansPalette } from "../../src/imageprep";
import { paletteHas, yearLabel } from "../../src/util";

const docs: Record<string, string> = {
  sunset: "Prismatic Sunset at Soda Lake\nMedium: Oil\nSubjects: Landscape, Water\ncolors purple orange gold\n2020s",
  jazz: "Paso Robles Jazz Fest, Anthony Fung Trio\nMedium: Pastel\nSubjects: Music & people, Night\ncolors red pink",
  barn: "Templeton Feed Grain\nMedium: Print\nSubjects: Rural, Landscape\ncolors gold red brown",
  graphic: "Torpedo Factory serigraph\nMedium: Serigraph\nSubjects: Abstract\nStyle: Graphic\ncolors blue red gold",
};
const rank = (q: string) => {
  const qv = localEmbed(q);
  return Object.entries(docs).map(([k, d]) => [k, cosine(qv, localEmbed(d))] as const).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
};

describe("local embedding model", () => {
  it("finds pieces by meaning, not just exact words", () => {
    expect(rank("warm evening over the water")[0]).toBe("sunset");
    expect(rank("concert crowd")[0]).toBe("jazz");
    expect(rank("farm silo")[0]).toBe("barn");
    expect(rank("bold screenprint shapes")[0]).toBe("graphic");
  });
  it("produces unit vectors and stable tokens", () => {
    const v = localEmbed("golden rolling hills");
    expect(Math.abs(Math.hypot(...v) - 1)).toBeLessThan(1e-9);
    expect(tokenize("The Café, at Soda-Lake!")).toEqual(["cafe", "soda", "lake"]);
  });
  it("names colours", () => {
    expect(colorName("#7B3A8E")).toBe("purple");
    expect(colorName("#F7894A")).toBe("orange");
    expect(colorName("#F2C14E")).toBe("gold");
    expect(colorName("#3E8E41")).toBe("green");
    expect(colorName("#FFFFFF")).toBe("white");
  });
});

describe("palette + display helpers", () => {
  it("extracts dominant colours, most common first", () => {
    const px = [...Array(70).fill([200, 40, 40]), ...Array(30).fill([40, 60, 200])].map((p) => p.slice());
    const pal = kmeansPalette(px, 3);
    expect(pal[0]).toBe("#C82828");
    expect(pal).toContain("#283CC8");
  });
  it("matches palette colours to swatches by hue", () => {
    expect(paletteHas(["#7B3A8E", "#D2A65C"], "#8E6AA8")).toBe(true);
    expect(paletteHas(["#7B3A8E"], "#8FA548")).toBe(false);
  });
  it("labels years", () => {
    expect(yearLabel({ yearStart: 1985, yearEnd: 1989, circa: true })).toBe("c. 1985–1989");
    expect(yearLabel({ yearStart: null, yearEnd: null, circa: false })).toBe("Undated");
  });
});
