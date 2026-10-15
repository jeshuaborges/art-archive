import { describe, expect, it } from "vitest";
import { exifDate, iccDescription, jpegQualityFromTable, readTech, resolutionDpi } from "../../worker/techmeta";

/** A little-endian TIFF with its directory at the end of the file, as Photoshop writes them. */
function tiff({ w = 3000, h = 2000, bits = 16, photometric = 2, compression = 5, dpi = 300, pad = 1_000_000 } = {}) {
  const entries: [number, number, number, number][] = [
    [256, 4, 1, w], [257, 4, 1, h], [258, 3, 1, bits], [259, 3, 1, compression], [262, 3, 1, photometric], [277, 3, 1, 3], [296, 3, 1, 2],
  ];
  const ifdAt = 8 + pad, resAt = ifdAt + 2 + (entries.length + 1) * 12 + 4;
  const buf = new Uint8Array(resAt + 8);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]); dv.setUint32(4, ifdAt, true);
  const all = [...entries, [282, 5, 1, resAt] as [number, number, number, number]].sort((a, b) => a[0] - b[0]);
  dv.setUint16(ifdAt, all.length, true);
  all.forEach(([tag, type, count, v], i) => {
    const e = ifdAt + 2 + i * 12;
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
    if (type === 3) dv.setUint16(e + 8, v, true); else dv.setUint32(e + 8, v, true);
  });
  dv.setUint32(resAt, dpi, true); dv.setUint32(resAt + 4, 1, true);
  return buf;
}

describe("reading TIFF headers", () => {
  it("asks for the range holding tags at the end, then reads them", () => {
    const f = tiff();
    const head = { offset: 0, bytes: f.subarray(0, 4096) };
    const first = readTech("image/tiff", [head], f.length);
    expect("need" in first).toBe(true);
    const need = (first as { need: { offset: number; length: number } }).need;
    expect(need.offset).toBe(8 + 1_000_000);
    const second = readTech("image/tiff", [head, { offset: need.offset, bytes: f.subarray(need.offset, need.offset + need.length) }], f.length);
    expect(second).toMatchObject({ tech: { format: "TIFF", width: 3000, height: 2000, bitsPerChannel: 16, colorMode: "RGB", compression: "LZW", lossy: false, dpi: 300 } });
  });
  it("reads CMYK and uncompressed", () => {
    const f = tiff({ photometric: 5, compression: 1, bits: 8, pad: 0 });
    expect(readTech("image/tiff", [{ offset: 0, bytes: f }], f.length)).toMatchObject({ tech: { colorMode: "CMYK", compression: "None", bitsPerChannel: 8 } });
  });
});

describe("reading JPEG headers", () => {
  it("finds size, components, progressive coding and quality", () => {
    const luma = Array(64).fill(1);
    const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xe0, [...[..."JFIF"].map((c) => c.charCodeAt(0)), 0, 1, 2, 1, 0, 240, 0, 240, 0, 0]),
      ...seg(0xdb, [0, ...luma]),
      ...seg(0xc2, [8, 0x07, 0xd0, 0x0b, 0xb8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
      0xff, 0xda, 0, 2,
    ]);
    expect(readTech("image/jpeg", [{ offset: 0, bytes }], bytes.length)).toMatchObject({
      tech: { format: "JPEG", width: 3000, height: 2000, bitsPerChannel: 8, colorMode: "RGB", compression: "Progressive JPEG", lossy: true, jpegQuality: 100, dpi: 240 },
    });
  });
  it("estimates IJG quality from the luminance table", () => {
    const zz = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
    const std = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
    const table = (q: number) => { const s = q < 50 ? 5000 / q : 200 - q * 2; return zz.map((n) => Math.max(1, Math.min(255, Math.floor((std[n] * s + 50) / 100)))); };
    for (const q of [50, 75, 90]) expect(Math.abs(jpegQualityFromTable(table(q))! - q)).toBeLessThanOrEqual(2);
  });
});

describe("small pieces", () => {
  it("reads EXIF dates and resolutions", () => {
    expect(exifDate("2012:06:01 19:16:11")).toBe("2012-06-01T19:16:11");
    expect(exifDate("0000:00:00 00:00:00")).toBeNull();
    expect(resolutionDpi(300, 2)).toBe(300);
    expect(resolutionDpi(118.11, 3)).toBe(300);
    expect(resolutionDpi(72, 1)).toBeNull();
  });
  it("names an ICC profile from a v2 desc tag", () => {
    const p = new Uint8Array(300);
    const dv = new DataView(p.buffer);
    dv.setUint32(128, 1);
    p.set([..."desc"].map((c) => c.charCodeAt(0)), 132); dv.setUint32(136, 200); dv.setUint32(140, 40);
    p.set([..."desc"].map((c) => c.charCodeAt(0)), 200); dv.setUint32(208, 17);
    p.set([..."Adobe RGB (1998)"].map((c) => c.charCodeAt(0)), 212);
    expect(iccDescription(p)).toBe("Adobe RGB (1998)");
  });
  it("treats an unknown type as just its format", () => {
    expect(readTech("application/pdf", [], 10)).toMatchObject({ tech: { format: "application/pdf", width: null } });
  });
});
