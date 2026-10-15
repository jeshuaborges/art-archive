import { describe, expect, it } from "vitest";
import {
  checkFetchUrl, decodeBase64, filenameFromUrl, imageForm, isPrivateHost, MAX_BASE64_CHARS, parseAddImageArgs, parseArchiveArtworksArgs,
  parseArchiveImageArgs,
} from "../../worker/tools";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("add_image arguments", () => {
  it("decodes base64, plain or as a data: URL", () => {
    const bytes = decodeBase64(PNG_B64)!;
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(decodeBase64(`data:image/png;base64,${PNG_B64}`)).toEqual(bytes);
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64("")).toBeNull();
  });
  it("reads a base64 upload with its details", () => {
    const p = parseAddImageArgs({ artworkId: "2019-001", kind: "study", caption: " sketch ", base64: PNG_B64, filename: "a.png", contentType: "image/png" });
    expect(p.ok).toBe(true);
    if (!p.ok || p.value.source.from !== "bytes") throw new Error("expected bytes");
    expect(p.value.artworkId).toBe("2019-001");
    expect(p.value.meta).toEqual({ kind: "study", caption: "sketch", makeCover: false });
    expect(p.value.source.file.filename).toBe("a.png");
    expect(p.value.source.file.contentType).toBe("image/png");
  });
  it("defaults the file name and type", () => {
    const p = parseAddImageArgs({ artworkId: "x", kind: "work", base64: PNG_B64, makeCover: true });
    if (!p.ok || p.value.source.from !== "bytes") throw new Error("expected bytes");
    expect(p.value.source.file).toMatchObject({ filename: "upload", contentType: "application/octet-stream" });
    expect(p.value.meta.makeCover).toBe(true);
  });
  it("reads a url upload", () => {
    const p = parseAddImageArgs({ artworkId: "x", kind: "reference", url: "https://example.com/photos/sea.jpg" });
    if (!p.ok || p.value.source.from !== "url") throw new Error("expected url");
    expect(p.value.source.url.hostname).toBe("example.com");
  });
  it("wants exactly one source, a known kind and nothing extra", () => {
    const fail = (a: unknown) => { const p = parseAddImageArgs(a); return p.ok ? null : p; };
    expect(fail({ artworkId: "x", kind: "work" })?.message).toMatch(/exactly one of base64 or url/);
    expect(fail({ artworkId: "x", kind: "work", base64: PNG_B64, url: "https://example.com/a.jpg" })?.message).toMatch(/exactly one/);
    expect(fail({ artworkId: "x", kind: "painting", base64: PNG_B64 })?.message).toMatch(/kind/);
    expect(fail({ kind: "work", base64: PNG_B64 })?.message).toMatch(/artworkId/);
    expect(fail({ artworkId: "x", kind: "work", base64: PNG_B64, display: "..." })?.status).toBe(400);
    expect(fail({ artworkId: "x", kind: "work", base64: "@@@" })?.message).toMatch(/not valid base64/);
    expect(fail({ artworkId: "x", kind: "work", url: "file:///etc/passwd" })?.message).toMatch(/http and https/);
    expect(fail({ artworkId: "x", kind: "work", url: "http://127.0.0.1/a.jpg" })?.message).toMatch(/private or local/);
  });
  it("refuses base64 longer than the upload limit before decoding it", () => {
    const p = parseAddImageArgs({ artworkId: "x", kind: "work", base64: "A".repeat(MAX_BASE64_CHARS + 4) });
    expect(p).toMatchObject({ ok: false, status: 413 });
  });
});

describe("fetching by url", () => {
  it("tells private and local hosts from public ones", () => {
    for (const h of ["localhost", "app.localhost", "printer.local", "db.internal", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "[::1]", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "192.169.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateHost(h), h).toBe(false);
  });
  it("allows public http(s) URLs only", () => {
    expect(checkFetchUrl("https://example.com/a.jpg")).toBeInstanceOf(URL);
    expect(checkFetchUrl("http://example.com/a.jpg")).toBeInstanceOf(URL);
    expect(checkFetchUrl("ftp://example.com/a.jpg")).toMatch(/http and https/);
    expect(checkFetchUrl("https://user:pw@example.com/a.jpg")).toMatch(/credentials/);
    expect(checkFetchUrl("http://2130706433/")).toMatch(/private/); // 127.0.0.1 in decimal
    expect(checkFetchUrl("http://[::1]:8787/")).toMatch(/private/);
    expect(checkFetchUrl("nope")).toMatch(/not a valid URL/);
  });
  it("names a fetched file after the URL's path", () => {
    expect(filenameFromUrl(new URL("https://example.com/photos/sea%20view.jpg?x=1"))).toBe("sea view.jpg");
    expect(filenameFromUrl(new URL("https://example.com/"))).toBe("download");
  });
});

describe("the upload form", () => {
  it("carries the original and its details, and no previews", async () => {
    const bytes = decodeBase64(PNG_B64)!;
    const form = imageForm({ bytes, filename: "a.png", contentType: "image/png" }, { kind: "work", caption: "c", makeCover: true });
    const original = form.get("original") as File;
    expect(original.name).toBe("a.png");
    expect(original.type).toBe("image/png");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes);
    expect(JSON.parse(String(form.get("meta")))).toEqual({ kind: "work", caption: "c", makeCover: true });
    expect(form.has("display")).toBe(false);
    expect(form.has("thumb")).toBe(false);
  });
});

describe("archive arguments", () => {
  it("archives by default and can bring back", () => {
    expect(parseArchiveArtworksArgs({ ids: ["a", "2019-001"] })).toEqual({ ok: true, value: { ids: ["a", "2019-001"], archived: true } });
    expect(parseArchiveArtworksArgs({ ids: ["a"], archived: false })).toEqual({ ok: true, value: { ids: ["a"], archived: false } });
    expect(parseArchiveImageArgs({ imageId: " i1 " })).toEqual({ ok: true, value: { imageId: "i1", archived: true } });
  });
  it("rejects empty or malformed requests", () => {
    expect(parseArchiveArtworksArgs({ ids: [] }).ok).toBe(false);
    expect(parseArchiveArtworksArgs({}).ok).toBe(false);
    expect(parseArchiveArtworksArgs({ ids: ["a"], archived: "yes" }).ok).toBe(false);
    expect(parseArchiveArtworksArgs({ ids: Array.from({ length: 501 }, (_, i) => `id${i}`) }).ok).toBe(false);
    expect(parseArchiveImageArgs({}).ok).toBe(false);
    expect(parseArchiveImageArgs(undefined).ok).toBe(false);
  });
});
