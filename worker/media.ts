/**
 * Media: the functional core for image files in R2.
 *
 * Originals are a backup: written once to Infrequent Access (cheaper to keep,
 * charged per GB to read, 30-day minimum) and read back only for an explicit
 * download. Everything the app shows comes from the `-display` and `-thumb`
 * previews in Standard storage. These are the pure decisions: the storage class
 * for each kind of object, which key serves which purpose, whether and how a
 * preview must still be made on the server, its size, and what the vision model
 * may look at. The I/O lives in store.ts and index.ts.
 */
import { kmeansPalette } from "./palette";

// ----------------------------------------------------------- storage classes
export type ObjectRole = "original" | "display" | "thumb" | "sidecar" | "backup";
export type StorageClass = "Standard" | "InfrequentAccess";

/** Originals are kept, rarely read: Infrequent Access. Anything read routinely stays Standard. */
export function storageClassFor(role: ObjectRole): StorageClass {
  return role === "original" ? "InfrequentAccess" : "Standard";
}

/** What an object under artworks/ is, from its key alone (the layout addImage writes). */
export function keyRole(key: string): Exclude<ObjectRole, "backup"> {
  if (key.endsWith("/record.json")) return "sidecar";
  if (/-display\.[a-z0-9]+$/i.test(key)) return "display";
  if (/-thumb\.[a-z0-9]+$/i.test(key)) return "thumb";
  return "original";
}

/**
 * Whether /img may send this object. Originals go out only as an explicit
 * download (the one intended read of Infrequent Access); previews and
 * record.json are served as usual.
 */
export function imgAccess(key: string, download: boolean): "serve" | "download-only" {
  return keyRole(key) === "original" && !download ? "download-only" : "serve";
}

/**
 * A download saves under the name the file arrived with ("OP 691 Desert
 * Devotions.tif"), keeping the stored extension; the storage key's name otherwise.
 * ASCII fallback plus RFC 5987 UTF-8 for names with accents or quotes.
 */
export function downloadDisposition(originalName: string | undefined, key: string): string {
  const stored = key.split("/").pop() || "original";
  const ext = stored.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const base = (originalName || "").replace(/[\\/\0-\x1f]/g, " ").replace(/\.[a-z0-9]{2,5}$/i, "").trim().slice(0, 150);
  const name = base ? base + ext : stored;
  // the UTF-8 name keeps a quote (`30" wide`); the plain fallback can't, so it gets an apostrophe
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "'") || stored;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

// ----------------------------------------------------------- previews
export interface PreviewKeys { r2_key: string; display_key: string | null; thumb_key: string | null }
export type PreviewState = "ready" | "pending" | "unavailable";

/**
 * The key behind each in-app use. Display and thumb never fall back to the
 * original: without a preview there is nothing to show yet (a thumb may use the
 * display preview, both being Standard). Download is the original, always.
 */
export function servedKey(r: PreviewKeys, purpose: "display" | "thumb" | "download"): string | null {
  if (purpose === "download") return r.r2_key;
  if (purpose === "display") return r.display_key;
  return r.thumb_key || r.display_key;
}

/** Cloudflare Images takes at most 20 MB through the binding's input(). */
export const MAX_PREVIEW_SOURCE = 20 * 1024 * 1024;
/** Inputs Cloudflare Images decodes (AVIF needs an Enterprise plan, TIFF isn't supported). */
const PREVIEWABLE = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"];

/** Whether the server could make previews from this original. */
export function serverPreviewable(o: { contentType: string; bytes: number }): boolean {
  return PREVIEWABLE.includes(o.contentType) && o.bytes > 0 && o.bytes <= MAX_PREVIEW_SOURCE;
}

/** For the DTO: shown, still to come, or never coming (download the original instead). */
export function previewState(r: PreviewKeys & { content_type: string; bytes: number }): PreviewState {
  if (r.display_key) return "ready";
  return serverPreviewable({ contentType: r.content_type, bytes: r.bytes }) ? "pending" : "unavailable";
}

/** An upload without both phone-made previews needs the server to finish the job (if it can). */
export function needsPreview(r: Pick<PreviewKeys, "display_key" | "thumb_key">): boolean {
  return !r.display_key || !r.thumb_key;
}

export type PreviewPlan =
  | { kind: "ready" }
  | { kind: "skip"; reason: "no-binding" | "unsupported" | "too-large" }
  | { kind: "make"; source: "original" | "display"; make: ("display" | "thumb")[] };

/**
 * How to finish an image's previews. A missing thumb is made from the display
 * preview (Standard, small) rather than the original (Infrequent Access); only a
 * missing display preview means reading the original, once.
 */
export function previewPlan(r: PreviewKeys & { content_type: string; bytes: number }, imagesBound: boolean): PreviewPlan {
  if (!needsPreview(r)) return { kind: "ready" };
  if (!imagesBound) return { kind: "skip", reason: "no-binding" };
  if (r.display_key) return { kind: "make", source: "display", make: ["thumb"] };
  if (!PREVIEWABLE.includes(r.content_type)) return { kind: "skip", reason: "unsupported" };
  if (r.bytes > MAX_PREVIEW_SOURCE) return { kind: "skip", reason: "too-large" };
  return { kind: "make", source: "original", make: r.thumb_key ? ["display"] : ["display", "thumb"] };
}

/** The same sizes the phone makes (src/imageprep.ts), as WebP: fit inside the box, never enlarged. */
export const PREVIEW_SIZES = {
  display: { max: 1800, quality: 86 },
  thumb: { max: 560, quality: 80 },
} as const;
export const PREVIEW_FORMAT = { type: "image/webp", ext: "webp" } as const;

/** Cloudflare Images transform + output options for one preview. */
export function previewTransform(which: "display" | "thumb") {
  const s = PREVIEW_SIZES[which];
  return {
    transform: { width: s.max, height: s.max, fit: "scale-down" as const },
    output: { format: PREVIEW_FORMAT.type, quality: s.quality },
  };
}

/** Where a server-made preview goes: next to the original, as the phone's would. */
export function previewKey(originalKey: string, which: "display" | "thumb"): string {
  const base = originalKey.replace(/\.[a-z0-9]+$/i, "");
  return `${base}-${which}.${PREVIEW_FORMAT.ext}`;
}

/**
 * The original's width and height, oriented as the preview shows it. Cloudflare
 * Images applies EXIF orientation when it renders, but info() may report the
 * stored (unrotated) size, so trust the preview's shape: swap if it's sideways.
 */
export function orientedSize(original: { width: number; height: number } | null, preview: { width: number; height: number } | null) {
  if (!original) return null;
  if (!preview) return original;
  const landscape = (d: { width: number; height: number }) => d.width >= d.height;
  return landscape(original) === landscape(preview) || original.width === original.height
    ? original : { width: original.height, height: original.width };
}

/** Raw RGB bytes (a small render from Images) as the same palette the phone extracts. */
export function paletteFromRgb(rgb: Uint8Array, k = 5): string[] {
  const px: number[][] = [];
  for (let i = 0; i + 2 < rgb.length; i += 3) px.push([rgb[i], rgb[i + 1], rgb[i + 2]]);
  return kmeansPalette(px, k);
}
export const PALETTE_SAMPLE = 48;

// ----------------------------------------------------------- vision
/**
 * The vision model looks at the display preview, never the original (which is
 * large, and in Infrequent Access). Null means: nothing to describe from.
 */
export function describeSource(key: string | null | undefined): string | null {
  return key && keyRole(key) === "display" ? key : null;
}
