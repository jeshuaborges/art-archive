/**
 * On the phone, before upload: make a display-size and a thumbnail JPEG and
 * pull a small colour palette. The original file is uploaded untouched.
 */
import { kmeansPalette } from "../worker/palette";

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

export { kmeansPalette };
