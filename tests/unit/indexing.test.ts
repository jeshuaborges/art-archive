import { describe, expect, it, vi } from "vitest";
import {
  coverDescribeParams, describeKeyFor, descriptionImageIdAfterEdit, descriptionOrigin, describeWrite, embedText, ftsRow, inlineStep, parseVisionOutput,
  runIndexing, shouldDescribe, sidecarKey, sidecarRecord, startIndexing, upsertDecision, type CoverFacts, type DescriptionRow, type DoStep, type Embedded, type IndexOps, type PreviewOutcome, type TierOutcome, type UpsertOutcome,
} from "../../worker/indexing";
import { parseFieldDef } from "../../worker/fields";
import { indexOps, type ArtworkDTO, type Env } from "../../worker/store";

const defs = [
  parseFieldDef({ key: "medium", type: "select", label: "Medium", options: JSON.stringify({ choices: ["Oil"], allowNew: true }), required: 0, sort_order: 0, help_text: null, archived_at: null, filterable: 1 }),
  parseFieldDef({ key: "location", type: "text", label: "Where it is", options: "{}", required: 0, sort_order: 1, help_text: null, archived_at: null, filterable: 0 }),
];
const art = (o: Partial<ArtworkDTO> = {}): ArtworkDTO => ({
  id: "a1", catalogId: "2020-001", title: "Soda Lake", yearStart: 2021, yearEnd: null, circa: false, status: "sold",
  attrs: { medium: "Oil", location: "Hallway" }, palette: ["#7B3A8E", "#E0A030"], aiDescription: null, aiDescriptionImageId: null, coverImageId: null, version: 3,
  createdAt: "2026-01-01", updatedAt: "2026-01-02", archivedAt: null, archivedBy: null, images: [], cover: null, archivedImageCount: 0, ...o,
});

describe("indexing text builders", () => {
  it("builds the FTS row, falling back to a local description", () => {
    const r = ftsRow(art(), defs);
    expect(r).toMatchObject({ artwork_id: "a1", catalog_id: "2020-001", title: "Soda Lake" });
    expect(r.attrs_text).toContain("Oil");
    expect(r.attrs_text).toContain("Hallway");
    expect(r.ai_description).toBe("Oil from the 2020s; palette of purple, orange.");
    expect(ftsRow(art({ aiDescription: "A lake at dusk." }), defs).ai_description).toBe("A lake at dusk.");
  });
  it("leaves location out of the embedding text and includes the description once written", () => {
    const t = embedText(art({ aiDescription: "A lake at dusk." }), defs);
    expect(t).toContain("Soda Lake");
    expect(t).toContain("A lake at dusk.");
    expect(t).toContain("colors purple orange");
    expect(t).not.toContain("Hallway");
    expect(embedText(art(), defs)).not.toBe(t);
  });
  it("builds record.json with labelled fields and a readable status", () => {
    const rec = sidecarRecord(art({ aiDescription: "A lake." }), defs, { sold: "Sold" });
    expect(sidecarKey(art())).toBe("artworks/2020-001/record.json");
    expect(rec).toMatchObject({ format: "anne-laddon-archive-record/v1", catalogId: "2020-001", status: "Sold", description: "A lake.", version: 3 });
    expect(rec.fields).toContainEqual({ key: "location", label: "Where it is", value: "Hallway", display: "Hallway" });
    expect(sidecarRecord(art({ status: "odd" }), defs, {}).status).toBe("odd");
  });
  it("keeps archived state in record.json rather than dropping archived records", () => {
    expect(sidecarRecord(art(), defs, {}).archived).toBeNull();
    const image = (id: string, archivedAt: string | null) => ({
      id, artworkId: "a1", kind: "work", role: "", caption: null, takenOn: null, width: 1, height: 1, bytes: 1, contentType: "image/jpeg", sha256: id,
      palette: [], sortOrder: 0, createdAt: "2026-01-01", archivedAt, archivedBy: archivedAt ? "anne@x" : null,
      original: `/img/artworks/2020-001/${id}.jpg`, download: `/img/artworks/2020-001/${id}.jpg?download=1`, display: null, thumb: null, preview: "pending",
    });
    const rec = sidecarRecord(art({ archivedAt: "2026-10-01", archivedBy: "anne@x", images: [image("k1", null), image("k2", "2026-10-02")] as ArtworkDTO["images"] }), defs, {});
    expect(rec.archived).toEqual({ at: "2026-10-01", by: "anne@x" });
    expect(rec.images).toHaveLength(2);
    expect(rec.images[0]).not.toHaveProperty("archived");
    expect(rec.images[1]).toMatchObject({ file: "k2.jpg", archived: { at: "2026-10-02", by: "anne@x" } });
  });
});

describe("vision decisions", () => {
  const row: DescriptionRow = { ai_description: null, ai_description_image_id: null, cover_image_id: "i2", deleted_at: null };
  const machine = (imageId: string): DescriptionRow => ({ ...row, ai_description: "A mountain road.", ai_description_image_id: imageId });
  const human: DescriptionRow = { ...row, ai_description: "Typed by hand", ai_description_image_id: null };
  const go = (r: DescriptionRow | null, o: { describeKey?: string; imageId?: string | null; visionReady?: boolean } = {}) =>
    shouldDescribe({ describeKey: "k", imageId: "i2", visionReady: true, row: r, ...o });
  it("needs a key, Workers AI and a live piece", () => {
    expect(go(row)).toBe(true);
    expect(go(row, { describeKey: undefined })).toBe(false);
    expect(go(row, { visionReady: false })).toBe(false);
    expect(go(null)).toBe(false);
    expect(go({ ...row, deleted_at: "2026" })).toBe(false);
  });
  it("describes an empty description, or a machine one written for another image", () => {
    expect(go(row)).toBe(true);
    expect(go({ ...row, ai_description: "  " })).toBe(true);
    expect(go({ ...row, ai_description: "  ", ai_description_image_id: "i1" })).toBe(true);
    expect(go(machine("i1"))).toBe(true);
  });
  it("never re-describes the same image, and never replaces a person's description", () => {
    expect(go(machine("i2"))).toBe(false);
    expect(go(human)).toBe(false);
  });
  it("skips an image that is no longer the main image by the time the step runs", () => {
    expect(go({ ...row, cover_image_id: "i3" })).toBe(false);
    expect(go({ ...machine("i1"), cover_image_id: "i3" })).toBe(false);
    expect(go({ ...row, cover_image_id: null })).toBe(false);
  });
  it("without an image id (older params) fills only an empty description", () => {
    expect(go(row, { imageId: undefined })).toBe(true);
    expect(go({ ...row, cover_image_id: "other" }, { imageId: null })).toBe(true);
    expect(go(machine("i1"), { imageId: undefined })).toBe(false);
    expect(go(human, { imageId: null })).toBe(false);
  });
  it("reads a description's origin", () => {
    expect(descriptionOrigin(row)).toEqual({ kind: "empty" });
    expect(descriptionOrigin({ ai_description: " ", ai_description_image_id: "i1" })).toEqual({ kind: "empty" });
    expect(descriptionOrigin(machine("i1"))).toEqual({ kind: "machine", imageId: "i1" });
    expect(descriptionOrigin(human)).toEqual({ kind: "human" });
  });
  it("credits a write to the image described (or the cover) and guards on the row as read", () => {
    expect(describeWrite(machine("i1"), "i2", "A river valley.")).toEqual({
      set: { aiDescription: "A river valley.", imageId: "i2" },
      expect: { coverImageId: "i2", aiDescription: "A mountain road.", imageId: "i1" },
    });
    expect(describeWrite(row, null, "A lake.").set).toEqual({ aiDescription: "A lake.", imageId: "i2" });
  });
  it("an edit makes the description a person's; leaving it alone or unchanged keeps its origin", () => {
    const cur = { aiDescription: "A mountain road.", aiDescriptionImageId: "i1" };
    expect(descriptionImageIdAfterEdit(cur, undefined)).toBe("i1");
    expect(descriptionImageIdAfterEdit(cur, "A mountain road.")).toBe("i1");
    expect(descriptionImageIdAfterEdit(cur, "My own words.")).toBeNull();
    expect(descriptionImageIdAfterEdit(cur, "")).toBeNull();
    expect(descriptionImageIdAfterEdit(cur, null)).toBeNull();
    expect(descriptionImageIdAfterEdit({ aiDescription: null, aiDescriptionImageId: null }, null)).toBeNull();
  });
  it("parses either output shape, trims and caps it, and treats silence as null", () => {
    expect(parseVisionOutput({ description: "  A lake.  " })).toBe("A lake.");
    expect(parseVisionOutput({ response: "Hills." })).toBe("Hills.");
    expect(parseVisionOutput({ description: " ", response: "Hills." })).toBe("Hills.");
    expect(parseVisionOutput({ response: "x".repeat(5000) })).toHaveLength(4000);
    expect(parseVisionOutput({})).toBeNull();
    expect(parseVisionOutput(null)).toBeNull();
    expect(parseVisionOutput({ response: 42 })).toBeNull();
  });
  it("upserts only a live piece whose text hasn't moved on", () => {
    expect(upsertDecision("same", "same")).toBe("upserted");
    expect(upsertDecision(null, "same")).toBe("deleted");
    expect(upsertDecision("newer", "same")).toBe("superseded");
  });
});

// ----------------------------------------------------------- orchestration
const made = (displayKey: string | null, paletteChanged = false): PreviewOutcome => ({ status: "made", displayKey, paletteChanged });
function fakeOps(o: Partial<Record<keyof IndexOps, () => unknown>> = {}) {
  const calls: string[] = [];
  const vec: Embedded = { text: "t", vec: [0.1, 0.2] };
  const ops: IndexOps = {
    preview: async (id) => { calls.push(`preview:${id}`); return (o.preview ? o.preview() : made("artworks/x/k-display.webp")) as PreviewOutcome; },
    tierOriginal: async (id) => { calls.push(`tier:${id}`); return (o.tierOriginal ? o.tierOriginal() : "moved") as TierOutcome; },
    describe: async (key, imageId) => { calls.push(`describe:${key}${imageId ? `@${imageId}` : ""}`); return (o.describe ? o.describe() : true) as boolean; },
    refreshText: async () => { calls.push("refreshText"); return true; },
    embed: async () => { calls.push("embed"); return (o.embed ? o.embed() : vec) as Embedded | null; },
    upsert: async (e) => { calls.push(`upsert:${e.vec.length}`); return (o.upsert ? o.upsert() : "upserted") as UpsertOutcome; },
  };
  return { ops, calls };
}
/** Records step names and configs; like step.do, a step that throws after its retries rejects. */
function recordingStep() {
  const steps: { name: string; limit?: number }[] = [];
  const doStep: DoStep = async (name, config, fn) => { steps.push({ name, limit: config.retries?.limit }); return fn(); };
  return { steps, doStep };
}

describe("runIndexing", () => {
  it("describes, refreshes the text, embeds and upserts, in that order", async () => {
    const { ops, calls } = fakeOps();
    const { steps, doStep } = recordingStep();
    const r = await runIndexing({ artworkId: "a1", describeKey: "artworks/x/k-display.jpg" }, ops, doStep);
    expect(calls).toEqual(["describe:artworks/x/k-display.jpg", "refreshText", "embed", "upsert:2"]);
    expect(steps.map((s) => s.name)).toEqual(["describe", "refresh-text", "embed", "upsert"]);
    expect(steps.every((s) => (s.limit ?? 0) > 0)).toBe(true);
    expect(r).toEqual({ artworkId: "a1", preview: null, tiered: null, described: true, outcome: "upserted" });
  });
  it("hands the describe step the image it describes", async () => {
    const { ops, calls } = fakeOps();
    await runIndexing({ artworkId: "a1", describeKey: "artworks/x/k-display.jpg", describeImageId: "i2" }, ops, inlineStep);
    expect(calls[0]).toBe("describe:artworks/x/k-display.jpg@i2");
  });
  it("makes missing previews first, then describes the new display preview", async () => {
    const { ops, calls } = fakeOps({ preview: () => made("artworks/x/k-display.webp", true) });
    const { steps, doStep } = recordingStep();
    const r = await runIndexing({ artworkId: "a1", previewImageId: "i1", describePreview: true }, ops, doStep);
    expect(calls).toEqual(["preview:i1", "describe:artworks/x/k-display.webp", "refreshText", "embed", "upsert:2"]);
    expect(steps[0]).toMatchObject({ name: "preview" });
    expect(steps[0].limit).toBeGreaterThan(0);
    expect(r.preview).toBe("made");
  });
  it("a new palette alone refreshes the text; no description unless asked for", async () => {
    const { ops, calls } = fakeOps({ preview: () => made("artworks/x/k-display.webp", true) });
    await runIndexing({ artworkId: "a1", previewImageId: "i1" }, ops, inlineStep);
    expect(calls).toEqual(["preview:i1", "refreshText", "embed", "upsert:2"]);
  });
  it("a preview that can't be made (or keeps failing) skips the description but not the embedding", async () => {
    const skipped = fakeOps({ preview: () => ({ status: "skipped", displayKey: null, paletteChanged: false }) });
    await runIndexing({ artworkId: "a1", previewImageId: "i1", describePreview: true }, skipped.ops, inlineStep);
    expect(skipped.calls).toEqual(["preview:i1", "embed", "upsert:2"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = fakeOps({ preview: () => { throw new Error("Images down"); } });
    const r = await runIndexing({ artworkId: "a1", previewImageId: "i1", describePreview: true }, failing.ops, inlineStep);
    expect(failing.calls).toEqual(["preview:i1", "embed", "upsert:2"]);
    expect(r).toMatchObject({ preview: "skipped", described: false, outcome: "upserted" });
    warn.mockRestore();
  });
  it("moves an old original to Infrequent Access after its preview, when the backfill asks", async () => {
    const { ops, calls } = fakeOps();
    const r = await runIndexing({ artworkId: "a1", previewImageId: "i1", tierOriginalImageId: "i1" }, ops, inlineStep);
    expect(calls.slice(0, 2)).toEqual(["preview:i1", "tier:i1"]);
    expect(r.tiered).toBe("moved");
  });
  it("skips describe without a key, and refresh-text when nothing was written", async () => {
    const a = fakeOps();
    await runIndexing({ artworkId: "a1" }, a.ops, inlineStep);
    expect(a.calls).toEqual(["embed", "upsert:2"]);
    const b = fakeOps({ describe: () => false });
    const r = await runIndexing({ artworkId: "a1", describeKey: "k-display.jpg" }, b.ops, inlineStep);
    expect(b.calls).toEqual(["describe:k-display.jpg", "embed", "upsert:2"]);
    expect(r.described).toBe(false);
  });
  it("a failed description doesn't block the embedding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ops, calls } = fakeOps({ describe: () => { throw new Error("vision down"); } });
    const r = await runIndexing({ artworkId: "a1", describeKey: "k-display.jpg" }, ops, inlineStep);
    expect(calls).toEqual(["describe:k-display.jpg", "embed", "upsert:2"]);
    expect(r).toEqual({ artworkId: "a1", preview: null, tiered: null, described: false, outcome: "upserted" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("a removed piece is never upserted", async () => {
    const { ops, calls } = fakeOps({ embed: () => null });
    const { steps, doStep } = recordingStep();
    expect((await runIndexing({ artworkId: "a1" }, ops, doStep)).outcome).toBe("deleted");
    expect(calls).toEqual(["embed"]);
    expect(steps.map((s) => s.name)).toEqual(["embed"]);
  });
  it("embedding failures propagate so the step (or the request, inline) fails", async () => {
    const { ops } = fakeOps({ embed: () => { throw new Error("AI down"); } });
    await expect(runIndexing({ artworkId: "a1" }, ops, inlineStep)).rejects.toThrow("AI down");
  });
});

describe("coverDescribeParams", () => {
  const work = (o: Partial<CoverFacts> = {}): CoverFacts => ({ id: "i2", kind: "work", display_key: "artworks/x/b-display.jpg", content_type: "image/jpeg", bytes: 1000, ...o });
  it("a new main finished work is described from its display preview", () => {
    expect(coverDescribeParams({ id: "i1", kind: "work" }, work())).toEqual({ describeKey: "artworks/x/b-display.jpg", describeImageId: "i2" });
    expect(coverDescribeParams(null, work())).toEqual({ describeKey: "artworks/x/b-display.jpg", describeImageId: "i2" });
  });
  it("or once the server has made its preview", () => {
    expect(coverDescribeParams({ id: "i1", kind: "work" }, work({ display_key: null, content_type: "image/heic" })))
      .toEqual({ previewImageId: "i2", describePreview: true, describeImageId: "i2" });
  });
  it("the cover relabelled a finished work counts as a new one", () => {
    expect(coverDescribeParams({ id: "i2", kind: "study" }, work())).toEqual({ describeKey: "artworks/x/b-display.jpg", describeImageId: "i2" });
  });
  it("leaves the description alone for the same cover, no cover, a non-work, or no preview to come", () => {
    expect(coverDescribeParams({ id: "i2", kind: "work" }, work())).toEqual({});
    expect(coverDescribeParams({ id: "i1", kind: "work" }, null)).toEqual({});
    expect(coverDescribeParams({ id: "i1", kind: "work" }, work({ kind: "study" }))).toEqual({});
    expect(coverDescribeParams({ id: "i1", kind: "work" }, work({ display_key: null, content_type: "image/tiff" }))).toEqual({});
    expect(coverDescribeParams({ id: "i1", kind: "work" }, work({ display_key: null, bytes: 50 * 1024 * 1024 }))).toEqual({});
  });
});

describe("describeKeyFor", () => {
  it("only ever hands the vision step a display preview", () => {
    expect(describeKeyFor({ artworkId: "a1", describeKey: "artworks/x/k-display.jpg" }, null)).toBe("artworks/x/k-display.jpg");
    expect(describeKeyFor({ artworkId: "a1", describeKey: "artworks/x/k.heic" }, null)).toBeNull();
    expect(describeKeyFor({ artworkId: "a1", describePreview: true }, made("artworks/x/k-display.webp"))).toBe("artworks/x/k-display.webp");
    expect(describeKeyFor({ artworkId: "a1", describePreview: true }, made(null))).toBeNull();
    expect(describeKeyFor({ artworkId: "a1" }, made("artworks/x/k-display.webp"))).toBeNull();
  });
});

describe("startIndexing", () => {
  const params = { artworkId: "a1", describeKey: "k" };
  it("starts the Workflow when bound, without indexing inline", async () => {
    const create = vi.fn(async () => ({}) as WorkflowInstance);
    const inline = vi.fn(async () => {});
    expect(await startIndexing({ create }, params, inline)).toBe("workflow");
    expect(create).toHaveBeenCalledWith({ params });
    expect(inline).not.toHaveBeenCalled();
  });
  it("indexes inline without a binding (local dev)", async () => {
    const inline = vi.fn(async () => {});
    expect(await startIndexing(undefined, params, inline)).toBe("inline");
    expect(inline).toHaveBeenCalledOnce();
  });
  it("falls back to inline when the Workflow won't start", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const inline = vi.fn(async () => {});
    expect(await startIndexing({ create: async () => { throw new Error("quota"); } }, params, inline)).toBe("inline");
    expect(inline).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});

// ----------------------------------------------------------- the describe step against fakes
function describeEnv(o: { row?: DescriptionRow | null; out?: unknown; object?: boolean; embeddings?: string } = {}) {
  const sql: { q: string; args: unknown[] }[] = [];
  const ai: unknown[] = [];
  const DB = {
    prepare: (q: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => { sql.push({ q, args }); return o.row === undefined ? { ai_description: null, ai_description_image_id: null, cover_image_id: "i2", deleted_at: null } : o.row; },
        run: async () => { sql.push({ q, args }); return { meta: { changes: 1 } }; },
      }),
    }),
  };
  const BUCKET = { get: async () => (o.object === false ? null : { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) };
  const AI = { run: async (model: string, input: unknown) => { ai.push({ model, input }); return o.out ?? { description: "A lake at dusk." }; } };
  const env = { DB, BUCKET, AI, EMBEDDINGS: o.embeddings ?? "workers-ai", VISION_MODEL: "@cf/test/vision" } as unknown as Env;
  return { env, sql, ai };
}

describe("describe step", () => {
  const key = "artworks/x/k-display.jpg";
  it("writes a fresh description from the image, credited to it, guarded on the row as read", async () => {
    const { env, sql, ai } = describeEnv();
    expect(await indexOps(env, "a1").describe(key, "i2")).toBe(true);
    expect(ai).toEqual([{ model: "@cf/test/vision", input: expect.objectContaining({ image: [1, 2, 3], max_tokens: 160 }) }]);
    const upd = sql.find((s) => s.q.startsWith("UPDATE"))!;
    expect(upd.args).toEqual(["A lake at dusk.", "i2", "a1", "i2", null, null]);
    expect(upd.q).toMatch(/ai_description_image_id = \?2/);
    expect(upd.q).toMatch(/cover_image_id IS \?4 AND ai_description IS \?5 AND ai_description_image_id IS \?6/);
  });
  it("replaces a machine description written for the previous main image", async () => {
    const { env, sql } = describeEnv({ row: { ai_description: "A mountain road.", ai_description_image_id: "i1", cover_image_id: "i2", deleted_at: null } });
    expect(await indexOps(env, "a1").describe(key, "i2")).toBe(true);
    expect(sql.find((s) => s.q.startsWith("UPDATE"))!.args).toEqual(["A lake at dusk.", "i2", "a1", "i2", "A mountain road.", "i1"]);
  });
  it("does nothing offline, over a person's description, for a cover that moved on, or without the image", async () => {
    const live = { ai_description: null, ai_description_image_id: null, deleted_at: null };
    for (const o of [
      { embeddings: "local" }, { row: { ...live, ai_description: "Mine", cover_image_id: "i2" } }, { row: { ...live, cover_image_id: "i3" } },
      { row: { ...live, ai_description: "Same", ai_description_image_id: "i2", cover_image_id: "i2" } }, { row: null }, { object: false },
    ]) {
      const { env, ai, sql } = describeEnv(o);
      expect(await indexOps(env, "a1").describe(key, "i2")).toBe(false);
      expect(ai).toEqual([]);
      expect(sql.some((s) => s.q.startsWith("UPDATE"))).toBe(false);
    }
  });
  it("throws on an empty answer so the step retries", async () => {
    const { env } = describeEnv({ out: { response: "" } });
    await expect(indexOps(env, "a1").describe(key, "i2")).rejects.toThrow(/no description/);
  });
  it("never reads an original, whatever key it is handed", async () => {
    const { env, ai, sql } = describeEnv();
    expect(await indexOps(env, "a1").describe("artworks/x/k.heic", "i2")).toBe(false);
    expect(ai).toEqual([]);
    expect(sql).toEqual([]);
  });
});
