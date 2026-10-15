import { describe, expect, it, vi } from "vitest";
import {
  embedText, ftsRow, inlineStep, parseVisionOutput, runIndexing, shouldDescribe, sidecarKey, sidecarRecord, startIndexing, upsertDecision,
  type DoStep, type Embedded, type IndexOps, type UpsertOutcome,
} from "../../worker/indexing";
import { parseFieldDef } from "../../worker/fields";
import { indexOps, type ArtworkDTO, type Env } from "../../worker/store";

const defs = [
  parseFieldDef({ key: "medium", type: "select", label: "Medium", options: JSON.stringify({ choices: ["Oil"], allowNew: true }), required: 0, sort_order: 0, help_text: null, archived_at: null, filterable: 1 }),
  parseFieldDef({ key: "location", type: "text", label: "Where it is", options: "{}", required: 0, sort_order: 1, help_text: null, archived_at: null, filterable: 0 }),
];
const art = (o: Partial<ArtworkDTO> = {}): ArtworkDTO => ({
  id: "a1", catalogId: "2020-001", title: "Soda Lake", yearStart: 2021, yearEnd: null, circa: false, status: "sold",
  attrs: { medium: "Oil", location: "Hallway" }, palette: ["#7B3A8E", "#E0A030"], aiDescription: null, coverImageId: null, version: 3,
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
      original: `/img/artworks/2020-001/${id}.jpg`, display: null, thumb: null,
    });
    const rec = sidecarRecord(art({ archivedAt: "2026-10-01", archivedBy: "anne@x", images: [image("k1", null), image("k2", "2026-10-02")] as ArtworkDTO["images"] }), defs, {});
    expect(rec.archived).toEqual({ at: "2026-10-01", by: "anne@x" });
    expect(rec.images).toHaveLength(2);
    expect(rec.images[0]).not.toHaveProperty("archived");
    expect(rec.images[1]).toMatchObject({ file: "k2.jpg", archived: { at: "2026-10-02", by: "anne@x" } });
  });
});

describe("vision decisions", () => {
  const row = { ai_description: null, deleted_at: null };
  it("describes only with a key, Workers AI, a live piece and no description yet", () => {
    expect(shouldDescribe({ describeKey: "k", visionReady: true, row })).toBe(true);
    expect(shouldDescribe({ describeKey: undefined, visionReady: true, row })).toBe(false);
    expect(shouldDescribe({ describeKey: "k", visionReady: false, row })).toBe(false);
    expect(shouldDescribe({ describeKey: "k", visionReady: true, row: null })).toBe(false);
    expect(shouldDescribe({ describeKey: "k", visionReady: true, row: { ...row, deleted_at: "2026" } })).toBe(false);
    expect(shouldDescribe({ describeKey: "k", visionReady: true, row: { ...row, ai_description: "Typed by hand" } })).toBe(false);
    expect(shouldDescribe({ describeKey: "k", visionReady: true, row: { ...row, ai_description: "  " } })).toBe(true);
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
function fakeOps(o: Partial<Record<keyof IndexOps, () => unknown>> = {}) {
  const calls: string[] = [];
  const vec: Embedded = { text: "t", vec: [0.1, 0.2] };
  const ops: IndexOps = {
    describe: async (key) => { calls.push(`describe:${key}`); return (o.describe ? o.describe() : true) as boolean; },
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
    const r = await runIndexing({ artworkId: "a1", describeKey: "artworks/x/k.jpg" }, ops, doStep);
    expect(calls).toEqual(["describe:artworks/x/k.jpg", "refreshText", "embed", "upsert:2"]);
    expect(steps.map((s) => s.name)).toEqual(["describe", "refresh-text", "embed", "upsert"]);
    expect(steps.every((s) => (s.limit ?? 0) > 0)).toBe(true);
    expect(r).toEqual({ artworkId: "a1", described: true, outcome: "upserted" });
  });
  it("skips describe without a key, and refresh-text when nothing was written", async () => {
    const a = fakeOps();
    await runIndexing({ artworkId: "a1" }, a.ops, inlineStep);
    expect(a.calls).toEqual(["embed", "upsert:2"]);
    const b = fakeOps({ describe: () => false });
    const r = await runIndexing({ artworkId: "a1", describeKey: "k" }, b.ops, inlineStep);
    expect(b.calls).toEqual(["describe:k", "embed", "upsert:2"]);
    expect(r.described).toBe(false);
  });
  it("a failed description doesn't block the embedding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ops, calls } = fakeOps({ describe: () => { throw new Error("vision down"); } });
    const r = await runIndexing({ artworkId: "a1", describeKey: "k" }, ops, inlineStep);
    expect(calls).toEqual(["describe:k", "embed", "upsert:2"]);
    expect(r).toEqual({ artworkId: "a1", described: false, outcome: "upserted" });
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
function describeEnv(o: { row?: { ai_description: string | null; deleted_at: string | null } | null; out?: unknown; object?: boolean; embeddings?: string } = {}) {
  const sql: { q: string; args: unknown[] }[] = [];
  const ai: unknown[] = [];
  const DB = {
    prepare: (q: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => { sql.push({ q, args }); return o.row === undefined ? { ai_description: null, deleted_at: null } : o.row; },
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
  it("writes a fresh description from the image, only into an empty field", async () => {
    const { env, sql, ai } = describeEnv();
    expect(await indexOps(env, "a1").describe("artworks/x/k-display.jpg")).toBe(true);
    expect(ai).toEqual([{ model: "@cf/test/vision", input: expect.objectContaining({ image: [1, 2, 3], max_tokens: 160 }) }]);
    const upd = sql.find((s) => s.q.startsWith("UPDATE"))!;
    expect(upd.args).toEqual(["A lake at dusk.", "a1"]);
    expect(upd.q).toMatch(/ai_description IS NULL/);
  });
  it("does nothing offline, over an existing description, or without the image", async () => {
    for (const o of [{ embeddings: "local" }, { row: { ai_description: "Mine", deleted_at: null } }, { row: null }, { object: false }]) {
      const { env, ai, sql } = describeEnv(o);
      expect(await indexOps(env, "a1").describe("k")).toBe(false);
      expect(ai).toEqual([]);
      expect(sql.some((s) => s.q.startsWith("UPDATE"))).toBe(false);
    }
  });
  it("throws on an empty answer so the step retries", async () => {
    const { env } = describeEnv({ out: { response: "" } });
    await expect(indexOps(env, "a1").describe("k")).rejects.toThrow(/no description/);
  });
});
