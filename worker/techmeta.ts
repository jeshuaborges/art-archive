/**
 * Technical metadata: what an original file is, read from its headers. This is
 * the functional core: given the bytes it has been shown (a sparse set of
 * chunks), it returns the metadata or the byte range it still needs. TIFFs often
 * keep their tags at the end of the file, so the shell (store.ts) reads the head
 * of the original, then any range asked for, without fetching the whole file
 * from Infrequent Access.
 *
 * Covers what matters for reprints: pixel size, bits per channel, colour mode,
 * embedded ICC profile, tagged resolution, compression (and an estimate of JPEG
 * quality), and the camera or scanner that made it.
 */

export interface Tech {
  format: string;
  width: number | null;
  height: number | null;
  bitsPerChannel: number | null;
  colorMode: string | null;
  hasAlpha: boolean;
  iccProfile: string | null;
  dpi: number | null;
  compression: string | null;
  lossy: boolean | null;
  /** Estimated from the luminance quantisation table (IJG scale), JPEG only. */
  jpegQuality: number | null;
  camera: string | null;
  software: string | null;
  capturedAt: string | null;
  orientation: number | null;
  /** Photoshop files: how many layers (0 = flattened). */
  layers?: number | null;
}

export interface Chunk { offset: number; bytes: Uint8Array }
export interface Range { offset: number; length: number }
export type TechRead = { tech: Tech } | { need: Range };

/** How much of the head the shell reads first, and the least it reads after that. */
export const HEAD_BYTES = 512 * 1024;
// generous: some cameras put megabytes of maker data ahead of a JPEG's frame header (Nikon's APP10 blocks)
export const MIN_READ = 1024 * 1024;
/** How many follow-up reads the shell may make for one file. */
export const MAX_READS = 12;

class Need { constructor(public range: Range) {} }

/** The chunks read so far, addressed as one file. A read outside them asks for more. */
class Bytes {
  constructor(private chunks: Chunk[], public size: number) {}
  private find(off: number, len: number): Chunk {
    if (off < 0 || len < 0 || off + len > this.size) throw new RangeError("read past the end of the file");
    const c = this.chunks.find((c) => off >= c.offset && off + len <= c.offset + c.bytes.length);
    if (!c) throw new Need({ offset: off, length: Math.min(this.size - off, Math.max(len, MIN_READ)) });
    return c;
  }
  slice(off: number, len: number): Uint8Array { const c = this.find(off, len); return c.bytes.subarray(off - c.offset, off - c.offset + len); }
  u8(off: number) { return this.slice(off, 1)[0]; }
  u16(off: number, le: boolean) { const b = this.slice(off, 2); return le ? b[0] | (b[1] << 8) : (b[0] << 8) | b[1]; }
  u32(off: number, le: boolean) { const b = this.slice(off, 4); return (le ? (b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 2 ** 24 : ((b[1] << 16) | (b[2] << 8) | b[3]) + b[0] * 2 ** 24); }
  ascii(off: number, len: number) { return latin1(this.slice(off, len)); }
}

const latin1 = (b: Uint8Array) => { let s = ""; for (const c of b) s += String.fromCharCode(c); return s; };
const clean = (s: string | null | undefined) => { const t = (s ?? "").replace(/\0+$/g, "").replace(/[\0-\x1f]/g, " ").trim(); return t || null; };

const empty = (format: string): Tech => ({
  format, width: null, height: null, bitsPerChannel: null, colorMode: null, hasAlpha: false, iccProfile: null, dpi: null,
  compression: null, lossy: null, jpegQuality: null, camera: null, software: null, capturedAt: null, orientation: null,
});

/**
 * Read what the chunks show. `size` is the whole file's length. Returns the
 * metadata, or the range to read next (the shell adds it and asks again).
 */
export function readTech(contentType: string, chunks: Chunk[], size: number): TechRead {
  const b = new Bytes(chunks, size);
  try {
    switch (contentType) {
      case "image/tiff": return { tech: readTiff(b) };
      case "image/jpeg": return { tech: readJpeg(b) };
      case "image/png": return { tech: readPng(b) };
      case "image/webp": return { tech: readWebp(b) };
      case "image/gif": return { tech: readGif(b) };
      case "image/vnd.adobe.photoshop": return { tech: readPsd(b) };
      case "image/heic": case "image/heif": return { tech: { ...empty("HEIF"), compression: "HEVC", lossy: true } };
      case "image/avif": return { tech: { ...empty("AVIF"), compression: "AV1", lossy: true } };
      default: return { tech: empty(contentType) };
    }
  } catch (e) {
    if (e instanceof Need) return { need: e.range };
    throw e;
  }
}

// ----------------------------------------------------------- TIFF (and EXIF)
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
interface Entry { tag: number; type: number; count: number; at: number }

/** One IFD's entries; `base` is where the TIFF header starts (non-zero inside a JPEG's EXIF). */
function ifd(b: Bytes, base: number, off: number, le: boolean): Entry[] {
  const n = b.u16(base + off, le);
  if (n > 2000) throw new Error("not a TIFF directory");
  const out: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const e = base + off + 2 + i * 12;
    const tag = b.u16(e, le), type = b.u16(e + 2, le), count = b.u32(e + 4, le);
    const bytes = (TYPE_SIZE[type] ?? 1) * count;
    out.push({ tag, type, count, at: bytes <= 4 ? e + 8 : base + b.u32(e + 8, le) });
  }
  return out;
}
function nums(b: Bytes, e: Entry, le: boolean, max = 16): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(e.count, max); i++) {
    if (e.type === 3) out.push(b.u16(e.at + i * 2, le));
    else if (e.type === 4 || e.type === 9) out.push(b.u32(e.at + i * 4, le));
    else if (e.type === 5 || e.type === 10) { const d = b.u32(e.at + i * 8 + 4, le); out.push(d ? b.u32(e.at + i * 8, le) / d : 0); }
    else out.push(b.u8(e.at + i));
  }
  return out;
}
const str = (b: Bytes, e: Entry | undefined) => (e && e.type === 2 ? clean(b.ascii(e.at, Math.min(e.count, 200))) : null);
const num = (b: Bytes, e: Entry | undefined, le: boolean) => (e ? nums(b, e, le, 1)[0] ?? null : null);

const TIFF_COMPRESSION: Record<number, [string, boolean]> = {
  1: ["None", false], 2: ["CCITT", false], 3: ["CCITT", false], 4: ["CCITT", false], 5: ["LZW", false], 6: ["JPEG", true], 7: ["JPEG", true],
  8: ["ZIP", false], 32946: ["ZIP", false], 32773: ["PackBits", false], 34712: ["JPEG 2000", true], 50001: ["WebP", true],
};
const PHOTOMETRIC: Record<number, string> = { 0: "Grayscale", 1: "Grayscale", 2: "RGB", 3: "Indexed", 4: "Mask", 5: "CMYK", 6: "YCbCr", 8: "Lab", 9: "Lab", 10: "Lab" };

/** Date "2012:06:01 19:16:11" as ISO, or null. */
export function exifDate(s: string | null): string | null {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m && m[1] !== "0000" ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}
const camera = (make: string | null, model: string | null) =>
  model ? (make && !model.toLowerCase().startsWith(make.split(" ")[0].toLowerCase()) ? `${make.split(" ")[0]} ${model}` : model) : make;

/** The TIFF structure at `base` (a .tif file, or the EXIF block in a JPEG). */
function tiffTags(b: Bytes, base: number) {
  const order = b.ascii(base, 2);
  if (order !== "II" && order !== "MM") throw new Error("not TIFF");
  const le = order === "II";
  if (b.u16(base + 2, le) !== 42) throw new Error("not TIFF (or BigTIFF)");
  const entries = ifd(b, base, b.u32(base + 4, le), le);
  const get = (t: number) => entries.find((e) => e.tag === t);
  const exifPtr = get(34665);
  const exif = exifPtr ? ifd(b, base, nums(b, exifPtr, le, 1)[0], le) : [];
  return { le, get, exif: (t: number) => exif.find((e) => e.tag === t) };
}

function readTiff(b: Bytes): Tech {
  const { le, get, exif } = tiffTags(b, 0);
  const bits = get(258) ? nums(b, get(258)!, le) : [1];
  const samples = num(b, get(277), le) ?? 1;
  const extra = get(338) ? nums(b, get(338)!, le) : [];
  const [comp, lossy] = TIFF_COMPRESSION[num(b, get(259), le) ?? 1] ?? ["Other", null];
  const icc = get(34675);
  const make = str(b, get(271)), model = str(b, get(272));
  return {
    format: "TIFF",
    width: num(b, get(256), le), height: num(b, get(257), le),
    bitsPerChannel: bits[0] ?? null,
    colorMode: PHOTOMETRIC[num(b, get(262), le) ?? -1] ?? null,
    hasAlpha: extra.some((x) => x === 1 || x === 2) || (num(b, get(262), le) === 2 && samples === 4),
    iccProfile: icc ? iccDescription(b.slice(icc.at, icc.count)) : null,
    dpi: resolutionDpi(num(b, get(282), le), num(b, get(296), le)),
    compression: comp, lossy,
    jpegQuality: null,
    camera: camera(make, model),
    software: str(b, get(305)),
    capturedAt: exifDate(str(b, exif(36867)) || str(b, get(306))),
    orientation: num(b, get(274), le),
  };
}

/** Pixels per inch from a resolution and its unit (2 inch, 3 cm); null when it says nothing useful. */
export function resolutionDpi(res: number | null, unit: number | null): number | null {
  if (!res || res <= 1) return null;
  if (unit === 1) return null;
  return Math.round(unit === 3 ? res * 2.54 : res);
}

// ----------------------------------------------------------- ICC
/** The profile's name from its 'desc' tag (v2 text or v4 multi-language), else its colour space. */
export function iccDescription(p: Uint8Array): string | null {
  if (p.length < 132) return null;
  const be32 = (o: number) => (o + 4 <= p.length ? ((p[o] << 24) >>> 0) + ((p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3]) : 0);
  const sig = (o: number) => latin1(p.subarray(o, o + 4));
  const n = Math.min(be32(128), 200);
  for (let i = 0; i < n; i++) {
    const e = 132 + i * 12;
    if (sig(e) !== "desc") continue;
    const off = be32(e + 4), len = be32(e + 8);
    if (off + 12 > p.length || off + len > p.length) return null;
    const type = sig(off);
    if (type === "desc") return clean(latin1(p.subarray(off + 12, off + 12 + Math.min(be32(off + 8), len - 12))));
    if (type === "mluc" && be32(off + 8) > 0) {
      const sl = be32(off + 20), so = be32(off + 24);
      const s = p.subarray(off + so, off + so + sl);
      let t = ""; for (let k = 0; k + 1 < s.length; k += 2) t += String.fromCharCode((s[k] << 8) | s[k + 1]);
      return clean(t);
    }
    return null;
  }
  const space = clean(sig(16));
  return space ? `${space} profile` : null;
}

// ----------------------------------------------------------- JPEG
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];

/** IJG quality (1–100) that would give this luminance table, `zz` in the file's zigzag order. */
export function jpegQualityFromTable(zz: number[]): number | null {
  if (zz.length !== 64) return null;
  if (zz.every((v) => v <= 1)) return 100;
  let sum = 0;
  for (let k = 0; k < 64; k++) sum += (zz[k] * 100) / STD_LUMA[ZIGZAG[k]];
  const s = sum / 64;
  if (s <= 1) return 100;
  const q = s <= 100 ? (200 - s) / 2 : 5000 / s;
  return Math.max(1, Math.min(100, Math.round(q)));
}

function readJpeg(b: Bytes): Tech {
  const t = empty("JPEG");
  t.lossy = true;
  let off = 2, components = 0;
  const icc: { seq: number; data: Uint8Array }[] = [];
  let jfif: { res: number; unit: number } | null = null;
  while (off + 4 <= b.size) {
    if (b.u8(off) !== 0xff) break;
    const m = b.u8(off + 1);
    if (m === 0xff) { off++; continue; }
    if (m === 0xd9 || m === 0xda) break;                      // end, or start of scan: the headers are done
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { off += 2; continue; }
    const len = b.u16(off + 2, false), seg = off + 4, n = len - 2;
    if (m === 0xe0 && n >= 12 && b.ascii(seg, 5) === "JFIF\0") jfif = { unit: b.u8(seg + 7), res: b.u16(seg + 8, false) };
    else if (m === 0xe1 && n > 14 && b.ascii(seg, 6) === "Exif\0\0") {
      try {
        const x = tiffTags(b, seg + 6);
        const make = str(b, x.get(271)), model = str(b, x.get(272));
        t.camera = camera(make, model);
        t.software = str(b, x.get(305));
        t.capturedAt = exifDate(str(b, x.exif(36867)) || str(b, x.get(306)));
        t.orientation = num(b, x.get(274), x.le);
        t.dpi = resolutionDpi(num(b, x.get(282), x.le), num(b, x.get(296), x.le));
      } catch (e) { if (e instanceof Need) throw e; /* a damaged EXIF block doesn't hide the rest */ }
    } else if (m === 0xe2 && n > 14 && b.ascii(seg, 12) === "ICC_PROFILE\0") icc.push({ seq: b.u8(seg + 12), data: b.slice(seg + 14, n - 14) });
        else if (m === 0xdb) {
      for (let p = seg; p < seg + n;) {
        const pq = b.u8(p) >> 4, id = b.u8(p) & 15, sz = pq ? 128 : 64;
        if (id === 0 && t.jpegQuality === null) {
          const tbl: number[] = [];
          for (let k = 0; k < 64; k++) tbl.push(pq ? b.u16(p + 1 + k * 2, false) : b.u8(p + 1 + k));
          t.jpegQuality = jpegQualityFromTable(tbl);
        }
        p += 1 + sz;
      }
    } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      t.bitsPerChannel = b.u8(seg);
      t.height = b.u16(seg + 1, false); t.width = b.u16(seg + 3, false);
      components = b.u8(seg + 5);
      t.compression = m === 0xc2 || m === 0xc6 || m === 0xca ? "Progressive JPEG" : m === 0xc3 || m === 0xc7 || m === 0xcb ? "Lossless JPEG" : "Baseline JPEG";
      if (m === 0xc3 || m === 0xc7 || m === 0xcb) t.lossy = false;
    }
    off = seg + n;
  }
  t.colorMode = components === 1 ? "Grayscale" : components === 3 ? "RGB" : components === 4 ? "CMYK" : null;
  // JFIF's density wins over EXIF's when both are set (as Pillow and Photoshop read it)
  const jfifDpi = jfif && resolutionDpi(jfif.res, jfif.unit === 1 ? 2 : jfif.unit === 2 ? 3 : 1);
  if (jfifDpi) t.dpi = jfifDpi;
  if (icc.length) {
    const parts = icc.sort((x, y) => x.seq - y.seq);
    const all = new Uint8Array(parts.reduce((s, x) => s + x.data.length, 0));
    let o = 0; for (const x of parts) { all.set(x.data, o); o += x.data.length; }
    t.iccProfile = iccDescription(all);
  }
  return t;
}

// ----------------------------------------------------------- PNG, WebP, GIF
const PNG_COLOR: Record<number, [string, boolean]> = { 0: ["Grayscale", false], 2: ["RGB", false], 3: ["Indexed", false], 4: ["Grayscale", true], 6: ["RGB", true] };

function readPng(b: Bytes): Tech {
  const t = empty("PNG");
  t.compression = "Deflate"; t.lossy = false;
  for (let off = 8; off + 8 <= b.size;) {
    const len = b.u32(off, false), type = b.ascii(off + 4, 4), d = off + 8;
    if (type === "IHDR") {
      t.width = b.u32(d, false); t.height = b.u32(d + 4, false); t.bitsPerChannel = b.u8(d + 8);
      const [mode, alpha] = PNG_COLOR[b.u8(d + 9)] ?? [null, false];
      t.colorMode = mode; t.hasAlpha = alpha;
    } else if (type === "pHYs" && b.u8(d + 8) === 1) t.dpi = resolutionDpi(b.u32(d, false) / 100, 3);
    else if (type === "iCCP") { const s = b.ascii(d, Math.min(len, 80)); t.iccProfile = clean(s.slice(0, s.indexOf("\0"))); }
    else if (type === "sRGB" && !t.iccProfile) t.iccProfile = "sRGB IEC61966-2.1";
    else if (type === "IDAT" || type === "IEND") break;
    off = d + len + 4;
  }
  return t;
}

function readWebp(b: Bytes): Tech {
  const t = empty("WebP");
  for (let off = 12; off + 8 <= b.size;) {
    const type = b.ascii(off, 4), len = b.u32(off + 4, true), d = off + 8;
    if (type === "VP8X") {
      t.hasAlpha = !!(b.u8(d) & 0x10);
      t.width = 1 + (b.u8(d + 4) | (b.u8(d + 5) << 8) | (b.u8(d + 6) << 16));
      t.height = 1 + (b.u8(d + 7) | (b.u8(d + 8) << 8) | (b.u8(d + 9) << 16));
    } else if (type === "ICCP") t.iccProfile = iccDescription(b.slice(d, len));
    else if (type === "VP8 ") { t.lossy = true; t.compression = "VP8 (lossy)"; break; }
    else if (type === "VP8L") { t.lossy = false; t.compression = "VP8L (lossless)"; break; }
    off = d + len + (len & 1);
  }
  t.bitsPerChannel = 8; t.colorMode = "RGB";
  return t;
}

function readGif(b: Bytes): Tech {
  return { ...empty("GIF"), width: b.u16(6, true), height: b.u16(8, true), bitsPerChannel: 8, colorMode: "Indexed", compression: "LZW", lossy: false };
}

// ----------------------------------------------------------- Photoshop
const PSD_MODE: Record<number, string> = { 0: "Bitmap", 1: "Grayscale", 2: "Indexed", 3: "RGB", 4: "CMYK", 7: "Multichannel", 8: "Duotone", 9: "Lab" };
const PSD_COMPRESSION: Record<number, string> = { 0: "None", 1: "RLE", 2: "ZIP", 3: "ZIP" };

/** A .psd/.psb: header, image resources (ICC profile, resolution), layer count and how the composite is stored. */
function readPsd(b: Bytes): Tech {
  const t = empty("Photoshop");
  const big = b.u16(4, false) === 2;
  if (big) t.format = "Photoshop (PSB)";
  const channels = b.u16(12, false);
  t.height = b.u32(14, false); t.width = b.u32(18, false);
  t.bitsPerChannel = b.u16(22, false);
  t.colorMode = PSD_MODE[b.u16(24, false)] ?? null;
  t.hasAlpha = (t.colorMode === "RGB" && channels > 3) || (t.colorMode === "CMYK" && channels > 4) || (t.colorMode === "Grayscale" && channels > 1);
  t.lossy = false;
  const len = (off: number) => (big ? b.u32(off, false) * 2 ** 32 + b.u32(off + 4, false) : b.u32(off, false));
  let off = 26;
  off += 4 + b.u32(off, false);                                  // colour mode data
  const resEnd = off + 4 + b.u32(off, false);
  for (let r = off + 4; r + 12 <= resEnd;) {
    if (b.ascii(r, 4) !== "8BIM") break;
    const id = b.u16(r + 4, false);
    const nameLen = b.u8(r + 6), nameBytes = (nameLen + 1 + 1) & ~1;
    const sizeAt = r + 6 + nameBytes, size = b.u32(sizeAt, false), data = sizeAt + 4;
    if (id === 1039) t.iccProfile = iccDescription(b.slice(data, size));
    else if (id === 1005 && size >= 4) t.dpi = resolutionDpi(b.u32(data, false) / 65536, b.u16(data + 4, false) === 2 ? 3 : 2);
    r = data + size + (size & 1);
  }
  const layerSection = resEnd;
  const layerLen = len(layerSection), lenBytes = big ? 8 : 4;
  t.layers = 0;
  if (layerLen > 0) {
    const infoLen = len(layerSection + lenBytes);
    if (infoLen > 0) { const n = b.u16(layerSection + lenBytes * 2, false); t.layers = Math.abs(n > 0x7fff ? n - 0x10000 : n); }
  }
  t.compression = `Photoshop ${PSD_COMPRESSION[b.u16(layerSection + lenBytes + layerLen, false)] ?? "other"} (lossless)`;
  return t;
}
