import { describe, expect, it } from "vitest";
import {
  archivedIdFilter, archivedWhere, archivePatch, bulkIdsSchema, countArchived, coverAfterHiding, coverAfterRestoring, isShown, parseArchivedMode,
  pickCover, selectImages, shownIds, tallyBulk, uniqueIds, vectorTopK, type CoverCandidate,
} from "../../worker/archive";
import { artworkDTO, viewImages } from "../../worker/store";

describe("archived mode", () => {
  it("defaults to exclude and rejects unknown values", () => {
    expect(parseArchivedMode(undefined)).toBe("exclude");
    expect(parseArchivedMode("")).toBe("exclude");
    expect(parseArchivedMode(" Include ")).toBe("include");
    expect(parseArchivedMode("only")).toBe("only");
    expect(parseArchivedMode("all")).toBeNull();
  });
  it("decides what a read shows", () => {
    expect(isShown(null, "exclude")).toBe(true);
    expect(isShown("2026-10-01", "exclude")).toBe(false);
    expect(isShown(null, "only")).toBe(false);
    expect(isShown("2026-10-01", "only")).toBe(true);
    expect(isShown(null, "include")).toBe(true);
    expect(isShown("2026-10-01", "include")).toBe(true);
  });
  it("builds the matching SQL fragments", () => {
    expect(archivedWhere("exclude")).toBe("archived_at IS NULL");
    expect(archivedWhere("only", "a.archived_at")).toBe("a.archived_at IS NOT NULL");
    expect(archivedWhere("include")).toBe("1 = 1");
    expect(archivedIdFilter("exclude", "artwork_id")).toBe("artwork_id NOT IN (SELECT id FROM artworks WHERE archived_at IS NOT NULL)");
    expect(archivedIdFilter("only", "artwork_id")).toBe("artwork_id IN (SELECT id FROM artworks WHERE archived_at IS NOT NULL)");
    expect(archivedIdFilter("include", "artwork_id")).toBe("1 = 1");
  });
  it("stamps an archive and clears it on unarchive, each guarded so a repeat changes nothing", () => {
    expect(archivePatch(true, "T", "anne@x")).toEqual({ archivedAt: "T", archivedBy: "anne@x", guard: "archived_at IS NULL" });
    expect(archivePatch(false, "T", "anne@x")).toEqual({ archivedAt: null, archivedBy: null, guard: "archived_at IS NOT NULL" });
  });
});

describe("vector hits", () => {
  it("asks for enough neighbours to make up for archived pieces left in the index", () => {
    expect(vectorTopK(20, "exclude", 5)).toBe(25);
    expect(vectorTopK(20, "include", 5)).toBe(20);
    expect(vectorTopK(20, "only", 5)).toBe(100);
    expect(vectorTopK(90, "exclude", 40)).toBe(100);
  });
  it("filters hits by the archived ids", () => {
    const hidden = new Set(["b"]);
    expect(["a", "b", "c"].filter(shownIds("exclude", hidden))).toEqual(["a", "c"]);
    expect(["a", "b", "c"].filter(shownIds("only", hidden))).toEqual(["b"]);
    expect(["a", "b", "c"].filter(shownIds("include", hidden))).toEqual(["a", "b", "c"]);
  });
});

const img = (id: string, o: Partial<CoverCandidate> = {}): CoverCandidate => ({ id, kind: "work", sort_order: 0, created_at: "2026-01-01", archived_at: null, deleted_at: null, ...o });

describe("covers", () => {
  const rows = [
    img("study", { kind: "study", sort_order: 0 }),
    img("front", { sort_order: 0 }),
    img("detail", { sort_order: 1 }),
  ];
  it("falls back to the first visible finished image, then any visible image", () => {
    expect(pickCover(rows)).toBe("front");
    expect(pickCover([img("b", { sort_order: 2 }), img("a", { sort_order: 2, created_at: "2025-01-01" })])).toBe("a");
    expect(pickCover([rows[0], { ...rows[1], archived_at: "T" }, { ...rows[2], deleted_at: "T" }])).toBe("study");
    expect(pickCover([{ ...rows[1], archived_at: "T" }])).toBeNull();
  });
  it("hiding the cover hands it to the next image; hiding another keeps it", () => {
    expect(coverAfterHiding("front", "detail", rows)).toEqual({ kind: "keep" });
    expect(coverAfterHiding("front", "front", rows)).toEqual({ kind: "set", imageId: "detail" });
    // works whether or not the rows already show the image as archived
    expect(coverAfterHiding("front", "front", [rows[0], { ...rows[1], archived_at: "T" }])).toEqual({ kind: "set", imageId: "study" });
    expect(coverAfterHiding("front", "front", [rows[1]])).toEqual({ kind: "clear" });
  });
  it("bringing an image back never takes the cover from a visible one", () => {
    expect(coverAfterRestoring("detail", rows)).toEqual({ kind: "keep" });
    // no cover at all (every image had been archived): the usual fallback picks one
    expect(coverAfterRestoring(null, [{ ...rows[0], archived_at: "T" }, rows[2]])).toEqual({ kind: "set", imageId: "detail" });
    // a stale cover pointing at a hidden image is replaced
    expect(coverAfterRestoring("front", [{ ...rows[1], archived_at: "T" }, rows[0]])).toEqual({ kind: "set", imageId: "study" });
    expect(coverAfterRestoring(null, [{ ...rows[1], archived_at: "T" }])).toEqual({ kind: "keep" });
  });
  it("splits images for a read and counts the archived ones", () => {
    const r = [{ id: "a", archived_at: null }, { id: "b", archived_at: "T" }];
    expect(selectImages(r, "exclude")).toEqual({ shown: [r[0]], archivedCount: 1 });
    expect(selectImages(r, "only").shown).toEqual([r[1]]);
    expect(selectImages(r, "include").shown).toEqual(r);
  });
});

describe("bulk", () => {
  it("validates, deduplicates and tallies", () => {
    expect(bulkIdsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(bulkIdsSchema.safeParse({ ids: ["a"], extra: 1 }).success).toBe(false);
    expect(bulkIdsSchema.safeParse({ ids: Array(501).fill("a") }).success).toBe(false);
    expect(uniqueIds(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(tallyBulk([["a", "changed"], ["b", "unchanged"], ["c", "notFound"], ["d", "changed"]]))
      .toEqual({ changed: ["a", "d"], unchanged: ["b"], notFound: ["c"] });
  });
  it("counts archived rows for the export summary", () => {
    expect(countArchived([{ archived_at: "T" }, { archived_at: null }, {}])).toBe(1);
  });
});

describe("artwork DTO", () => {
  const art = {
    id: "a1", catalog_id: "2020-001", title: "Soda Lake", year_start: 2020, year_end: null, circa: 0, status: "sold", attrs: "{}", palette: "[]",
    ai_description: null, cover_image_id: "front", version: 2, created_at: "2026-01-01", updated_at: "2026-01-02", deleted_at: null,
    archived_at: "2026-10-01T00:00:00.000Z", archived_by: "anne@x",
  };
  const row = (id: string, kind: string, sort: number, archived: string | null) => ({
    id, artwork_id: "a1", kind, role: "", r2_key: `artworks/2020-001/${id}.jpg`, display_key: null, thumb_key: null, sha256: id, content_type: "image/jpeg",
    bytes: 1, width: 10, height: 10, palette: "[]", caption: null, taken_on: null, sort_order: sort, created_at: "2026-01-01",
    deleted_at: null, archived_at: archived, archived_by: archived ? "anne@x" : null,
  });
  const rows = [row("front", "work", 0, "2026-10-02"), row("detail", "work", 1, null), row("ref", "reference", 0, null)];

  it("shows the archived state, leaves archived images out by default and never uses one as the cover", () => {
    const a = artworkDTO(art, rows);
    expect(a).toMatchObject({ archivedAt: "2026-10-01T00:00:00.000Z", archivedBy: "anne@x", archivedImageCount: 1, coverImageId: "detail" });
    expect(a.images.map((i) => i.id)).toEqual(["detail", "ref"]);
    expect(artworkDTO(art, rows, "only").images.map((i) => i.id)).toEqual(["front"]);
    expect(artworkDTO(art, rows, "only").cover?.id).toBe("detail");
  });
  it("can narrow a full read to the usual view", () => {
    const all = artworkDTO(art, rows, "include");
    expect(all.images.map((i) => [i.id, i.archivedAt])).toEqual([["front", "2026-10-02"], ["detail", null], ["ref", null]]);
    expect(viewImages(all, "exclude").images.map((i) => i.id)).toEqual(["detail", "ref"]);
  });
});
