/**
 * Data access and mutations, shared by the HTTP API and the MCP endpoint.
 */
import { z } from "zod";
import { applyAttrsPatch, INVENTORY_KEY_SQL, inventoryKey, loadFieldDefs, looksLikeInventory, type Attrs, type FieldDef, type FieldIssue } from "./fields";
import { vectorBackend, type EmbedEnv } from "./embed";
import {
  coverDescribeParams, DEFAULT_VISION_MODEL, descriptionImageIdAfterEdit, describePrompt, describeWrite, embedText, ftsRow, inlineStep, parseVisionOutput,
  runIndexing, shouldDescribe, sidecarKey, sidecarRecord, startIndexing, upsertDecision, type DescriptionRow, type IndexOps, type IndexParams,
  type PreviewOutcome, type TierOutcome,
} from "./indexing";
import {
  describeSource, needsPreview, orientedSize, PALETTE_SAMPLE, paletteFromRgb, previewKey, previewPlan, previewState, previewTransform,
  serverPreviewable, servedKey, storageClassFor,
} from "./media";
import {
  archivedIdFilter, archivedWhere, archivePatch, bulkIdsSchema, countArchived, coverAfterHiding, coverAfterRestoring, isShown, selectImages,
  shownIds, tallyBulk, uniqueIds, vectorTopK, type ArchivedMode, type BulkOutcome, type CoverDecision,
} from "./archive";

export interface Env extends EmbedEnv {
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** The ArtworkIndexer Workflow (production). Absent in local dev, where indexing runs inline. */
  INDEXER?: Workflow<IndexParams>;
  /** Cloudflare Images (production): makes previews the phone couldn't. Absent in local dev, where those stay pending. */
  IMAGES?: ImagesBinding;
  VISION_MODEL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_DEV_AUTH?: string;
  SERVICE_TOKEN_NAMES?: string;
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
  status: string; attrs: string; palette: string; ai_description: string | null; ai_description_image_id: string | null; cover_image_id: string | null;
  version: number; created_at: string; updated_at: string; deleted_at: string | null;
  archived_at: string | null; archived_by: string | null;
}
interface ImageRow {
  id: string; artwork_id: string; kind: string; role: string; r2_key: string; display_key: string | null; thumb_key: string | null;
  sha256: string; content_type: string; bytes: number; width: number | null; height: number | null; palette: string;
  caption: string | null; taken_on: string | null; sort_order: number; created_at: string;
  deleted_at: string | null; archived_at: string | null; archived_by: string | null;
}

const now = () => new Date().toISOString();
export const imgUrl = (key: string | null) => (key ? "/img/" + key.split("/").map(encodeURIComponent).join("/") : null);

/**
 * `display` and `thumb` are previews only (null while `preview` is "pending" or
 * "unavailable"); the app never shows the original. `original` names the file
 * (record.json uses it); `download` is the one URL that fetches it.
 */
function imageDTO(r: ImageRow) {
  const original = imgUrl(servedKey(r, "download"));
  return {
    id: r.id, artworkId: r.artwork_id, kind: r.kind, role: r.role, caption: r.caption, takenOn: r.taken_on,
    width: r.width, height: r.height, bytes: r.bytes, contentType: r.content_type, sha256: r.sha256,
    palette: JSON.parse(r.palette) as string[], sortOrder: r.sort_order, createdAt: r.created_at,
    archivedAt: r.archived_at, archivedBy: r.archived_by,
    original, download: original && `${original}?download=1`,
    display: imgUrl(servedKey(r, "display")), thumb: imgUrl(servedKey(r, "thumb")), preview: previewState(r),
  };
}
export type ImageDTO = ReturnType<typeof imageDTO>;

function sortImages(imgs: ImageRow[]) {
  return imgs.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
}

/**
 * An artwork and the images a read asks for (`images`: archived ones left out by
 * default). The cover is always a visible image, whichever images are shown.
 */
export function artworkDTO(a: ArtworkRow, rows: ImageRow[], images: ArchivedMode = "exclude") {
  const { shown, archivedCount } = selectImages(sortImages([...rows]), images);
  const imgs = shown.map(imageDTO);
  const vis = sortImages(rows.filter((r) => !r.archived_at)).map(imageDTO);
  const cover = vis.find((i) => i.id === a.cover_image_id) || vis.find((i) => i.kind === "work") || vis[0] || null;
  return {
    id: a.id, catalogId: a.catalog_id, title: a.title, yearStart: a.year_start, yearEnd: a.year_end, circa: a.circa === 1,
    status: a.status, attrs: JSON.parse(a.attrs) as Attrs, palette: JSON.parse(a.palette) as string[],
    aiDescription: a.ai_description, aiDescriptionImageId: a.ai_description_image_id, coverImageId: cover ? cover.id : null, version: a.version,
    createdAt: a.created_at, updatedAt: a.updated_at, archivedAt: a.archived_at, archivedBy: a.archived_by,
    images: imgs, cover, archivedImageCount: archivedCount,
  };
}
export type ArtworkDTO = ReturnType<typeof artworkDTO>;

/** The same artwork with a different choice of images (it must have been read with all of them). */
export const viewImages = (a: ArtworkDTO, images: ArchivedMode): ArtworkDTO => ({ ...a, images: a.images.filter((i) => isShown(i.archivedAt, images)) });

/** By id or catalog number. Archived pieces are returned too, so they can be opened and brought back. */
export async function getArtwork(env: Env, idOrCatalog: string, images: ArchivedMode = "exclude"): Promise<ArtworkDTO> {
  const a = await env.DB.prepare("SELECT * FROM artworks WHERE (id = ?1 OR catalog_id = ?1) AND deleted_at IS NULL").bind(idOrCatalog).first<ArtworkRow>();
  if (!a) throw new HttpError(404, "Artwork not found");
  const { results } = await env.DB.prepare("SELECT * FROM images WHERE artwork_id = ? AND deleted_at IS NULL").bind(a.id).all<ImageRow>();
  return artworkDTO(a, results, images);
}

/** Lightweight list for browsing: everything the timeline, wall and filters need. Archived pieces only when asked. */
export async function listSummaries(env: Env, archived: ArchivedMode = "exclude") {
  const { results } = await env.DB.prepare(`
    SELECT a.id, a.catalog_id, a.title, a.year_start, a.year_end, a.circa, a.status, a.attrs, a.palette, a.version, a.updated_at, a.archived_at,
           COALESCE(c.id, f.id) AS cover_id, CASE WHEN c.id IS NOT NULL THEN c.r2_key ELSE f.r2_key END AS r2_key,
           CASE WHEN c.id IS NOT NULL THEN c.thumb_key ELSE f.thumb_key END AS thumb_key, CASE WHEN c.id IS NOT NULL THEN c.display_key ELSE f.display_key END AS display_key,
           COALESCE(c.content_type, f.content_type) AS content_type, COALESCE(c.bytes, f.bytes) AS bytes, COALESCE(c.width, f.width) AS w, COALESCE(c.height, f.height) AS h,
           (SELECT COUNT(*) FROM images i WHERE i.artwork_id = a.id AND i.deleted_at IS NULL AND i.archived_at IS NULL) AS image_count
    FROM artworks a
    LEFT JOIN images c ON c.id = a.cover_image_id AND c.deleted_at IS NULL AND c.archived_at IS NULL
    LEFT JOIN images f ON f.id = (SELECT id FROM images x WHERE x.artwork_id = a.id AND x.deleted_at IS NULL AND x.archived_at IS NULL ORDER BY (x.kind <> 'work'), x.sort_order, x.created_at LIMIT 1)
    WHERE a.deleted_at IS NULL AND ${archivedWhere(archived, "a.archived_at")}
    ORDER BY a.year_start IS NULL, a.year_start, a.catalog_id`).all<Record<string, unknown>>();
  return results.map((r) => {
    const keys = r.cover_id ? { r2_key: r.r2_key as string, display_key: r.display_key as string | null, thumb_key: r.thumb_key as string | null } : null;
    return {
    id: r.id as string, catalogId: r.catalog_id as string, title: r.title as string,
    yearStart: r.year_start as number | null, yearEnd: r.year_end as number | null, circa: r.circa === 1,
    status: r.status as string, attrs: JSON.parse(r.attrs as string) as Attrs, palette: JSON.parse(r.palette as string) as string[],
    version: r.version as number, updatedAt: r.updated_at as string, archivedAt: r.archived_at as string | null,
    thumb: keys && imgUrl(servedKey(keys, "thumb")), display: keys && imgUrl(servedKey(keys, "display")),
    preview: keys && previewState({ ...keys, content_type: r.content_type as string, bytes: r.bytes as number }),
    aspect: r.w && r.h ? (r.w as number) / (r.h as number) : null, imageCount: r.image_count as number,
    };
  });
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

// ----------------------------------------------------------- indexing (shell)
// Inline with each mutation: the FTS row and record.json (cheap, so keyword search
// and the sidecar are right immediately). In the background (ArtworkIndexer
// Workflow, or inline in local dev): vision description, embedding, vector upsert.

/** The artwork with all of its images (archived included), or null once it is removed. */
async function liveArtwork(env: Env, id: string): Promise<ArtworkDTO | null> {
  try { return await getArtwork(env, id, "include"); }
  catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; }
}

/** `a` read with all of its images, so record.json keeps archived ones (marked as such). */
async function writeText(env: Env, a: ArtworkDTO, defs: FieldDef[]) {
  const r = ftsRow(a, defs);
  // Guarded insert in the same transaction as the delete, so a late refresh can't
  // put a removed piece back into keyword search.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM artworks_fts WHERE artwork_id = ?").bind(a.id),
    env.DB.prepare(`INSERT INTO artworks_fts (artwork_id, catalog_id, title, attrs_text, ai_description)
                    SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM artworks WHERE id = ?1 AND deleted_at IS NULL)`)
      .bind(r.artwork_id, r.catalog_id, r.title, r.attrs_text, r.ai_description),
  ]);
  await env.BUCKET.put(sidecarKey(a), JSON.stringify(sidecarRecord(a, defs, STATUS_LABELS), null, 2),
    { httpMetadata: { contentType: "application/json" }, storageClass: storageClassFor("sidecar") });
}

/** FTS row + record.json for an artwork, now. Returns the usual view (archived images left out). */
export async function syncText(env: Env, id: string): Promise<ArtworkDTO> {
  const a = await getArtwork(env, id, "include");
  await writeText(env, a, await loadFieldDefs(env.DB));
  return viewImages(a, "exclude");
}

export const scheduleIndexing = (env: Env, params: IndexParams) =>
  startIndexing(env.INDEXER, params, () => runIndexing(params, indexOps(env, params.artworkId), inlineStep));

/** Sync the text now and schedule the rest (`extra`: previews to make, a preview to describe). */
async function reindex(env: Env, id: string, extra: Omit<IndexParams, "artworkId"> = {}): Promise<ArtworkDTO> {
  const a = await syncText(env, id);
  await scheduleIndexing(env, { artworkId: a.id, ...extra });
  return a;
}

/** The I/O behind each indexing step, for one artwork. */
export function indexOps(env: Env, artworkId: string): IndexOps {
  const currentText = async () => {
    const a = await liveArtwork(env, artworkId);
    return a ? embedText(a, await loadFieldDefs(env.DB)) : null;
  };
  return {
    preview: (imageId) => makePreviews(env, artworkId, imageId),
    tierOriginal: (imageId) => tierOriginal(env, imageId),
    async describe(key, imageId) {
      // only ever a display preview: never the original (large, and in Infrequent Access)
      if (!describeSource(key)) return false;
      const visionReady = env.EMBEDDINGS === "workers-ai" && !!env.AI;
      const row = await env.DB.prepare("SELECT ai_description, ai_description_image_id, cover_image_id, deleted_at FROM artworks WHERE id = ?").bind(artworkId).first<DescriptionRow>();
      if (!row || !shouldDescribe({ describeKey: key, imageId, visionReady, row }) || !env.AI) return false;
      const obj = await env.BUCKET.get(key);
      if (!obj) return false;
      const out = await env.AI.run((env.VISION_MODEL || DEFAULT_VISION_MODEL) as never, { image: [...new Uint8Array(await obj.arrayBuffer())], prompt: describePrompt(), max_tokens: 160 } as never);
      const text = parseVisionOutput(out);
      if (!text) throw new Error("vision model returned no description");
      // only if nothing moved on while the model ran: a description typed meanwhile, or a newer main image, wins
      const w = describeWrite(row, imageId, text);
      const r = await env.DB.prepare(`UPDATE artworks SET ai_description = ?1, ai_description_image_id = ?2 WHERE id = ?3 AND deleted_at IS NULL
                                      AND cover_image_id IS ?4 AND ai_description IS ?5 AND ai_description_image_id IS ?6`)
        .bind(w.set.aiDescription, w.set.imageId, artworkId, w.expect.coverImageId, w.expect.aiDescription, w.expect.imageId).run();
      return r.meta.changes > 0;
    },
    async refreshText() {
      const a = await liveArtwork(env, artworkId);
      if (a) await writeText(env, a, await loadFieldDefs(env.DB));
      return !!a;
    },
    async embed() {
      const text = await currentText();
      if (text === null) return null;
      const [vec] = await vectorBackend(env).embed([text]);
      return { text, vec };
    },
    async upsert(e) {
      const outcome = upsertDecision(await currentText(), e.text);
      if (outcome !== "upserted") return outcome;
      const vb = vectorBackend(env);
      await vb.upsert(artworkId, e.vec);
      // removed while we were upserting: take the vector back out
      if (!(await liveArtwork(env, artworkId))) { await vb.remove(artworkId); return "deleted"; }
      return outcome;
    },
  };
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
                                   ai_description_image_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
    .bind(v.title !== undefined ? v.title : cur.title, ys ?? null, ye ?? null, (v.circa !== undefined ? v.circa : cur.circa) ? 1 : 0,
      v.status || cur.status, JSON.stringify(res.attrs), v.aiDescription !== undefined ? v.aiDescription : cur.aiDescription,
      descriptionImageIdAfterEdit(cur, v.aiDescription), now(), cur.id, v.version).run();
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

// ----------------------------------------------------------- archive
// Archived pieces stay in FTS and the vector index (search leaves them out at
// query time), so archiving only changes the record: no re-embedding, and an
// unarchived piece is searchable again at once.

/** Archive or unarchive one piece. A repeat is a no-op; a change is a new version with a revision. */
async function changeArchived(env: Env, id: string, archived: boolean, by: string): Promise<{ artwork: ArtworkDTO; changed: boolean }> {
  const cur = await getArtwork(env, id);
  const p = archivePatch(archived, now(), by);
  const r = await env.DB.prepare(`UPDATE artworks SET archived_at = ?, archived_by = ?, version = version + 1, updated_at = ? WHERE id = ? AND ${p.guard}`)
    .bind(p.archivedAt, p.archivedBy, now(), cur.id).run();
  if (!r.meta.changes) return { artwork: cur, changed: false };
  const a = await syncText(env, cur.id); // record.json carries the archived state
  await writeRevision(env, a, by);
  return { artwork: a, changed: true };
}

export async function setArtworkArchived(env: Env, id: string, archived: boolean, by: string): Promise<ArtworkDTO> {
  return (await changeArchived(env, id, archived, by)).artwork;
}

/** Archive or unarchive many pieces by id (e.g. a batch of sample data). */
export async function setArtworksArchived(env: Env, input: unknown, archived: boolean, by: string) {
  const parsed = bulkIdsSchema.safeParse(input ?? {});
  if (!parsed.success) throw new HttpError(422, "Invalid list of artworks", zodIssues(parsed.error));
  const outcomes: [string, BulkOutcome][] = [];
  for (const id of uniqueIds(parsed.data.ids)) {
    try { outcomes.push([id, (await changeArchived(env, id, archived, by)).changed ? "changed" : "unchanged"]); }
    catch (e) { if (e instanceof HttpError && e.status === 404) outcomes.push([id, "notFound"]); else throw e; }
  }
  return tallyBulk(outcomes);
}

export async function listRevisions(env: Env, id: string) {
  const a = await getArtwork(env, id);
  const { results } = await env.DB.prepare("SELECT version, changed_by, changed_at FROM artwork_revisions WHERE artwork_id = ? ORDER BY version DESC").bind(a.id).all();
  return results;
}

// ----------------------------------------------------------- images
export const MAX_ORIGINAL = 80 * 1024 * 1024;
const MAX_VARIANT = 10 * 1024 * 1024;
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
  // The original is the backup: Infrequent Access. Only a download reads it back.
  await env.BUCKET.put(origKey, buf, {
    httpMetadata: { contentType: sniffed.type }, customMetadata: { originalName: original.name.slice(0, 200), uploadedBy: by }, sha256: sha,
    storageClass: storageClassFor("original"),
  });
  const putVariant = async (field: string, suffix: "display" | "thumb") => {
    const f = form.get(field);
    if (!(f instanceof File) || !f.size) return null;
    if (f.size > MAX_VARIANT) throw new HttpError(413, `${field} is too large`);
    const vb = await f.arrayBuffer();
    const vt = sniffImage(vb);
    if (!vt || !["image/jpeg", "image/png", "image/webp"].includes(vt.type)) throw new HttpError(415, `${field} must be a JPEG, WebP or PNG image`);
    const key = `${base}-${suffix}.${vt.ext}`;
    await env.BUCKET.put(key, vb, { httpMetadata: { contentType: vt.type }, storageClass: storageClassFor(suffix) });
    return key;
  };
  const displayKey = await putVariant("display", "display");
  const thumbKey = await putVariant("thumb", "thumb");
  // e.g. HEIC the phone's browser couldn't decode: the server makes the previews (in the background)
  const makePreview = needsPreview({ display_key: displayKey, thumb_key: thumbKey }) && serverPreviewable({ contentType: sniffed.type, bytes: original.size });
  const order = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM images WHERE artwork_id = ? AND kind = ?").bind(a.id, meta.kind).first<{ n: number }>();
  const id = crypto.randomUUID();
  const before = await coverRow(env, a.id);
  await env.DB.prepare(`INSERT INTO images (id, artwork_id, kind, role, r2_key, display_key, thumb_key, sha256, content_type, bytes, width, height, palette, caption, taken_on, sort_order, uploaded_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, a.id, meta.kind, meta.role, origKey, displayKey, thumbKey, sha, sniffed.type, original.size,
      meta.width ?? null, meta.height ?? null, JSON.stringify(meta.palette), meta.caption ?? null, meta.takenOn ?? null, order?.n ?? 0, by).run();
  const becomesCover = meta.makeCover || (!a.coverImageId && meta.kind === "work") || (!a.cover);
  if (becomesCover) await setCover(env, a.id, id, meta.palette);
  else await env.DB.prepare("UPDATE artworks SET updated_at = ? WHERE id = ?").bind(now(), a.id).run();
  await reindex(env, a.id, {
    ...(makePreview ? { previewImageId: id } : {}),
    ...(becomesCover ? coverDescribeParams(before, await coverRow(env, a.id)) : {}),
  });
  const row = await env.DB.prepare("SELECT * FROM images WHERE id = ?").bind(id).first<ImageRow>();
  return { image: imageDTO(row!), duplicate: false };
}

// ----------------------------------------------------------- previews and storage classes (shell)

const streamOf = (bytes: ArrayBuffer) => new Response(bytes).body!;
const bytesOf = (s: ReadableStream<Uint8Array>) => new Response(s).arrayBuffer();

/** One preview: the source through Cloudflare Images, as WebP at the preview's size. */
async function renderPreview(images: ImagesBinding, source: ReadableStream<Uint8Array>, which: "display" | "thumb") {
  const t = previewTransform(which);
  const out = await images.input(source).transform(t.transform).output(t.output);
  return bytesOf(out.image());
}

/** Width and height from Images (info() is free), or null for anything it can't size. */
async function sizeOf(images: ImagesBinding, source: ReadableStream<Uint8Array>) {
  const info = await images.info(source);
  return "width" in info ? { width: info.width, height: info.height } : null;
}

/** The palette from a tiny raw-RGB render of the display preview. Best effort: a preview without one is still a preview. */
async function paletteOf(images: ImagesBinding, display: ArrayBuffer) {
  try {
    const out = await images.input(streamOf(display)).transform({ width: PALETTE_SAMPLE, height: PALETTE_SAMPLE, fit: "squeeze" }).output({ format: "rgb" });
    return paletteFromRgb(new Uint8Array(await bytesOf(out.image())));
  } catch (e) { console.warn("palette from preview failed", e); return []; }
}

/**
 * The preview step: make an image's missing previews with Cloudflare Images,
 * write them to R2 (Standard), and record them on the image (plus its size and
 * palette when the phone sent none, and the piece's palette when this is its
 * cover). Idempotent: an image that has its previews is left alone.
 */
async function makePreviews(env: Env, artworkId: string, imageId: string): Promise<PreviewOutcome> {
  const row = await env.DB.prepare("SELECT * FROM images WHERE id = ? AND deleted_at IS NULL").bind(imageId).first<ImageRow>();
  if (!row) return { status: "gone", displayKey: null, paletteChanged: false };
  const plan = previewPlan(row, !!env.IMAGES);
  if (plan.kind === "ready") return { status: "ready", displayKey: row.display_key, paletteChanged: false };
  if (plan.kind === "skip" || !env.IMAGES) {
    if (plan.kind === "skip") console.warn("preview not made", imageId, plan.reason);
    return { status: "skipped", displayKey: row.display_key, paletteChanged: false };
  }
  const images = env.IMAGES;
  const src = await env.BUCKET.get(plan.source === "original" ? row.r2_key : row.display_key!);
  if (!src) return { status: "gone", displayKey: row.display_key, paletteChanged: false };

  let display: ArrayBuffer, displayKey = row.display_key, size: { width: number; height: number } | null = null;
  if (plan.make.includes("display")) {
    // the original is read once: one branch to size it, one to render the display preview
    const [forInfo, forDisplay] = src.body.tee();
    const [orig, rendered] = await Promise.all([sizeOf(images, forInfo).catch(() => null), renderPreview(images, forDisplay, "display")]);
    display = rendered;
    size = orientedSize(orig, await sizeOf(images, streamOf(display)).catch(() => null));
    displayKey = previewKey(row.r2_key, "display");
    await env.BUCKET.put(displayKey, display, { httpMetadata: { contentType: "image/webp" }, storageClass: storageClassFor("display") });
  } else {
    display = await src.arrayBuffer();
  }
  let thumbKey = row.thumb_key;
  if (plan.make.includes("thumb")) {
    thumbKey = previewKey(row.r2_key, "thumb");
    await env.BUCKET.put(thumbKey, await renderPreview(images, streamOf(display), "thumb"), { httpMetadata: { contentType: "image/webp" }, storageClass: storageClassFor("thumb") });
  }
  const palette = JSON.parse(row.palette).length ? null : await paletteOf(images, display);
  await env.DB.prepare(`UPDATE images SET display_key = ?1, thumb_key = ?2, width = COALESCE(width, ?3), height = COALESCE(height, ?4),
                        palette = CASE WHEN palette = '[]' AND ?5 IS NOT NULL THEN ?5 ELSE palette END WHERE id = ?6`)
    .bind(displayKey, thumbKey, size?.width ?? null, size?.height ?? null, palette?.length ? JSON.stringify(palette) : null, row.id).run();
  // the piece's palette follows its cover; fill it in only if nothing set it meanwhile
  let paletteChanged = false;
  if (palette?.length) {
    const r = await env.DB.prepare("UPDATE artworks SET palette = ? WHERE id = ? AND cover_image_id = ? AND palette = '[]'").bind(JSON.stringify(palette), artworkId, row.id).run();
    paletteChanged = r.meta.changes > 0;
  }
  return { status: "made", displayKey, paletteChanged };
}

/**
 * The backfill's step: rewrite an original uploaded before originals went to
 * Infrequent Access, keeping its metadata. Idempotent: one already there is left
 * alone (a rewrite would restart its 30-day minimum). Not called on upload.
 */
async function tierOriginal(env: Env, imageId: string): Promise<TierOutcome> {
  const row = await env.DB.prepare("SELECT r2_key FROM images WHERE id = ?").bind(imageId).first<{ r2_key: string }>();
  const head = row && await env.BUCKET.head(row.r2_key);
  if (!row || !head) return "gone";
  const target = storageClassFor("original");
  if (head.storageClass === target) return "already";
  const obj = await env.BUCKET.get(row.r2_key, { onlyIf: { etagMatches: head.etag } });
  if (!obj || !("body" in obj)) throw new Error("original changed while moving it; retrying");
  // a fixed-length stream, so R2 takes it without buffering up to 80 MB in memory
  const { readable, writable } = new FixedLengthStream(obj.size);
  const [, put] = await Promise.all([
    obj.body.pipeTo(writable),
    env.BUCKET.put(row.r2_key, readable, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata, storageClass: target }),
  ]);
  if (!put) throw new Error("original was not rewritten");
  return "moved";
}

/** Carry out a cover decision; the piece's palette follows its cover. */
async function applyCover(env: Env, artworkId: string, d: CoverDecision) {
  if (d.kind === "set") await setCover(env, artworkId, d.imageId);
  else if (d.kind === "clear") await env.DB.prepare("UPDATE artworks SET cover_image_id = NULL, palette = '[]', updated_at = ? WHERE id = ?").bind(now(), artworkId).run();
  else await env.DB.prepare("UPDATE artworks SET updated_at = ? WHERE id = ?").bind(now(), artworkId).run();
}

/** The piece's main image as recorded (null if none), for deciding whether a change of it needs a new description. */
async function coverRow(env: Env, artworkId: string): Promise<ImageRow | null> {
  return env.DB.prepare("SELECT i.* FROM artworks a JOIN images i ON i.id = a.cover_image_id WHERE a.id = ?").bind(artworkId).first<ImageRow>();
}

/** The cover and the (not removed) images a cover decision looks at. */
async function coverState(env: Env, artworkId: string) {
  const [a, imgs] = await Promise.all([
    env.DB.prepare("SELECT cover_image_id FROM artworks WHERE id = ?").bind(artworkId).first<{ cover_image_id: string | null }>(),
    env.DB.prepare("SELECT * FROM images WHERE artwork_id = ? AND deleted_at IS NULL").bind(artworkId).all<ImageRow>(),
  ]);
  return { coverId: a?.cover_image_id ?? null, rows: imgs.results };
}

async function setCover(env: Env, artworkId: string, imageId: string, palette?: string[]) {
  let pal = palette;
  if (!pal) {
    const r = await env.DB.prepare("SELECT palette FROM images WHERE id = ?").bind(imageId).first<{ palette: string }>();
    pal = r ? JSON.parse(r.palette) : [];
  }
  await env.DB.prepare("UPDATE artworks SET cover_image_id = ?, palette = ?, updated_at = ? WHERE id = ?").bind(imageId, JSON.stringify(pal || []), now(), artworkId).run();
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
  if (v.makeCover && img.archived_at) throw new HttpError(422, "Unarchive this image before making it the main image", [{ key: "makeCover", message: "This image is archived" }]);
  const before = await coverRow(env, img.artwork_id);
  await env.DB.prepare("UPDATE images SET kind = ?, role = ?, caption = ?, taken_on = ? WHERE id = ?")
    .bind(v.kind ?? img.kind, v.role ?? img.role, v.caption !== undefined ? v.caption : img.caption, v.takenOn !== undefined ? v.takenOn : img.taken_on, img.id).run();
  if (v.makeCover) await setCover(env, img.artwork_id, img.id);
  // a new main finished work (made the cover, or the cover relabelled a work) is described afresh
  await reindex(env, img.artwork_id, coverDescribeParams(before, await coverRow(env, img.artwork_id)));
  return getArtwork(env, img.artwork_id);
}

export async function deleteImage(env: Env, imageId: string) {
  const img = await env.DB.prepare("SELECT * FROM images WHERE id = ? AND deleted_at IS NULL").bind(imageId).first<ImageRow>();
  if (!img) throw new HttpError(404, "Image not found");
  const before = await coverRow(env, img.artwork_id);
  await env.DB.prepare("UPDATE images SET deleted_at = ? WHERE id = ?").bind(now(), img.id).run();
  const { coverId, rows } = await coverState(env, img.artwork_id);
  const d = coverAfterHiding(coverId, img.id, rows);
  if (d.kind !== "keep") await applyCover(env, img.artwork_id, d);
  return reindex(env, img.artwork_id, coverDescribeParams(before, await coverRow(env, img.artwork_id)));
}

/**
 * Archive or unarchive one image. An archived image leaves the carousel and
 * can't stay the cover (the next one takes over, as when removing); bringing it
 * back never takes the cover from another image.
 */
export async function setImageArchived(env: Env, imageId: string, archived: boolean, by: string) {
  const img = await env.DB.prepare("SELECT * FROM images WHERE id = ? AND deleted_at IS NULL").bind(imageId).first<ImageRow>();
  if (!img) throw new HttpError(404, "Image not found");
  const before = await coverRow(env, img.artwork_id);
  const p = archivePatch(archived, now(), by);
  const r = await env.DB.prepare(`UPDATE images SET archived_at = ?, archived_by = ? WHERE id = ? AND ${p.guard}`).bind(p.archivedAt, p.archivedBy, img.id).run();
  if (!r.meta.changes) return getArtwork(env, img.artwork_id);
  const { coverId, rows } = await coverState(env, img.artwork_id);
  await applyCover(env, img.artwork_id, archived ? coverAfterHiding(coverId, img.id, rows) : coverAfterRestoring(coverId, rows));
  return reindex(env, img.artwork_id, coverDescribeParams(before, await coverRow(env, img.artwork_id)));
}

// ----------------------------------------------------------- search
function ftsQuery(q: string): string | null {
  const toks = q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 1).slice(0, 12);
  if (!toks.length) return null;
  return toks.map((t) => `"${t}"*`).join(" OR ");
}

/** Ids of archived pieces (few; read from a partial index). */
async function archivedArtworkIds(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare("SELECT id FROM artworks WHERE archived_at IS NOT NULL AND deleted_at IS NULL").all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/** Hybrid search. Archived pieces are left out unless asked for (`archived`): filtered at query time in every source. */
export async function search(env: Env, q: string, limit = 60, archived: ArchivedMode = "exclude") {
  const query = q.trim().slice(0, 300);
  if (!query) return { backend: vectorBackend(env).name, results: [] as { id: string; score: number; match: number; via: string[] }[] };
  const vb = vectorBackend(env);
  const scores = new Map<string, { score: number; match: number; via: string[] }>();
  const hidden = archived === "include" ? new Set<string>() : await archivedArtworkIds(env);
  const [vec] = await vb.embed([query]);
  const shown = shownIds(archived, hidden);
  const vhits = (await vb.query(vec, vectorTopK(Math.min(100, limit * 2), archived, hidden.size))).filter((h) => shown(h.id));
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
    const { results } = await env.DB.prepare(`SELECT artwork_id AS id, bm25(artworks_fts, 0, 2.0, 4.0, 1.0, 1.0) AS rank FROM artworks_fts WHERE artworks_fts MATCH ? AND ${archivedIdFilter(archived, "artwork_id")} ORDER BY rank LIMIT ?`)
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
  const { results: titleRows } = await env.DB.prepare(`SELECT id, title, catalog_id FROM artworks WHERE deleted_at IS NULL AND ${archivedWhere(archived)} AND (instr(lower(title), ?1) > 0 OR lower(catalog_id) = ?1) LIMIT 50`)
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
  // An exact inventory number ("OP 1154") goes to the top too: FTS alone ranks it
  // as a couple of loose words, below good semantic hits.
  const inv = inventoryKey(query);
  if (looksLikeInventory(inv)) {
    const { results: invRows } = await env.DB.prepare(`SELECT id FROM artworks WHERE deleted_at IS NULL AND ${archivedWhere(archived)} AND ${INVENTORY_KEY_SQL} = ? LIMIT 20`)
      .bind(inv).all<{ id: string }>();
    for (const r of invRows) {
      const cur = scores.get(r.id);
      if (cur) { cur.match = Math.max(cur.match, 0.98); if (!cur.via.includes("inventory")) cur.via.push("inventory"); }
      else scores.set(r.id, { score: 0, match: 0.98, via: ["inventory"] });
    }
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
  // archived pieces never show up as "more like this"
  const hidden = await archivedArtworkIds(env);
  const shown = shownIds("exclude", hidden);
  const hits = (await vb.query(vec, vectorTopK(k + 1, "exclude", hidden.size))).filter((h) => shown(h.id));
  return hits.filter((h) => h.id !== a.id).slice(0, k).map((h) => ({ id: h.id, score: h.score, match: Math.round(vb.calibrateSimilar(h.score) * 100) / 100 }));
}

// ----------------------------------------------------------- backup
/** Everything, archived records included (their archived_at/archived_by are columns like any other). */
export async function exportAll(env: Env, date = new Date()) {
  const [fields, artworks, images, revisions] = await Promise.all([
    env.DB.prepare("SELECT * FROM field_defs").all(),
    env.DB.prepare("SELECT * FROM artworks").all(),
    env.DB.prepare("SELECT * FROM images").all(),
    env.DB.prepare("SELECT * FROM artwork_revisions").all(),
  ]);
  const key = `backups/${date.toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ format: "anne-laddon-archive-export/v1", exportedAt: date.toISOString(), field_defs: fields.results, artworks: artworks.results, images: images.results, artwork_revisions: revisions.results });
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" }, storageClass: storageClassFor("backup") });
  return {
    key, bytes: body.length, artworks: artworks.results.length, images: images.results.length,
    archivedArtworks: countArchived(artworks.results), archivedImages: countArchived(images.results),
  };
}
