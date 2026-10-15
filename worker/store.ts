/**
 * Data access and mutations, shared by the HTTP API and the MCP endpoint.
 */
import { z } from "zod";
import { applyAttrsPatch, loadFieldDefs, searchText, formatValue, type Attrs, type FieldDef, type FieldIssue } from "./fields";
import { vectorBackend, colorName, type EmbedEnv } from "./embed";

export interface Env extends EmbedEnv {
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  VISION_MODEL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_DEV_AUTH?: string;
}

export const STATUSES = ["in_studio", "on_show", "sold", "gifted", "consigned", "on_loan", "lost", "unknown"] as const;
export const STATUS_LABELS: Record<string, string> = {
  in_studio: "In studio", on_show: "On show", sold: "Sold", gifted: "Gifted",
  consigned: "Consigned", on_loan: "On loan", lost: "Lost", unknown: "Unknown",
};
export const IMAGE_KINDS = ["work", "progress", "study", "reference"] as const;
const KIND_ORDER: Record<string, number> = { work: 0, progress: 1, study: 2, reference: 3 };

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

interface ArtworkRow {
  id: string; catalog_id: string; title: string; year_start: number | null; year_end: number | null; circa: number;
  status: string; attrs: string; palette: string; ai_description: string | null; cover_image_id: string | null;
  version: number; created_at: string; updated_at: string; deleted_at: string | null;
}
interface ImageRow {
  id: string; artwork_id: string; kind: string; role: string; r2_key: string; display_key: string | null; thumb_key: string | null;
  sha256: string; content_type: string; bytes: number; width: number | null; height: number | null; palette: string;
  caption: string | null; taken_on: string | null; sort_order: number; created_at: string;
}

const now = () => new Date().toISOString();
export const imgUrl = (key: string | null) => (key ? "/img/" + key.split("/").map(encodeURIComponent).join("/") : null);

function imageDTO(r: ImageRow) {
  return {
    id: r.id, artworkId: r.artwork_id, kind: r.kind, role: r.role, caption: r.caption, takenOn: r.taken_on,
    width: r.width, height: r.height, bytes: r.bytes, contentType: r.content_type, sha256: r.sha256,
    palette: JSON.parse(r.palette) as string[], sortOrder: r.sort_order, createdAt: r.created_at,
    original: imgUrl(r.r2_key), display: imgUrl(r.display_key || r.r2_key), thumb: imgUrl(r.thumb_key || r.display_key || r.r2_key),
  };
}
export type ImageDTO = ReturnType<typeof imageDTO>;

function sortImages(imgs: ImageRow[]) {
  return imgs.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
}

function artworkDTO(a: ArtworkRow, images: ImageRow[]) {
  const imgs = sortImages(images).map(imageDTO);
  const cover = imgs.find((i) => i.id === a.cover_image_id) || imgs.find((i) => i.kind === "work") || imgs[0] || null;
  return {
    id: a.id, catalogId: a.catalog_id, title: a.title, yearStart: a.year_start, yearEnd: a.year_end, circa: a.circa === 1,
    status: a.status, attrs: JSON.parse(a.attrs) as Attrs, palette: JSON.parse(a.palette) as string[],
    aiDescription: a.ai_description, coverImageId: cover ? cover.id : null, version: a.version,
    createdAt: a.created_at, updatedAt: a.updated_at, images: imgs, cover,
  };
}
export type ArtworkDTO = ReturnType<typeof artworkDTO>;

export async function getArtwork(env: Env, idOrCatalog: string): Promise<ArtworkDTO> {
  const a = await env.DB.prepare("SELECT * FROM artworks WHERE (id = ?1 OR catalog_id = ?1) AND deleted_at IS NULL").bind(idOrCatalog).first<ArtworkRow>();
  if (!a) throw new HttpError(404, "Artwork not found");
  const { results } = await env.DB.prepare("SELECT * FROM images WHERE artwork_id = ? AND deleted_at IS NULL").bind(a.id).all<ImageRow>();
  return artworkDTO(a, results);
}

/** Lightweight list for browsing: everything the timeline, wall and filters need. */
export async function listSummaries(env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT a.id, a.catalog_id, a.title, a.year_start, a.year_end, a.circa, a.status, a.attrs, a.palette, a.version, a.updated_at,
           COALESCE(c.id, f.id) AS cover_id, COALESCE(c.thumb_key, f.thumb_key) AS thumb_key, COALESCE(c.display_key, f.display_key) AS display_key,
           COALESCE(c.width, f.width) AS w, COALESCE(c.height, f.height) AS h,
           (SELECT COUNT(*) FROM images i WHERE i.artwork_id = a.id AND i.deleted_at IS NULL) AS image_count
    FROM artworks a
    LEFT JOIN images c ON c.id = a.cover_image_id AND c.deleted_at IS NULL
    LEFT JOIN images f ON f.id = (SELECT id FROM images x WHERE x.artwork_id = a.id AND x.deleted_at IS NULL ORDER BY (x.kind <> 'work'), x.sort_order, x.created_at LIMIT 1)
    WHERE a.deleted_at IS NULL
    ORDER BY a.year_start IS NULL, a.year_start, a.catalog_id`).all<Record<string, unknown>>();
  return results.map((r) => ({
    id: r.id as string, catalogId: r.catalog_id as string, title: r.title as string,
    yearStart: r.year_start as number | null, yearEnd: r.year_end as number | null, circa: r.circa === 1,
    status: r.status as string, attrs: JSON.parse(r.attrs as string) as Attrs, palette: JSON.parse(r.palette as string) as string[],
    version: r.version as number, updatedAt: r.updated_at as string,
    thumb: imgUrl(r.thumb_key as string | null), display: imgUrl(r.display_key as string | null),
    aspect: r.w && r.h ? (r.w as number) / (r.h as number) : null, imageCount: r.image_count as number,
  }));
}

// ----------------------------------------------------------- mutations
const coreBase = {
  title: z.string().trim().max(300).optional(),
  yearStart: z.number().int().min(1800).max(2100).nullable().optional(),
  yearEnd: z.number().int().min(1800).max(2100).nullable().optional(),
  circa: z.boolean().optional(),
  status: z.enum(STATUSES).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  aiDescription: z.string().trim().max(4000).nullable().optional(),
};
export const createSchema = z.object(coreBase).strict();
export const updateSchema = z.object({ ...coreBase, version: z.number().int().positive() }).strict();

function zodIssues(e: z.ZodError): FieldIssue[] {
  return e.issues.map((i) => ({ key: i.path.join(".") || "_", message: i.message }));
}

async function addNewChoices(db: D1Database, defs: FieldDef[], newChoices: Record<string, string[]>) {
  for (const [key, vals] of Object.entries(newChoices)) {
    const def = defs.find((d) => d.key === key);
    if (!def || (def.type !== "select" && def.type !== "multi_select")) continue;
    const choices = [...def.options.choices, ...vals.filter((v) => !def.options.choices.includes(v))];
    await db.prepare("UPDATE field_defs SET options = ?, updated_at = ? WHERE key = ?")
      .bind(JSON.stringify({ ...def.options, choices }), now(), key).run();
  }
}

function snapshot(a: ArtworkDTO) {
  const { images, cover, ...rest } = a;
  return { ...rest, imageIds: images.map((i) => i.id) };
}

async function writeRevision(env: Env, a: ArtworkDTO, by: string) {
  await env.DB.prepare("INSERT OR REPLACE INTO artwork_revisions (artwork_id, version, snapshot, changed_by) VALUES (?, ?, ?, ?)")
    .bind(a.id, a.version, JSON.stringify(snapshot(a)), by).run();
}

export function describeLocally(a: ArtworkDTO): string {
  const colors = [...new Set(a.palette.map(colorName))].filter((c) => c !== "gray");
  const parts: string[] = [];
  const medium = a.attrs.medium as string | undefined;
  parts.push(`${medium ? medium : "A work"}${a.yearStart ? ` from the ${Math.floor(a.yearStart / 10) * 10}s` : ""}`);
  if (colors.length) parts.push(`palette of ${colors.join(", ")}`);
  const subjects = a.attrs.subjects as string[] | undefined;
  if (subjects?.length) parts.push(`subjects: ${subjects.join(", ").toLowerCase()}`);
  return parts.join("; ") + ".";
}

export function embedText(a: ArtworkDTO, defs: FieldDef[]): string {
  const colors = [...new Set(a.palette.map(colorName))];
  const decade = a.yearStart ? `${Math.floor(a.yearStart / 10) * 10}s` : "";
  return [a.title, searchText(defs.filter((d) => d.key !== "location" && d.key !== "dimensions"), a.attrs), a.aiDescription || describeLocally(a), colors.length ? "colors " + colors.join(" ") : "", decade]
    .filter(Boolean).join("\n");
}

export async function reindex(env: Env, id: string, defs?: FieldDef[]) {
  const a = await getArtwork(env, id);
  defs = defs || (await loadFieldDefs(env.DB));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM artworks_fts WHERE artwork_id = ?").bind(a.id),
    env.DB.prepare("INSERT INTO artworks_fts (artwork_id, catalog_id, title, attrs_text, ai_description) VALUES (?, ?, ?, ?, ?)")
      .bind(a.id, a.catalogId, a.title, searchText(defs, a.attrs), a.aiDescription || describeLocally(a)),
  ]);
  const vb = vectorBackend(env);
  const [vec] = await vb.embed([embedText(a, defs)]);
  await vb.upsert(a.id, vec);
  await writeSidecar(env, a, defs);
  return a;
}

export async function writeSidecar(env: Env, a: ArtworkDTO, defs: FieldDef[]) {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const record = {
    format: "anne-laddon-archive-record/v1",
    catalogId: a.catalogId, title: a.title,
    year: { start: a.yearStart, end: a.yearEnd, circa: a.circa },
    status: STATUS_LABELS[a.status] || a.status,
    fields: Object.entries(a.attrs).map(([key, value]) => {
      const d = byKey.get(key);
      return { key, label: d?.label ?? key, value, display: d ? formatValue(d, value) : String(value) };
    }),
    description: a.aiDescription, palette: a.palette,
    images: a.images.map((i) => ({ file: i.original?.split("/").pop(), kind: i.kind, role: i.role, caption: i.caption, sha256: i.sha256, width: i.width, height: i.height })),
    version: a.version, updatedAt: a.updatedAt,
  };
  await env.BUCKET.put(`artworks/${a.catalogId}/record.json`, JSON.stringify(record, null, 2), { httpMetadata: { contentType: "application/json" } });
}

export async function createArtwork(env: Env, input: unknown, by: string): Promise<ArtworkDTO> {
  const parsed = createSchema.safeParse(input ?? {});
  if (!parsed.success) throw new HttpError(422, "Invalid artwork", zodIssues(parsed.error));
  const v = parsed.data;
  if (v.yearEnd != null && v.yearStart == null) throw new HttpError(422, "Invalid artwork", [{ key: "yearEnd", message: "Add a start year first" }]);
  if (v.yearStart != null && v.yearEnd != null && v.yearEnd < v.yearStart) throw new HttpError(422, "Invalid artwork", [{ key: "yearEnd", message: "End year must be on or after start year" }]);
  const defs = await loadFieldDefs(env.DB);
  // New pieces start as drafts: "required" fields are enforced when someone tries
  // to clear them later, never at creation, so adding a work can't be blocked.
  const res = applyAttrsPatch(defs, {}, v.attrs || {}, "update");
  if (!res.ok) throw new HttpError(422, "Invalid fields", res.issues);
  const id = crypto.randomUUID();
  const prefix = v.yearStart ? String(v.yearStart) : "undated";
  // The catalog number is computed inside the INSERT itself, so concurrent adds
  // can't pick the same number; a UNIQUE clash (should one ever happen) retries.
  for (let attempt = 0; ; attempt++) {
    try {
      await env.DB.prepare(`INSERT INTO artworks (id, catalog_id, title, year_start, year_end, circa, status, attrs, ai_description, created_by)
        SELECT ?1, ?2 || '-' || printf('%03d', COALESCE(MAX(CAST(substr(catalog_id, length(?2) + 2) AS INTEGER)), 0) + 1),
               ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
        FROM artworks WHERE catalog_id LIKE ?2 || '-%'`)
        .bind(id, prefix, v.title || "", v.yearStart ?? null, v.yearEnd ?? null, v.circa ? 1 : 0, v.status || "in_studio", JSON.stringify(res.attrs), v.aiDescription ?? null, by).run();
      break;
    } catch (e) {
      if (attempt < 6 && /UNIQUE constraint failed: artworks\.catalog_id/.test(String(e))) { await new Promise((r) => setTimeout(r, 15 + Math.random() * 40)); continue; }
      throw e;
    }
  }
  await addNewChoices(env.DB, defs, res.newChoices);
  const a = await reindex(env, id);
  await writeRevision(env, a, by);
  return a;
}

export async function updateArtwork(env: Env, id: string, input: unknown, by: string): Promise<ArtworkDTO> {
  const parsed = updateSchema.safeParse(input ?? {});
  if (!parsed.success) throw new HttpError(422, "Invalid update", zodIssues(parsed.error));
  const v = parsed.data;
  const cur = await getArtwork(env, id);
  if (cur.version !== v.version) throw new HttpError(409, "This piece was changed somewhere else. Reload to see the latest version.", { current: cur });
  const defs = await loadFieldDefs(env.DB);
  const res = applyAttrsPatch(defs, cur.attrs, v.attrs || {}, "update");
  if (!res.ok) throw new HttpError(422, "Invalid fields", res.issues);
  const ys = v.yearStart !== undefined ? v.yearStart : cur.yearStart;
  const ye = v.yearEnd !== undefined ? v.yearEnd : cur.yearEnd;
  if (ye != null && ys == null) throw new HttpError(422, "Invalid update", [{ key: "yearEnd", message: "Add a start year first" }]);
  if (ys != null && ye != null && ye < ys) throw new HttpError(422, "Invalid update", [{ key: "yearEnd", message: "End year must be on or after start year" }]);
  const r = await env.DB.prepare(`UPDATE artworks SET title = ?, year_start = ?, year_end = ?, circa = ?, status = ?, attrs = ?, ai_description = ?,
                                   version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
    .bind(v.title !== undefined ? v.title : cur.title, ys ?? null, ye ?? null, (v.circa !== undefined ? v.circa : cur.circa) ? 1 : 0,
      v.status || cur.status, JSON.stringify(res.attrs), v.aiDescription !== undefined ? v.aiDescription : cur.aiDescription, now(), cur.id, v.version).run();
  if (!r.meta.changes) throw new HttpError(409, "This piece was changed somewhere else. Reload to see the latest version.");
  await addNewChoices(env.DB, defs, res.newChoices);
  const a = await reindex(env, cur.id);
  await writeRevision(env, a, by);
  return a;
}

export async function deleteArtwork(env: Env, id: string, by: string) {
  const a = await getArtwork(env, id);
  await env.DB.batch([
    env.DB.prepare("UPDATE artworks SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), a.id),
    env.DB.prepare("DELETE FROM artworks_fts WHERE artwork_id = ?").bind(a.id),
  ]);
  await vectorBackend(env).remove(a.id);
  await writeRevision(env, { ...a, version: a.version + 1 }, by);
}

export async function listRevisions(env: Env, id: string) {
  const a = await getArtwork(env, id);
  const { results } = await env.DB.prepare("SELECT version, changed_by, changed_at FROM artwork_revisions WHERE artwork_id = ? ORDER BY version DESC").bind(a.id).all();
  return results;
}

// ----------------------------------------------------------- images
const MAX_ORIGINAL = 80 * 1024 * 1024, MAX_VARIANT = 10 * 1024 * 1024;
const imageMetaSchema = z.object({
  kind: z.enum(IMAGE_KINDS).default("work"),
  role: z.string().trim().max(80).default(""),
  caption: z.string().trim().max(500).optional(),
  takenOn: z.string().trim().max(40).optional(),
  width: z.coerce.number().int().positive().max(100000).optional(),
  height: z.coerce.number().int().positive().max(100000).optional(),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(12).default([]),
  makeCover: z.boolean().default(false),
});

/**
 * Identify an image by its first bytes rather than trusting the file name or
 * the browser's type. Only real raster photo formats are accepted (no SVG/HTML).
 */
export function sniffImage(buf: ArrayBuffer): { type: string; ext: string } | null {
  const b = new Uint8Array(buf.slice(0, 32));
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return { type: "image/png", ext: "png" };
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { type: "image/gif", ext: "gif" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image/webp", ext: "webp" };
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return { type: "image/tiff", ext: "tif" };
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["avif", "avis"].includes(brand)) return { type: "image/avif", ext: "avif" };
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return { type: "image/heic", ext: "heic" };
    if (["mif1", "msf1"].includes(brand)) return { type: "image/heif", ext: "heif" };
  }
  return null;
}

async function sha256Hex(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


export async function addImage(env: Env, artworkId: string, form: FormData, by: string) {
  const a = await getArtwork(env, artworkId);
  const original = form.get("original");
  if (!(original instanceof File)) throw new HttpError(422, "Missing image file", [{ key: "original", message: "Attach an image" }]);
  if (!original.size) throw new HttpError(422, "That file is empty", [{ key: "original", message: "The file has no data" }]);
  if (original.size > MAX_ORIGINAL) throw new HttpError(413, "Image is larger than 80 MB");
  let meta;
  try {
    const metaRaw = form.get("meta");
    meta = imageMetaSchema.parse(metaRaw ? JSON.parse(String(metaRaw)) : {});
  } catch (e) {
    throw new HttpError(422, "Invalid image details", e instanceof z.ZodError ? zodIssues(e) : [{ key: "meta", message: "Not valid JSON" }]);
  }
  const buf = await original.arrayBuffer();
  const sniffed = sniffImage(buf);
  if (!sniffed) throw new HttpError(415, "That doesn't look like a photo. Upload a JPEG, PNG, HEIC, WebP, TIFF, AVIF or GIF image.");
  const sha = await sha256Hex(buf);
  const dupe = await env.DB.prepare("SELECT * FROM images WHERE artwork_id = ? AND sha256 = ? AND deleted_at IS NULL").bind(a.id, sha).first<ImageRow>();
  if (dupe) return { image: imageDTO(dupe), duplicate: true };

  const base = `artworks/${a.catalogId}/${sha.slice(0, 16)}`;
  const origKey = `${base}.${sniffed.ext}`;
  await env.BUCKET.put(origKey, buf, { httpMetadata: { contentType: sniffed.type }, customMetadata: { originalName: original.name.slice(0, 200), uploadedBy: by }, sha256: sha });
  const putVariant = async (field: string, suffix: string) => {
    const f = form.get(field);
    if (!(f instanceof File) || !f.size) return null;
    if (f.size > MAX_VARIANT) throw new HttpError(413, `${field} is too large`);
    const vb = await f.arrayBuffer();
    const vt = sniffImage(vb);
    if (!vt || !["image/jpeg", "image/png", "image/webp"].includes(vt.type)) throw new HttpError(415, `${field} must be a JPEG, WebP or PNG image`);
    const key = `${base}-${suffix}.${vt.ext}`;
    await env.BUCKET.put(key, vb, { httpMetadata: { contentType: vt.type } });
    return key;
  };
  const displayKey = await putVariant("display", "display");
  const thumbKey = await putVariant("thumb", "thumb");
  const order = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM images WHERE artwork_id = ? AND kind = ?").bind(a.id, meta.kind).first<{ n: number }>();
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO images (id, artwork_id, kind, role, r2_key, display_key, thumb_key, sha256, content_type, bytes, width, height, palette, caption, taken_on, sort_order, uploaded_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, a.id, meta.kind, meta.role, origKey, displayKey, thumbKey, sha, sniffed.type, original.size,
      meta.width ?? null, meta.height ?? null, JSON.stringify(meta.palette), meta.caption ?? null, meta.takenOn ?? null, order?.n ?? 0, by).run();
  const becomesCover = meta.makeCover || (!a.coverImageId && meta.kind === "work") || (!a.cover);
  if (becomesCover) await setCover(env, a.id, id, meta.palette);
  else await env.DB.prepare("UPDATE artworks SET updated_at = ? WHERE id = ?").bind(now(), a.id).run();
  if (becomesCover && meta.kind === "work") await maybeDescribe(env, a.id, displayKey || origKey);
  await reindex(env, a.id);
  const row = await env.DB.prepare("SELECT * FROM images WHERE id = ?").bind(id).first<ImageRow>();
  return { image: imageDTO(row!), duplicate: false };
}

async function setCover(env: Env, artworkId: string, imageId: string, palette?: string[]) {
  let pal = palette;
  if (!pal) {
    const r = await env.DB.prepare("SELECT palette FROM images WHERE id = ?").bind(imageId).first<{ palette: string }>();
    pal = r ? JSON.parse(r.palette) : [];
  }
  await env.DB.prepare("UPDATE artworks SET cover_image_id = ?, palette = ?, updated_at = ? WHERE id = ?").bind(imageId, JSON.stringify(pal || []), now(), artworkId).run();
}

/** Production only: ask a Workers AI vision model to describe the finished work. */
async function maybeDescribe(env: Env, artworkId: string, key: string) {
  if (env.EMBEDDINGS !== "workers-ai" || !env.AI) return;
  try {
    const a = await env.DB.prepare("SELECT ai_description FROM artworks WHERE id = ?").bind(artworkId).first<{ ai_description: string | null }>();
    if (a?.ai_description) return;
    const obj = await env.BUCKET.get(key);
    if (!obj) return;
    const bytes = [...new Uint8Array(await obj.arrayBuffer())];
    const out = (await env.AI.run((env.VISION_MODEL || "@cf/llava-hf/llava-1.5-7b-hf") as never, {
      image: bytes, prompt: "Describe this artwork for a search index in two sentences: subject, setting, colors, mood and style.", max_tokens: 160,
    } as never)) as unknown as { description?: string; response?: string };
    const text = (out.description || out.response || "").trim();
    if (text) await env.DB.prepare("UPDATE artworks SET ai_description = ? WHERE id = ?").bind(text.slice(0, 4000), artworkId).run();
  } catch (e) {
    console.warn("vision description failed", e);
  }
}

const imagePatchSchema = z.object({
  kind: z.enum(IMAGE_KINDS).optional(),
  role: z.string().trim().max(80).optional(),
  caption: z.string().trim().max(500).nullable().optional(),
  takenOn: z.string().trim().max(40).nullable().optional(),
  makeCover: z.literal(true).optional(),
}).strict();

export async function updateImage(env: Env, imageId: string, input: unknown) {
  const p = imagePatchSchema.safeParse(input ?? {});
  if (!p.success) throw new HttpError(422, "Invalid image update", zodIssues(p.error));
  const img = await env.DB.prepare("SELECT * FROM images WHERE id = ? AND deleted_at IS NULL").bind(imageId).first<ImageRow>();
  if (!img) throw new HttpError(404, "Image not found");
  const v = p.data;
  await env.DB.prepare("UPDATE images SET kind = ?, role = ?, caption = ?, taken_on = ? WHERE id = ?")
    .bind(v.kind ?? img.kind, v.role ?? img.role, v.caption !== undefined ? v.caption : img.caption, v.takenOn !== undefined ? v.takenOn : img.taken_on, img.id).run();
  if (v.makeCover) await setCover(env, img.artwork_id, img.id);
  await reindex(env, img.artwork_id);
  return getArtwork(env, img.artwork_id);
}

export async function deleteImage(env: Env, imageId: string) {
  const img = await env.DB.prepare("SELECT * FROM images WHERE id = ? AND deleted_at IS NULL").bind(imageId).first<ImageRow>();
  if (!img) throw new HttpError(404, "Image not found");
  await env.DB.prepare("UPDATE images SET deleted_at = ? WHERE id = ?").bind(now(), img.id).run();
  const a = await env.DB.prepare("SELECT cover_image_id FROM artworks WHERE id = ?").bind(img.artwork_id).first<{ cover_image_id: string | null }>();
  if (a?.cover_image_id === img.id) {
    const next = await env.DB.prepare("SELECT id FROM images WHERE artwork_id = ? AND deleted_at IS NULL ORDER BY (kind <> 'work'), sort_order LIMIT 1").bind(img.artwork_id).first<{ id: string }>();
    if (next) await setCover(env, img.artwork_id, next.id);
    else await env.DB.prepare("UPDATE artworks SET cover_image_id = NULL, palette = '[]' WHERE id = ?").bind(img.artwork_id).run();
  }
  await reindex(env, img.artwork_id);
  return getArtwork(env, img.artwork_id);
}

// ----------------------------------------------------------- search
function ftsQuery(q: string): string | null {
  const toks = q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 1).slice(0, 12);
  if (!toks.length) return null;
  return toks.map((t) => `"${t}"*`).join(" OR ");
}

export async function search(env: Env, q: string, limit = 60) {
  const query = q.trim().slice(0, 300);
  if (!query) return { backend: vectorBackend(env).name, results: [] as { id: string; score: number; match: number; via: string[] }[] };
  const vb = vectorBackend(env);
  const scores = new Map<string, { score: number; match: number; via: string[] }>();
  const [vec] = await vb.embed([query]);
  const vhits = await vb.query(vec, Math.min(100, limit * 2));
  const top = vhits[0]?.score ?? 0;
  for (const h of vhits) {
    const match = vb.calibrate(h.score);
    if (h.score <= 0 || match < 0.2 || h.score < top * 0.45) continue;
    scores.set(h.id, { score: h.score, match, via: ["meaning"] });
  }
  // Hybrid ranking: meaning leads; matching words add a boost but, alone, stay
  // below a good semantic hit; a title/catalog match goes straight to the top.
  const fq = ftsQuery(query);
  if (fq) {
    const { results } = await env.DB.prepare("SELECT artwork_id AS id, bm25(artworks_fts, 0, 2.0, 4.0, 1.0, 1.0) AS rank FROM artworks_fts WHERE artworks_fts MATCH ? ORDER BY rank LIMIT ?")
      .bind(fq, limit).all<{ id: string; rank: number }>();
    const best = results.length ? results[0].rank : 0;
    for (const r of results) {
      const rel = best ? r.rank / best : 1;          // 1 = best keyword hit
      const words = 0.35 + 0.25 * rel;               // 0.35–0.60 on its own
      const cur = scores.get(r.id);
      if (cur) { cur.match = Math.min(1, cur.match * 0.8 + words * 0.35); cur.via.push("words"); }
      else scores.set(r.id, { score: 0, match: words, via: ["words"] });
    }
  }
  const ql = query.toLowerCase();
  const { results: titleRows } = await env.DB.prepare("SELECT id, title, catalog_id FROM artworks WHERE deleted_at IS NULL AND (instr(lower(title), ?1) > 0 OR lower(catalog_id) = ?1) LIMIT 50")
    .bind(ql).all<{ id: string; title: string; catalog_id: string }>();
  const esc = ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordStart = new RegExp(`(^|[^a-z0-9])${esc}`);
  // a title boost needs at least 3 characters starting a word, or an exact catalog number
  const titled = titleRows.filter((t) => t.catalog_id.toLowerCase() === ql || (ql.length >= 3 && wordStart.test(t.title.toLowerCase())));
  for (const t of titled) {
    const cur = scores.get(t.id);
    if (cur) { cur.match = Math.max(cur.match, 0.97); if (!cur.via.includes("title")) cur.via.push("title"); }
    else scores.set(t.id, { score: 0, match: 0.97, via: ["title"] });
  }
  const results = [...scores.entries()].map(([id, s]) => ({ id, ...s, match: Math.round(s.match * 100) / 100 }))
    .filter((r) => r.match >= 0.3)
    .sort((a, b) => b.match - a.match).slice(0, limit);
  return { backend: vb.name, results };
}

export async function similar(env: Env, id: string, k = 8) {
  const a = await getArtwork(env, id);
  const defs = await loadFieldDefs(env.DB);
  const vb = vectorBackend(env);
  const [vec] = await vb.embed([embedText(a, defs)]);
  const hits = await vb.query(vec, k + 1);
  return hits.filter((h) => h.id !== a.id).slice(0, k).map((h) => ({ id: h.id, score: h.score, match: Math.round(vb.calibrateSimilar(h.score) * 100) / 100 }));
}

// ----------------------------------------------------------- backup
export async function exportAll(env: Env, date = new Date()) {
  const [fields, artworks, images, revisions] = await Promise.all([
    env.DB.prepare("SELECT * FROM field_defs").all(),
    env.DB.prepare("SELECT * FROM artworks").all(),
    env.DB.prepare("SELECT * FROM images").all(),
    env.DB.prepare("SELECT * FROM artwork_revisions").all(),
  ]);
  const key = `backups/${date.toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ format: "anne-laddon-archive-export/v1", exportedAt: date.toISOString(), field_defs: fields.results, artworks: artworks.results, images: images.results, artwork_revisions: revisions.results });
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
  return { key, bytes: body.length, artworks: artworks.results.length, images: images.results.length };
}
