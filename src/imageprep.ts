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

/** Long edge of the phone-made previews. */
export const DISPLAY_MAX = 1800;
export const THUMB_MAX = 560;

/** Size of an image scaled down (never up) so its long edge is at most `max`. */
export function scaledSize(w: number, h: number, max: number): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Whether a decoded bitmap has the expected proportions (a resized decode can ignore EXIF rotation). */
export function sameShape(got: { width: number; height: number }, want: { w: number; h: number }): boolean {
  return Math.abs(got.width / got.height - want.w / want.h) < 0.02;
}

export async function prepareImage(file: File): Promise<Prepared> {
  const previewUrl = URL.createObjectURL(file);
  const img = await decode(file, previewUrl);
  // e.g. HEIC on browsers that can't decode it: keep the original, skip variants.
  if (!img) return { original: file, palette: [], previewUrl };
  try {
    const display = await encode(img.bitmap, scaledSize(img.w, img.h, DISPLAY_MAX), 0.86);
    const thumb = await encode(img.bitmap, scaledSize(img.w, img.h, THUMB_MAX), 0.8);
    return { original: file, display, thumb, width: img.w, height: img.h, palette: extractPalette(img.bitmap), previewUrl: URL.createObjectURL(display) };
  } finally {
    img.bitmap.close();
  }
}

/**
 * Decodes the file for making previews, with the original's size. A large
 * photo (a 48 MP original is ~190 MB as a bitmap) is decoded straight to
 * display size where the browser supports resizing in createImageBitmap; the
 * original's size then comes from an <img>, which doesn't hold a full bitmap.
 * Anything else, or any surprise, decodes at full size as before.
 */
async function decode(file: File, url: string): Promise<{ bitmap: ImageBitmap; w: number; h: number } | null> {
  const size = await naturalSize(url);
  if (size && Math.max(size.w, size.h) > DISPLAY_MAX) {
    const want = scaledSize(size.w, size.h, DISPLAY_MAX);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: want.w, resizeHeight: want.h, resizeQuality: "high" } as ImageBitmapOptions);
      if (sameShape(bitmap, want)) return { bitmap, ...size };
      bitmap.close();
    } catch { /* fall back to a full decode */ }
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { bitmap, w: bitmap.width, h: bitmap.height };
  } catch {
    return null;
  }
}

/** Natural (EXIF-rotated) size via <img>, or null when the browser can't load it. */
function naturalSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function encode(bmp: ImageBitmap, size: { w: number; h: number }, quality: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = size.w;
  c.height = size.h;
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
