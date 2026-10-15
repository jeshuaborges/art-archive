# Anne Laddon · Archive

A phone-first archive for fifty years of Anne Laddon's work: every original, its studies, progress shots and reference photos, with the details that go with them. It runs as one Cloudflare Worker.

## What it does

- **Timeline**: scrub through the years on a draggable filmstrip, or jump to a decade. Swipe the hero image to step through pieces, and tap it to open the piece.
- **Wall**: a two-column masonry grouped by decade, with sticky headers and a decade rail for jumping.
- **One top row**: the Timeline/Wall toggle, an expanding search field, and filters.
- **Search by meaning**: try "warm sunsets over water". Results combine semantic vectors with full-text matching and show a match percentage.
- **Filters**: medium, subjects, style, series (any field marked filterable), where the piece is, color (from each image's palette), a year range, and whether to show archived pieces (hide / show too / only). Active filters appear as removable chips.
- **Piece view**:
  - Many images per piece, grouped as Finished, Progress, Studies and References, in a swipeable carousel.
  - "How it came together": the sequence from reference photo to finished work.
  - Image options: make main image, change type, rename, download original, archive, remove. Archived images sit under an "Archived" tab.
  - More like this.
- **Editing on the phone**: every field is generated from the flexible field definitions. Saves use optimistic concurrency, and every save is kept as a revision.
- **Uploads**: from the camera, photo library or files, with progress shown. The original is stored untouched, as a backup, in R2 Infrequent Access. Display and thumbnail previews and a color palette are made on the phone before upload; when the phone can't (say, HEIC in a browser that can't decode it), the server makes them with Cloudflare Images, and the piece shows a "Preview being made" tile meanwhile. The app only ever shows previews, never the original.
- **Add work**: photograph a piece and it opens ready to fill in.
- **Archive**: put a piece or an image out of sight without deleting it, e.g. sample data uploaded to try things out. Archived pieces leave the timeline, wall, search and "More like this", show an "Archived" badge, and come back with one tap (from the piece, or several at once from Filters → Only archived → Select to unarchive). Archiving the main image hands that role to the next image; bringing it back doesn't take it back.
- **Durable by design**:
  - A `record.json` sidecar sits next to each piece's images in R2.
  - A nightly JSON export of the whole database goes to `backups/` in R2.
  - Deletes are soft, and archiving is separate and reversible. Both keep everything in the export and `record.json`.
- **MCP endpoint** (`/mcp`): Claude can search, read and update the archive.

## Architecture

| Piece | Where |
|---|---|
| App shell | Vite + React SPA, served by the Worker as static assets |
| API | Hono on Workers (`worker/`) |
| Records | D1. Core columns plus `attrs` JSON described by `field_defs` |
| Images | R2: originals in **Infrequent Access**; `-display`, `-thumb`, `record.json` sidecars and backups in **Standard** (`worker/media.ts` decides per object) |
| Previews | Made on the phone at upload. When they're missing, a `preview` step in the `ArtworkIndexer` Workflow makes them with the **Cloudflare Images** binding (WebP, 1800px and 560px, plus size and palette). `/img` sends originals only as a download (`?download=1`); in-app images and the vision model use previews only |
| Search | Production: Workers AI embeddings (`bge-base-en-v1.5`) in Vectorize, plus D1 FTS5. Local: an offline embedding model stored in D1, plus FTS5. Keyword search sees a change at once; search by meaning once indexing finishes |
| Indexing | Cloudflare Workflow `ArtworkIndexer` (`worker/indexer.ts`): missing previews, vision description, embedding and Vectorize upsert as retried steps after the request returns. FTS5 and `record.json` are written inline. Local dev runs the same steps inline |
| Descriptions | Production: a Workers AI vision model describes the main image's display preview (never the original), as a Workflow step. If it keeps failing, the piece is indexed without one. Local: built from palette and fields |
| Login | **Cloudflare Access.** The app has no auth code; it verifies the Access JWT and reads the email |
| Backups | Cron trigger → `backups/YYYY-MM-DD.json` in R2 |

## Run it locally

```bash
npm install
npm run dev          # builds, applies D1 migrations, serves on http://localhost:8787
npm run seed         # optional, in another terminal: 14 sample works with 8 images each
```

Local development is fully offline: local D1 and R2, the offline embedding model, and a dev identity in place of Access. The `dev` environment in `wrangler.jsonc` controls this. It has no Images binding, so an upload without phone-made previews stays "Preview being made" locally (the original is still kept and downloadable). Local R2 accepts the Infrequent Access storage class but doesn't simulate it. For hot-reloading UI work, run `npm run dev:ui` (Vite on :5173, proxying to :8787).

The sample works use real titles from anneladdon.com, but the images are generated stand-ins, and the years, sizes and statuses are placeholders.

## Tests

```bash
npm run typecheck
npm run test:unit    # fields, Access JWT verification, embeddings, palette, indexing steps and order, archive decisions, storage classes and previews, production search backend (fakes)
npm run test:api     # 42 integration tests against three fresh `wrangler dev` servers (dev / no-auth / Access)
npm run test:e2e     # 21 browser steps in Chromium at 390×844 with touch, on a freshly seeded archive
npm test             # all of the above
```

The end-to-end run saves a screenshot for every step in `tests/shots/`. It needs Python Playwright with Chromium.

## Deploy

1. **Create the resources:**
   ```bash
   npx wrangler d1 create anne-archive            # put the id in wrangler.jsonc → d1_databases[0].database_id
   npx wrangler r2 bucket create anne-archive-images
   npx wrangler vectorize create anne-archive-artworks --dimensions=768 --metric=cosine
   ```
2. **Put Cloudflare Access in front of it.** In Zero Trust → Access → Applications, add a self-hosted application for the Worker's domain, with a policy allowing the family's email addresses (one-time PIN or Google login). Set the session duration to as long as one month so her phone stays signed in.
3. **Tell the Worker about Access** so it verifies the JWT and can't be reached around Access, for example via `workers.dev`. In `wrangler.jsonc` → `vars`:
   - `ACCESS_TEAM_DOMAIN`, e.g. `yourteam.cloudflareaccess.com`
   - `ACCESS_AUD`, the application's Audience (AUD) tag

   If these are empty in production, every API request returns 401. The Worker fails closed.
4. **Cloudflare Images** must be available on the account: `wrangler.jsonc` binds it as `"images": { "binding": "IMAGES" }`. It makes previews only for uploads that arrive without them; each is billed as a [unique transformation](https://developers.cloudflare.com/images/pricing/) (three per such image: display, thumb and a tiny palette sample). It reads at most 20 MB and doesn't read TIFF (or AVIF below Enterprise); those images show "No preview for this file" and can still be downloaded.
5. **Deploy:** `npm run deploy`. This builds, applies remote migrations, and runs `wrangler deploy`.

### Storage classes

New originals are written with `storageClass: "InfrequentAccess"`; previews, `record.json` and backups explicitly with `"Standard"`. Infrequent Access costs about a third less to store ($0.01 vs $0.015 per GB-month), but every read pays a retrieval fee ($0.01/GB), operations cost more, and each object is billed for at least 30 days even if removed or rewritten sooner. That suits originals, which are a backup read only by "Download original" (and once, by the preview step, when the phone sent no previews). Everything the app shows comes from Standard previews, and `/img` refuses to send an original without `?download=1`, so browsing never reads Infrequent Access.

Images uploaded before this change keep their keys and stay in Standard. To move them (and make any missing previews), run the backfill by hand; it only plans unless told to apply, and is safe to repeat:

```bash
node scripts/originals-to-ia.mjs --previews --tier --remote            # the plan (reads production D1)
node scripts/originals-to-ia.mjs --previews --tier --remote --apply    # start one Workflow instance per image
```

It starts `ArtworkIndexer` instances whose steps make previews first (while the original is still Standard), then rewrite the original in Infrequent Access with its metadata, skipping any already there. See the script's header for options.

No secrets are required: uploads go through the R2 binding, so there are no R2 API keys, and Access needs no client secret on the Worker. If you add third-party keys later, put them in **Secrets Store** and bind them with `secrets_store_secrets`.

## Data model

- `artworks`: catalog number (`YEAR-NNN` or `undated-NNN`, fixed at creation), title, year range, circa, status, `attrs` JSON, palette, AI description, cover image, version, `archived_at`/`archived_by` (migration 0003).
- `field_defs`: the schema for `attrs`. Add fields with `POST /api/fields`; the edit form and filters pick them up automatically.
- `images`: kind (`work`, `progress`, `study`, `reference`), label, R2 keys for the original/display/thumb (display/thumb are null until a preview exists; the API then reports `preview: "pending"` or `"unavailable"`), SHA-256 for duplicate detection, size, palette, `archived_at`/`archived_by`.
- `artwork_revisions`: a full snapshot on every change, with who made it.
- `artworks_fts`, `embeddings`: derived, rebuilt from the records. Archived pieces stay in both (and in Vectorize); search leaves them out at query time, so unarchiving makes a piece searchable again at once.

## API notes

- Archive state: `POST /api/artworks/:id/archive` and `/unarchive`, the same for `/api/images/:id`. Bulk: `POST /api/artworks/archive` or `/unarchive` with `{ "ids": [...] }` (ids or catalog numbers, up to 500), answering `{ changed, unchanged, notFound }`. Archiving a piece is a new version with a revision; repeating it changes nothing. `npm run seed` prints the bulk command for the works it added.
- `GET /api/artworks` and `GET /api/search` take `archived=exclude` (default), `include` or `only`. `GET /api/artworks/:id` always returns the piece, archived or not (`archivedAt`); there `archived` chooses its images, and `archivedImageCount` says how many are hidden.
- MCP: `search_artworks` takes `includeArchived`; `get_artwork` shows `archivedAt` for the piece and each image.

## Known limits / next steps

- **HEIC photos.** Browsers that can't decode HEIC upload the original without phone-made previews. In production, Cloudflare Images makes them in the indexing Workflow, usually within a minute; the piece shows "Preview being made" until then (it checks back a few times) and its main image is described once the preview exists. Locally there is no Images binding, so they stay pending. Originals over 20 MB, TIFF and AVIF get no server preview ("No preview for this file"); download the original instead. A preview that keeps failing stays pending: `scripts/originals-to-ia.mjs --previews` retries it.
- **Studies.** They are images attached to a finished piece. If one study fed several paintings, make studies their own records linked to each work.
- **MCP sign-in.** The Access application has **Managed OAuth** turned on, so Access itself is the OAuth server for `/mcp`. MCP clients get a `401` that points to Access's discovery metadata, and they sign in with the same family policy. The Worker needs no OAuth code: Access passes the usual `Cf-Access-Jwt-Assertion` header after resolving the token. Dynamic client registration allows the claude.ai/claude.com callbacks and any localhost or loopback redirect. Tokens last 1h, and the OAuth session lasts 720h. Connect with `claude mcp add --transport http art-archive https://art-archive.irving-family.workers.dev/mcp`, or add the URL as a custom connector in claude.ai.
- **Search quality.** The local embedding model is a small offline stand-in. Production search quality comes from Workers AI embeddings.
