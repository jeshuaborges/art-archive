import { describe, expect, it, vi } from "vitest";
import {
  describeSource, downloadDisposition, imgAccess, keyRole, MAX_PREVIEW_SOURCE, needsPreview, orientedSize, paletteFromRgb, previewKey, previewPlan, previewState,
  previewTransform, servedKey, serverPreviewable, storageClassFor,
} from "../../worker/media";
import { indexOps, type Env } from "../../worker/store";

const row = (o: Partial<{ r2_key: string; display_key: string | null; thumb_key: string | null; content_type: string; bytes: number }> = {}) => ({
  r2_key: "artworks/2020-001/abc.heic", display_key: null, thumb_key: null, content_type: "image/heic", bytes: 3_000_000, ...o,
});
const withPreviews = row({ r2_key: "artworks/2020-001/abc.jpg", display_key: "artworks/2020-001/abc-display.jpg", thumb_key: "artworks/2020-001/abc-thumb.jpg", content_type: "image/jpeg" });

describe("storage classes", () => {
  it("puts originals in Infrequent Access and everything read routinely in Standard", () => {
    expect(storageClassFor("original")).toBe("InfrequentAccess");
    for (const r of ["display", "thumb", "sidecar", "backup"] as const) expect(storageClassFor(r)).toBe("Standard");
  });
  it("tells an object's role from its key", () => {
    expect(keyRole("artworks/2020-001/abc.jpg")).toBe("original");
    expect(keyRole("artworks/2020-001/abc.heic")).toBe("original");
    expect(keyRole("artworks/2020-001/abc-display.jpg")).toBe("display");
    expect(keyRole("artworks/2020-001/abc-display.webp")).toBe("display");
    expect(keyRole("artworks/2020-001/abc-thumb.webp")).toBe("thumb");
    expect(keyRole("artworks/2020-001/record.json")).toBe("sidecar");
  });
  it("sends originals only as downloads", () => {
    expect(imgAccess("artworks/2020-001/abc.jpg", false)).toBe("download-only");
    expect(imgAccess("artworks/2020-001/abc.jpg", true)).toBe("serve");
    expect(imgAccess("artworks/2020-001/abc-display.jpg", false)).toBe("serve");
    expect(imgAccess("artworks/2020-001/abc-thumb.jpg", false)).toBe("serve");
    expect(imgAccess("artworks/2020-001/record.json", false)).toBe("serve");
  });
});

describe("which key serves what", () => {
  it("serves previews in the app and the original only for download", () => {
    expect(servedKey(withPreviews, "display")).toBe("artworks/2020-001/abc-display.jpg");
    expect(servedKey(withPreviews, "thumb")).toBe("artworks/2020-001/abc-thumb.jpg");
    expect(servedKey(withPreviews, "download")).toBe("artworks/2020-001/abc.jpg");
  });
  it("never falls back to the original for display or thumb", () => {
    expect(servedKey(row(), "display")).toBeNull();
    expect(servedKey(row(), "thumb")).toBeNull();
    // a thumb may use the display preview (both Standard)
    expect(servedKey(row({ display_key: "k-display.jpg" }), "thumb")).toBe("k-display.jpg");
  });
  it("reports whether a preview is ready, coming, or never coming", () => {
    expect(previewState(withPreviews)).toBe("ready");
    expect(previewState(row())).toBe("pending");
    expect(previewState(row({ content_type: "image/tiff", r2_key: "a/b.tif" }))).toBe("unavailable");
    expect(previewState(row({ bytes: MAX_PREVIEW_SOURCE + 1 }))).toBe("unavailable");
  });
});

describe("making previews on the server", () => {
  it("is needed when either phone-made preview is missing", () => {
    expect(needsPreview(withPreviews)).toBe(false);
    expect(needsPreview(row())).toBe(true);
    expect(needsPreview(row({ display_key: "d" }))).toBe(true);
  });
  it("covers what Cloudflare Images can read, up to its 20 MB input", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]) expect(serverPreviewable({ contentType: t, bytes: 1000 })).toBe(true);
    for (const t of ["image/tiff", "image/avif"]) expect(serverPreviewable({ contentType: t, bytes: 1000 })).toBe(false);
    expect(serverPreviewable({ contentType: "image/heic", bytes: MAX_PREVIEW_SOURCE })).toBe(true);
    expect(serverPreviewable({ contentType: "image/heic", bytes: MAX_PREVIEW_SOURCE + 1 })).toBe(false);
  });
  it("plans from the original only when the display preview is missing", () => {
    expect(previewPlan(withPreviews, true)).toEqual({ kind: "ready" });
    expect(previewPlan(row(), false)).toEqual({ kind: "skip", reason: "no-binding" });
    expect(previewPlan(row(), true)).toEqual({ kind: "make", source: "original", make: ["display", "thumb"] });
    expect(previewPlan(row({ display_key: "d" }), true)).toEqual({ kind: "make", source: "display", make: ["thumb"] });
    expect(previewPlan(row({ thumb_key: "t" }), true)).toEqual({ kind: "make", source: "original", make: ["display"] });
    expect(previewPlan(row({ content_type: "image/tiff" }), true)).toEqual({ kind: "skip", reason: "unsupported" });
    expect(previewPlan(row({ bytes: MAX_PREVIEW_SOURCE + 1 }), true)).toEqual({ kind: "skip", reason: "too-large" });
    // a big TIFF can still get a thumb from a phone-made display preview
    expect(previewPlan(row({ content_type: "image/tiff", bytes: 90e6, display_key: "d" }), true)).toMatchObject({ kind: "make", source: "display" });
  });
  it("uses the phone's sizes, as WebP, fitted inside and never enlarged", () => {
    expect(previewTransform("display")).toEqual({ transform: { width: 1800, height: 1800, fit: "scale-down" }, output: { format: "image/webp", quality: 86 } });
    expect(previewTransform("thumb")).toEqual({ transform: { width: 560, height: 560, fit: "scale-down" }, output: { format: "image/webp", quality: 80 } });
  });
  it("puts previews next to the original, as the phone's would be", () => {
    expect(previewKey("artworks/2020-001/abc.heic", "display")).toBe("artworks/2020-001/abc-display.webp");
    expect(previewKey("artworks/2020-001/abc.heic", "thumb")).toBe("artworks/2020-001/abc-thumb.webp");
  });
  it("orients the original's size like its preview", () => {
    expect(orientedSize({ width: 4032, height: 3024 }, { width: 1800, height: 1350 })).toEqual({ width: 4032, height: 3024 });
    expect(orientedSize({ width: 4032, height: 3024 }, { width: 1350, height: 1800 })).toEqual({ width: 3024, height: 4032 });
    expect(orientedSize({ width: 4032, height: 3024 }, null)).toEqual({ width: 4032, height: 3024 });
    expect(orientedSize(null, { width: 1350, height: 1800 })).toBeNull();
  });
  it("reads a palette from raw RGB", () => {
    const red = Array.from({ length: 40 }, () => [200, 40, 30]).flat(), blue = Array.from({ length: 20 }, () => [20, 60, 200]).flat();
    expect(paletteFromRgb(new Uint8Array([...red, ...blue]))).toEqual(["#C8281E", "#143CC8"]);
    expect(paletteFromRgb(new Uint8Array([]))).toEqual([]);
  });
});

describe("vision source", () => {
  it("is a display preview or nothing", () => {
    expect(describeSource("artworks/2020-001/abc-display.webp")).toBe("artworks/2020-001/abc-display.webp");
    expect(describeSource("artworks/2020-001/abc.heic")).toBeNull();
    expect(describeSource("artworks/2020-001/abc-thumb.webp")).toBeNull();
    expect(describeSource(null)).toBeNull();
  });
});

// ----------------------------------------------------------- the preview and tier steps against fakes

function mediaEnv(o: { image?: Record<string, unknown> | null; storageClass?: string; imagesBound?: boolean } = {}) {
  const puts: { key: string; bytes: number; opts: R2PutOptions }[] = [];
  const reads: string[] = [];
  const sql: { q: string; args: unknown[] }[] = [];
  const transforms: unknown[] = [];
  const image = o.image === undefined
    ? { id: "i1", artwork_id: "a1", r2_key: "artworks/2020-001/abc.heic", display_key: null, thumb_key: null, content_type: "image/heic", bytes: 3_000_000, palette: "[]", width: null, height: null }
    : o.image;
  const DB = {
    prepare: (q: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => { sql.push({ q, args }); return image; },
        run: async () => { sql.push({ q, args }); return { meta: { changes: 1 } }; },
      }),
    }),
  };
  const body = (n: number) => new Response(new Uint8Array(n)).body!;
  const BUCKET = {
    head: async (key: string) => ({ key, etag: "e1", storageClass: o.storageClass ?? "Standard" }),
    get: async (key: string) => { reads.push(key); return { size: 64, body: body(64), httpMetadata: { contentType: "image/heic" }, customMetadata: { originalName: "IMG_1.HEIC" }, arrayBuffer: async () => new ArrayBuffer(64) }; },
    put: async (key: string, value: ArrayBuffer | ReadableStream, opts: R2PutOptions) => {
      const bytes = value instanceof ArrayBuffer ? value.byteLength : (await new Response(value).arrayBuffer()).byteLength;
      puts.push({ key, bytes, opts }); return { key };
    },
  };
  // a stand-in for Cloudflare Images: output size follows the requested box; info reports 4032×3024
  const IMAGES = {
    info: async (s: ReadableStream) => { await new Response(s).arrayBuffer(); return { format: "image/heic", fileSize: 64, width: 4032, height: 3024 }; },
    input: (s: ReadableStream) => {
      const chain: Record<string, unknown>[] = [];
      const t = {
        transform: (x: Record<string, unknown>) => { chain.push(x); return t; },
        output: async (out: Record<string, unknown>) => {
          await new Response(s).arrayBuffer();
          transforms.push({ chain, out });
          const n = out.format === "rgb" ? 48 * 48 * 3 : (chain[0].width as number) / 10;
          return { image: () => new Response(out.format === "rgb" ? new Uint8Array(n).fill(200) : new Uint8Array(n)).body!, contentType: () => String(out.format) };
        },
      };
      return t;
    },
  };
  const env = { DB, BUCKET, ...(o.imagesBound === false ? {} : { IMAGES }) } as unknown as Env;
  return { env, puts, reads, sql, transforms };
}

describe("preview step", () => {
  it("renders display and thumb from the original once, writes them Standard, and records them", async () => {
    const { env, puts, reads, sql, transforms } = mediaEnv();
    const r = await indexOps(env, "a1").preview("i1");
    expect(r).toEqual({ status: "made", displayKey: "artworks/2020-001/abc-display.webp", paletteChanged: true });
    expect(reads).toEqual(["artworks/2020-001/abc.heic"]);
    expect(puts.map((p) => [p.key, p.opts.storageClass, (p.opts.httpMetadata as R2HTTPMetadata).contentType])).toEqual([
      ["artworks/2020-001/abc-display.webp", "Standard", "image/webp"],
      ["artworks/2020-001/abc-thumb.webp", "Standard", "image/webp"],
    ]);
    expect(transforms.slice(0, 2)).toMatchObject([
      { chain: [{ width: 1800, height: 1800, fit: "scale-down" }], out: { format: "image/webp", quality: 86 } },
      { chain: [{ width: 560, height: 560, fit: "scale-down" }], out: { format: "image/webp", quality: 80 } },
    ]);
    const upd = sql.find((s) => s.q.startsWith("UPDATE images"))!;
    expect(upd.args.slice(0, 4)).toEqual(["artworks/2020-001/abc-display.webp", "artworks/2020-001/abc-thumb.webp", 4032, 3024]);
    expect(JSON.parse(upd.args[4] as string)).toEqual(["#C8C8C8"]);
    expect(sql.some((s) => s.q.startsWith("UPDATE artworks SET palette"))).toBe(true);
  });
  it("does nothing without the Images binding (local dev) or when the previews exist", async () => {
    const dev = mediaEnv({ imagesBound: false });
    expect((await indexOps(dev.env, "a1").preview("i1")).status).toBe("skipped");
    expect(dev.reads).toEqual([]);
    const ready = mediaEnv({ image: { id: "i1", r2_key: "a/b.jpg", display_key: "a/b-display.jpg", thumb_key: "a/b-thumb.jpg", content_type: "image/jpeg", bytes: 10, palette: "[]" } });
    expect(await indexOps(ready.env, "a1").preview("i1")).toEqual({ status: "ready", displayKey: "a/b-display.jpg", paletteChanged: false });
    expect(ready.puts).toEqual([]);
  });
  it("makes a missing thumb from the display preview, not the original", async () => {
    const { env, reads, puts } = mediaEnv({ image: { id: "i1", r2_key: "a/b.tif", display_key: "a/b-display.jpg", thumb_key: null, content_type: "image/tiff", bytes: 90e6, palette: "[\"#000000\"]" } });
    expect((await indexOps(env, "a1").preview("i1")).status).toBe("made");
    expect(reads).toEqual(["a/b-display.jpg"]);
    expect(puts.map((p) => p.key)).toEqual(["a/b-thumb.webp"]);
  });
  it("is gone for a removed image", async () => {
    const { env } = mediaEnv({ image: null });
    expect((await indexOps(env, "a1").preview("i1")).status).toBe("gone");
  });
});

describe("tier step (backfill)", () => {
  // the Workers runtime's FixedLengthStream, as a plain pass-through
  vi.stubGlobal("FixedLengthStream", class extends TransformStream { constructor(_n: number) { super(); } });
  it("rewrites a Standard original in Infrequent Access, keeping its metadata", async () => {
    const { env, puts } = mediaEnv();
    expect(await indexOps(env, "a1").tierOriginal("i1")).toBe("moved");
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ key: "artworks/2020-001/abc.heic", bytes: 64, opts: { storageClass: "InfrequentAccess", customMetadata: { originalName: "IMG_1.HEIC" } } });
  });
  it("leaves one already in Infrequent Access alone", async () => {
    const { env, puts, reads } = mediaEnv({ storageClass: "InfrequentAccess" });
    expect(await indexOps(env, "a1").tierOriginal("i1")).toBe("already");
    expect(puts).toEqual([]);
    expect(reads).toEqual([]);
  });
});

describe("download names", () => {
  it("saves under the name the file arrived with, keeping the stored extension", () => {
    expect(downloadDisposition("OP 691 Desert Devotions.tif", "artworks/2005-001/abc.tif"))
      .toBe(`attachment; filename="OP 691 Desert Devotions.tif"; filename*=UTF-8''OP%20691%20Desert%20Devotions.tif`);
    expect(downloadDisposition("IMG_0001.JPG", "artworks/2005-001/abc.jpg")).toContain(`filename="IMG_0001.jpg"`);
  });
  it("keeps accents for browsers that read UTF-8 names, with an ASCII fallback", () => {
    const d = downloadDisposition("AC 1225 L'Opède.jpg", "artworks/x/abc.jpg");
    expect(d).toContain(`filename="AC 1225 L'Opede.jpg"`);
    expect(d).toContain("filename*=UTF-8''AC%201225%20L%27Op%C3%A8de.jpg");
  });
  it("falls back to the stored name and strips anything that could break the header", () => {
    expect(downloadDisposition(undefined, "artworks/x/abc.tif")).toContain(`filename="abc.tif"`);
    expect(downloadDisposition('a"b\\c.tif', "artworks/x/abc.tif")).toContain(`filename="a b c.tif"`);
  });
});
