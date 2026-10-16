import { Hono } from "hono";
import { authenticate, type Identity } from "./auth";
import { z } from "zod";
import { fieldDefInputSchema, loadFieldDefs, OPTION_SCHEMAS, type FieldDefRow, type FieldType } from "./fields";
import { handleMcp } from "./mcp";
import {
  HttpError, STATUS_LABELS, IMAGE_KINDS, abortLargeUpload, addImage, completeLargeUpload, startLargeUpload, uploadLargePart, createArtwork, deleteArtwork, deleteImage, exportAll, getArtwork,
  assetReport, listRevisions, uploadedName, listSummaries, queueAssetChecks, search, setArtworkArchived, setArtworksArchived, setImageArchived, similar, updateArtwork, updateImage, type Env,
} from "./store";
import { vectorBackend } from "./embed";
import { ARCHIVED_MODES, parseArchivedMode } from "./archive";
import { downloadDisposition, imgAccess } from "./media";

export { ArtworkIndexer } from "./indexer";
export { AssetChecker } from "./assetchecker";

type App = { Bindings: Env; Variables: { user: Identity } };
const intParam = (v: string | undefined, def: number, max: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : def; };
/** ?archived=exclude (default) | include | only */
const archivedParam = (v: string | undefined) => {
  const m = parseArchivedMode(v);
  if (!m) throw new HttpError(422, `archived must be one of ${ARCHIVED_MODES.join(", ")}`, [{ key: "archived", message: "Unknown value" }]);
  return m;
};
const app = new Hono<App>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, details: err.details ?? null }, err.status as 400);
  console.error(err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

// Every API, image and MCP request needs an identity from Cloudflare Access
// (or the dev identity in local development).
app.use("*", async (c, next) => {
  const user = await authenticate(c.req.raw, c.env);
  if (!user) return c.json({ error: "Not signed in. This app is protected by Cloudflare Access." }, 401);
  c.set("user", user);
  await next();
});

app.get("/api/me", (c) => c.json(c.get("user")));

app.get("/api/config", async (c) => c.json({
  statuses: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  imageKinds: IMAGE_KINDS,
  search: vectorBackend(c.env).name,
}));

app.get("/api/fields", async (c) => c.json(await loadFieldDefs(c.env.DB)));
app.post("/api/fields", async (c) => {
  const p = fieldDefInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(422, "Invalid field", p.error.issues.map((i) => ({ key: i.path.join("."), message: i.message })));
  const f = p.data;
  const exists = await c.env.DB.prepare("SELECT 1 FROM field_defs WHERE key = ?").bind(f.key).first();
  if (exists) throw new HttpError(409, `A field called "${f.key}" already exists`);
  await c.env.DB.prepare("INSERT INTO field_defs (key, label, type, options, required, sort_order, filterable, help_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(f.key, f.label, f.type, JSON.stringify(f.options), f.required ? 1 : 0, f.sortOrder, f.filterable ? 1 : 0, f.helpText).run();
  return c.json((await loadFieldDefs(c.env.DB)).find((d) => d.key === f.key), 201);
});

// Edit a field definition. Its key and type are fixed (existing values depend on
// them); to change a type, add a new field and archive the old one.
const fieldPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  required: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  helpText: z.string().trim().max(300).nullable().optional(),
  archived: z.boolean().optional(),
}).strict();
app.patch("/api/fields/:key", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM field_defs WHERE key = ?").bind(c.req.param("key")).first<FieldDefRow>();
  if (!row) throw new HttpError(404, "Field not found");
  const p = fieldPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(422, "Invalid field update", p.error.issues.map((i) => ({ key: i.path.join("."), message: i.message })));
  const v = p.data;
  let options = row.options;
  if (v.options) {
    const o = OPTION_SCHEMAS[row.type as FieldType].safeParse(v.options);
    if (!o.success) throw new HttpError(422, "Invalid field options", o.error.issues.map((i) => ({ key: ["options", ...i.path].join("."), message: i.message })));
    options = JSON.stringify(o.data);
  }
  await c.env.DB.prepare(`UPDATE field_defs SET label = ?, options = ?, required = ?, filterable = ?, sort_order = ?, help_text = ?,
                          archived_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ?`)
    .bind(v.label ?? row.label, options, v.required === undefined ? row.required : v.required ? 1 : 0, v.filterable === undefined ? row.filterable : v.filterable ? 1 : 0,
      v.sortOrder ?? row.sort_order, v.helpText !== undefined ? v.helpText : row.help_text,
      v.archived === undefined ? row.archived_at : v.archived ? row.archived_at || new Date().toISOString() : null, row.key).run();
  return c.json((await loadFieldDefs(c.env.DB)).find((d) => d.key === row.key));
});

app.get("/api/artworks", async (c) => c.json(await listSummaries(c.env, archivedParam(c.req.query("archived")))));
app.post("/api/artworks", async (c) => c.json(await createArtwork(c.env, await c.req.json().catch(() => ({})), c.get("user").actor), 201));
// Archive out of sight (reversible; DELETE is the soft delete). Bulk takes { ids: [...] }.
app.post("/api/artworks/archive", async (c) => c.json(await setArtworksArchived(c.env, await c.req.json().catch(() => null), true, c.get("user").actor)));
app.post("/api/artworks/unarchive", async (c) => c.json(await setArtworksArchived(c.env, await c.req.json().catch(() => null), false, c.get("user").actor)));
// An archived piece still opens; `archived` here chooses its images.
app.get("/api/artworks/:id", async (c) => c.json(await getArtwork(c.env, c.req.param("id"), archivedParam(c.req.query("archived")))));
app.post("/api/artworks/:id/archive", async (c) => c.json(await setArtworkArchived(c.env, c.req.param("id"), true, c.get("user").actor)));
app.post("/api/artworks/:id/unarchive", async (c) => c.json(await setArtworkArchived(c.env, c.req.param("id"), false, c.get("user").actor)));
app.patch("/api/artworks/:id", async (c) => c.json(await updateArtwork(c.env, c.req.param("id"), await c.req.json().catch(() => null), c.get("user").actor)));
app.delete("/api/artworks/:id", async (c) => { await deleteArtwork(c.env, c.req.param("id"), c.get("user").actor); return c.body(null, 204); });
app.get("/api/artworks/:id/revisions", async (c) => c.json(await listRevisions(c.env, c.req.param("id"))));
app.get("/api/artworks/:id/similar", async (c) => c.json(await similar(c.env, c.req.param("id"), intParam(c.req.query("k"), 8, 24))));

app.post("/api/artworks/:id/images", async (c) => {
  const form = await c.req.formData().catch(() => { throw new HttpError(400, "Expected a multipart form upload"); });
  const r = await addImage(c.env, c.req.param("id"), form, c.get("user").actor);
  return c.json(r, r.duplicate ? 200 : 201);
});
// Originals over 80 MB (Worker requests stop at 100 MB): start, send parts, complete.
app.post("/api/artworks/:id/uploads", async (c) => c.json(await startLargeUpload(c.env, c.req.param("id"), await c.req.json().catch(() => null), c.get("user").actor)));
app.put("/api/artworks/:id/uploads/:uploadId/parts/:n", async (c) =>
  c.json(await uploadLargePart(c.env, c.req.param("id"), c.req.param("uploadId"), Number(c.req.param("n")), c.req.query("key"), await c.req.arrayBuffer())));
app.post("/api/artworks/:id/uploads/:uploadId/complete", async (c) => {
  const form = await c.req.formData().catch(() => { throw new HttpError(400, "Expected a multipart form"); });
  const r = await completeLargeUpload(c.env, c.req.param("id"), c.req.param("uploadId"), form, c.get("user").actor);
  return c.json(r, r.duplicate ? 200 : 201);
});
app.delete("/api/artworks/:id/uploads/:uploadId", async (c) => { await abortLargeUpload(c.env, c.req.param("id"), c.req.param("uploadId"), c.req.query("key")); return c.body(null, 204); });
app.patch("/api/images/:id", async (c) => c.json(await updateImage(c.env, c.req.param("id"), await c.req.json().catch(() => null))));
app.delete("/api/images/:id", async (c) => c.json(await deleteImage(c.env, c.req.param("id"))));
app.post("/api/images/:id/archive", async (c) => c.json(await setImageArchived(c.env, c.req.param("id"), true, c.get("user").actor)));
app.post("/api/images/:id/unarchive", async (c) => c.json(await setImageArchived(c.env, c.req.param("id"), false, c.get("user").actor)));

app.get("/api/search", async (c) => c.json(await search(c.env, c.req.query("q") || "", intParam(c.req.query("limit"), 60, 200), archivedParam(c.req.query("archived")))));

// Originals as print masters: per-piece readiness and how the files are kept.
app.get("/api/assets/report", async (c) => c.json(await assetReport(c.env)));
// Read every original's headers and re-check checksums that are due (in the background).
app.post("/api/admin/check-assets", async (c) => c.json(await queueAssetChecks(c.env, intParam(c.req.query("max"), 2000, 5000))));

app.post("/api/admin/backup", async (c) => c.json(await exportAll(c.env)));
app.get("/api/admin/backups", async (c) => {
  const list = await c.env.BUCKET.list({ prefix: "backups/", limit: 1000 });
  return c.json(list.objects.map((o) => ({ key: o.key, bytes: o.size, uploaded: o.uploaded })).sort((a, b) => b.key.localeCompare(a.key)));
});

// Images: originals are never modified, and live in Infrequent Access, so they
// are sent only as an explicit download (?download=1). The app shows the display
// and thumbnail previews (Standard), made on the phone at upload time or, when
// it couldn't, by Cloudflare Images in the indexing Workflow.
app.get("/img/*", async (c) => {
  let key: string;
  try { key = c.req.path.slice("/img/".length).split("/").map(decodeURIComponent).join("/"); }
  catch { throw new HttpError(404, "Not found"); }
  if (!key.startsWith("artworks/") || key.includes("..")) throw new HttpError(404, "Not found");
  const download = !!c.req.query("download");
  if (imgAccess(key, download) === "download-only") throw new HttpError(403, "Originals are only sent as downloads. Add ?download=1.");
  const etag = c.req.header("If-None-Match");
  const obj = await c.env.BUCKET.get(key, etag ? { onlyIf: { etagDoesNotMatch: etag.replace(/"/g, "") } } : undefined);
  if (!obj) throw new HttpError(404, "Not found");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", key.endsWith("/record.json") ? "private, no-cache" : "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
  if (download) headers.set("Content-Disposition", downloadDisposition(obj.customMetadata?.originalName && uploadedName(obj.customMetadata.originalName), key));
  return new Response(obj.body, { headers });
});

app.all("/mcp", async (c) => handleMcp(c.req.raw, c.env, `mcp:${c.get("user").actor}`));

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(exportAll(env).then((r) => console.log("backup written", r)));
    // a rolling checksum pass: every original is re-read about every FIXITY_DAYS
    ctx.waitUntil(queueAssetChecks(env, 150).then((r) => console.log("asset checks queued", r)));
  },
} satisfies ExportedHandler<Env>;
