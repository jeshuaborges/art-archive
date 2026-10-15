import { describe, expect, it } from "vitest";
import { applyAttrsPatch, fieldDefInputSchema, parseFieldDef, searchText, formatFuzzyDate, type FieldDefRow } from "../../worker/fields";

const row = (r: Partial<FieldDefRow> & { key: string; type: string }): FieldDefRow => ({
  label: r.key, options: "{}", required: 0, sort_order: 0, help_text: null, archived_at: null, filterable: 0, ...r,
});
const defs = [
  row({ key: "medium", type: "select", label: "Medium", options: JSON.stringify({ choices: ["Oil", "Pastel"], allowNew: true }) }),
  row({ key: "frame", type: "select", label: "Frame", options: JSON.stringify({ choices: ["Gold", "Black"], allowNew: false }) }),
  row({ key: "subjects", type: "multi_select", label: "Subjects", options: JSON.stringify({ choices: ["Landscape"], allowNew: true }) }),
  row({ key: "price", type: "number", label: "Price", options: JSON.stringify({ min: 0, unit: "USD" }) }),
  row({ key: "notes", type: "long_text", label: "Notes", options: JSON.stringify({ maxLength: 10 }) }),
  row({ key: "sold", type: "fuzzy_date", label: "Sold" }),
  row({ key: "link", type: "url", label: "Link" }),
  row({ key: "title2", type: "text", label: "Required thing", required: 1 }),
  row({ key: "old", type: "text", label: "Old", archived_at: "2026-01-01" }),
].map(parseFieldDef);

describe("applyAttrsPatch", () => {
  it("canonicalises select values and reports new choices", () => {
    const r = applyAttrsPatch(defs, {}, { medium: "oil", subjects: ["landscape", "Coast", "Coast"], title2: "x" }, "create");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attrs.medium).toBe("Oil");
    expect(r.attrs.subjects).toEqual(["Landscape", "Coast"]);
    expect(r.newChoices).toEqual({ subjects: ["Coast"] });
  });
  it("rejects unknown fields, closed choices, bad numbers, bad dates, long text, bad urls", () => {
    const r = applyAttrsPatch(defs, {}, { nope: 1, frame: "Silver", price: -3, sold: { year: 1990, day: 2 }, notes: "x".repeat(11), link: "ftp://x.y", title2: "ok" }, "create");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const keys = r.issues.map((i) => i.key).sort();
    expect(keys).toEqual(["frame", "link", "nope", "notes", "price", "sold"]);
  });
  it("enforces required on create but not when an update leaves it alone", () => {
    expect(applyAttrsPatch(defs, {}, {}, "create").ok).toBe(false);
    expect(applyAttrsPatch(defs, {}, { medium: "Oil" }, "update").ok).toBe(true);
    const clear = applyAttrsPatch(defs, { title2: "x" }, { title2: "" }, "update");
    expect(clear.ok).toBe(false);
  });
  it("clears optional fields with empty values and blocks writes to archived fields", () => {
    const r = applyAttrsPatch(defs, { medium: "Oil", old: "keep" }, { medium: null }, "update");
    expect(r.ok && r.attrs).toEqual({ old: "keep" });
    const w = applyAttrsPatch(defs, {}, { old: "new" }, "update");
    expect(w.ok).toBe(false);
  });
  it("builds search text and formats fuzzy dates", () => {
    expect(searchText(defs, { medium: "Oil", subjects: ["Landscape", "Water"], price: 10 })).toContain("Subjects: Landscape, Water");
    expect(formatFuzzyDate({ year: 1985, yearEnd: 1989, circa: true })).toBe("c. 1985–1989");
  });
});

describe("fieldDefInputSchema", () => {
  it("validates keys and type-specific options", () => {
    expect(fieldDefInputSchema.safeParse({ key: "frame_type", label: "Frame", type: "select", options: { choices: ["Gold"] } }).success).toBe(true);
    expect(fieldDefInputSchema.safeParse({ key: "Bad Key", label: "x", type: "text" }).success).toBe(false);
    expect(fieldDefInputSchema.safeParse({ key: "n", label: "x", type: "number", options: { choices: [] } }).success).toBe(false);
  });
});
