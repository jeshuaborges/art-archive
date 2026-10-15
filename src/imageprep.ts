/**
 * On the phone, before upload: make a display-size and a thumbnail JPEG and
 * pull a small colour palette. The original file is uploaded untouched.
 */
export interface Prepared {
  original: File;
  display?: Blob;
  thumb?: Blob;
  width?: number;
  height?: number;
  palette: string[];
  previewUrl: string;
}

export async function prepareImage(file: File): Promise<Prepared> {
  const previewUrl = URL.createObjectURL(file);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // e.g. HEIC on browsers that can't decode it: keep the original, skip variants.
    return { original: file, palette: [], previewUrl };
  }
  try {
    const display = await resize(bmp, 1800, 0.86);
    const thumb = await resize(bmp, 560, 0.8);
    return { original: file, display, thumb, width: bmp.width, height: bmp.height, palette: extractPalette(bmp), previewUrl: URL.createObjectURL(display) };
  } finally {
    bmp.close();
  }
}

function resize(bmp: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", quality));
}

/** k-means on a 48px sample; returns up to 5 dominant colours, most common first. */
export function extractPalette(src: CanvasImageSource & { width: number; height: number }, k = 5): string[] {
  const S = 48;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const px: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  return kmeansPalette(px, k);
}

export function kmeansPalette(px: number[][], k = 5): string[] {
  if (!px.length) return [];
  const centers: number[][] = [];
  for (let i = 0; i < k; i++) centers.push(px[Math.floor(((i + 0.5) / k) * px.length)].slice());
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    assign = px.map((p) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = j; } });
      return best;
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sums.forEach((s, j) => { if (s[3]) centers[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = centers.map((_, j) => assign.filter((a) => a === j).length);
  const out: string[] = [];
  centers.map((c, j) => ({ c, n: counts[j] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).forEach(({ c }) => {
    if (out.some((h) => { const n = parseInt(h.slice(1), 16); return Math.abs(((n >> 16) & 255) - c[0]) + Math.abs(((n >> 8) & 255) - c[1]) + Math.abs((n & 255) - c[2]) < 36; })) return;
    out.push("#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase());
  });
  return out;
}
