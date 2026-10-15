/**
 * MCP tool arguments: the functional core.
 *
 * Pure parsing and checking of the arguments for the tools that write (add an
 * image, archive), and the multipart form an image upload is turned into, so
 * the MCP endpoint reuses the same upload path as the app. The I/O (fetching a
 * URL, storing, archiving) lives in mcp.ts and store.ts.
 */
import { z } from "zod";
import { bulkIdsSchema } from "./archive";
import { IMAGE_KINDS, MAX_ORIGINAL } from "./store";

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: 400 | 413; message: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (message: string, status: 400 | 413 = 400): Parsed<never> => ({ ok: false, status, message });
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, args: unknown): Parsed<T> {
  const p = schema.safeParse(args ?? {});
  return p.success ? ok(p.data) : bad(`Invalid arguments: ${issues(p.error)}`);
}

// ----------------------------------------------------------- archive
const archiveArtworksSchema = z.object({ ids: bulkIdsSchema.shape.ids, archived: z.boolean().default(true) }).strict();
const archiveImageSchema = z.object({ imageId: z.string().trim().min(1).max(100), archived: z.boolean().default(true) }).strict();

/** archive_artworks: ids or catalog numbers, archived (default) or brought back. */
export const parseArchiveArtworksArgs = (args: unknown) => parseWith(archiveArtworksSchema, args);
/** archive_image: one image, archived (default) or brought back. */
export const parseArchiveImageArgs = (args: unknown) => parseWith(archiveImageSchema, args);

// ----------------------------------------------------------- add_image
/** The longest base64 text that can decode to an original addImage accepts (plus room for a data: prefix). */
export const MAX_BASE64_CHARS = Math.ceil(MAX_ORIGINAL / 3) * 4 + 100;

const addImageSchema = z.object({
  artworkId: z.string().trim().min(1).max(100),
  kind: z.enum(IMAGE_KINDS),
  caption: z.string().trim().max(500).optional(),
  makeCover: z.boolean().optional(),
  base64: z.string().min(1).optional(),
  filename: z.string().trim().min(1).max(200).optional(),
  contentType: z.string().trim().max(100).optional(),
  url: z.string().trim().min(1).max(2000).optional(),
}).strict();

export interface ImageFile { bytes: Uint8Array; filename: string; contentType: string }
export type ImageSource = { from: "bytes"; file: ImageFile } | { from: "url"; url: URL };
export interface ImageMeta { kind: (typeof IMAGE_KINDS)[number]; caption?: string; makeCover: boolean }
export interface AddImageArgs { artworkId: string; meta: ImageMeta; source: ImageSource }

/** Plain or data:-URL base64 to bytes; null when it isn't valid base64. */
export function decodeBase64(s: string): Uint8Array | null {
  const body = s.replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
  if (!body || body.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
  try {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** The file to upload and its details, from add_image's arguments. Exactly one of base64 or url. */
export function parseAddImageArgs(args: unknown): Parsed<AddImageArgs> {
  const p = parseWith(addImageSchema, args);
  if (!p.ok) return p;
  const v = p.value;
  const meta: ImageMeta = { kind: v.kind, makeCover: v.makeCover ?? false, ...(v.caption ? { caption: v.caption } : {}) };
  if ((v.base64 === undefined) === (v.url === undefined)) return bad("Invalid arguments: pass exactly one of base64 or url");
  if (v.url !== undefined) {
    const url = checkFetchUrl(v.url);
    return typeof url === "string" ? bad(`Invalid arguments: url: ${url}`) : ok({ artworkId: v.artworkId, meta, source: { from: "url", url } });
  }
  if (v.base64!.length > MAX_BASE64_CHARS) return bad("Image is larger than 80 MB", 413);
  const bytes = decodeBase64(v.base64!);
  if (!bytes) return bad("Invalid arguments: base64: not valid base64");
  if (bytes.length > MAX_ORIGINAL) return bad("Image is larger than 80 MB", 413);
  const file = { bytes, filename: v.filename ?? "upload", contentType: v.contentType ?? "application/octet-stream" };
  return ok({ artworkId: v.artworkId, meta, source: { from: "bytes", file } });
}

// ----------------------------------------------------------- fetching by url
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function privateIPv4(host: string): boolean {
  const m = IPV4.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

/** Loopback, private, link-local and other non-public hosts (by name or literal address). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return true;
  if (IPV4.test(h)) return privateIPv4(h);
  if (h.includes(":")) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return privateIPv4(mapped[1]);
    if (/^::ffff:/.test(h)) return true; // mapped address in hex form: don't guess
    return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

/** A URL the Worker may fetch: http(s), no credentials, a public host. Otherwise why not. */
export function checkFetchUrl(raw: string): URL | string {
  let u: URL;
  try { u = new URL(raw); } catch { return "not a valid URL"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "only http and https URLs can be fetched";
  if (u.username || u.password) return "URLs with credentials aren't allowed";
  if (isPrivateHost(u.hostname)) return "that host is private or local";
  return u;
}

/** A file name for an image fetched by URL: the path's last part, else "download". */
export function filenameFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop();
  let name = last;
  try { name = last && decodeURIComponent(last); } catch { /* keep it encoded */ }
  return (name || "download").slice(0, 200);
}

// ----------------------------------------------------------- the upload
/**
 * The multipart form addImage reads, as the app sends it but without previews:
 * the server makes those (the Workflow's preview step), exactly as for a phone
 * that couldn't.
 */
export function imageForm(file: ImageFile, meta: ImageMeta): FormData {
  const form = new FormData();
  form.append("original", new File([file.bytes], file.filename, { type: file.contentType }));
  form.append("meta", JSON.stringify(meta));
  return form;
}
