# Anne Laddon · Archive

A phone-first archive for fifty years of Anne Laddon's work: every original, its studies, progress shots and reference photos, with the details that go with them. It runs as one Cloudflare Worker.

## What it does

- **Timeline**: scrub through the years on a draggable filmstrip, or jump to a decade. Swipe the hero image to step through pieces, and tap it to open the piece.
- **Wall**: a two-column masonry grouped by decade, with sticky headers and a decade rail for jumping.
- **One top row**: the Timeline/Wall toggle, an expanding search field, and filters.
- **Search by meaning**: try "warm sunsets over water". Results combine semantic vectors with full-text matching and show a match percentage.
- **Filters**: medium, subjects, style, series (any field marked filterable), where the piece is, color (from each image's palette), and a year range. Active filters appear as removable chips.
- **Piece view**:
  - Many images per piece, grouped as Finished, Progress, Studies and References, in a swipeable carousel.
  - "How it came together": the sequence from reference photo to finished work.
  - Image options: make main image, change type, rename, download original, remove.
  - More like this.
- **Editing on the phone**: every field is generated from the flexible field definitions. Saves use optimistic concurrency, and every save is kept as a revision.
- **Uploads**: from the camera, photo library or files, with progress shown. The original is stored untouched. Display and thumbnail versions and a color palette are made on the phone before upload.
- **Add work**: photograph a piece and it opens ready to fill in.
- **Durable by design**:
  - A `record.json` sidecar sits next to each piece's images in R2.
  - A nightly JSON export of the whole database goes to `backups/` in R2.
  - Deletes are soft.
- **MCP endpoint** (`/mcp`): Claude can search, read and update the archive.

## Architecture

| Piece | Where |
|---|---|
| App shell | Vite + React SPA, served by the Worker as static assets |
| API | Hono on Workers (`worker/`) |
| Records | D1. Core columns plus `attrs` JSON described by `field_defs` |
| Images | R2: originals, `-display`, `-thumb`, and `record.json` sidecars |
| Search | Production: Workers AI embeddings (`bge-base-en-v1.5`) in Vectorize, plus D1 FTS5. Local: an offline embedding model stored in D1, plus FTS5 |
| Descriptions | Production: a Workers AI vision model describes the main image. Local: built from palette and fields |
| Login | **Cloudflare Access.** The app has no auth code; it verifies the Access JWT and reads the email |
| Backups | Cron trigger → `backups/YYYY-MM-DD.json` in R2 |

## Run it locally

```bash
npm install
npm run dev          # builds, applies D1 migrations, serves on http://localhost:8787
npm run seed         # optional, in another terminal: 14 sample works with 8 images each
```

Local development is fully offline: local D1 and R2, the offline embedding model, and a dev identity in place of Access. The `dev` environment in `wrangler.jsonc` controls this. For hot-reloading UI work, run `npm run dev:ui` (Vite on :5173, proxying to :8787).

The sample works use real titles from anneladdon.com, but the images are generated stand-ins, and the years, sizes and statuses are placeholders.

## Tests

```bash
npm run typecheck
npm run test:unit    # fields, Access JWT verification, embeddings, palette, production search backend (fakes)
npm run test:api     # 25 integration tests against three fresh `wrangler dev` servers (dev / no-auth / Access)
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
4. **Deploy:** `npm run deploy`. This builds, applies remote migrations, and runs `wrangler deploy`.

No secrets are required: uploads go through the R2 binding, so there are no R2 API keys, and Access needs no client secret on the Worker. If you add third-party keys later, put them in **Secrets Store** and bind them with `secrets_store_secrets`.

## Data model

- `artworks`: catalog number (`YEAR-NNN` or `undated-NNN`, fixed at creation), title, year range, circa, status, `attrs` JSON, palette, AI description, cover image, version.
- `field_defs`: the schema for `attrs`. Add fields with `POST /api/fields`; the edit form and filters pick them up automatically.
- `images`: kind (`work`, `progress`, `study`, `reference`), label, R2 keys for the original/display/thumb, SHA-256 for duplicate detection, size, palette.
- `artwork_revisions`: a full snapshot on every change, with who made it.
- `artworks_fts`, `embeddings`: derived, rebuilt from the records.

## Known limits / next steps

- **HEIC photos.** Browsers that can't decode HEIC upload the original without phone-made previews, so the original is displayed directly. Adding Cloudflare Images transformations would cover that case.
- **Studies.** They are images attached to a finished piece. If one study fed several paintings, make studies their own records linked to each work.
- **MCP sign-in.** The Access application has **Managed OAuth** turned on, so Access itself is the OAuth server for `/mcp`. MCP clients get a `401` that points to Access's discovery metadata, and they sign in with the same family policy. The Worker needs no OAuth code: Access passes the usual `Cf-Access-Jwt-Assertion` header after resolving the token. Dynamic client registration allows the claude.ai/claude.com callbacks and any localhost or loopback redirect. Tokens last 1h, and the OAuth session lasts 720h. Connect with `claude mcp add --transport http art-archive https://art-archive.irving-family.workers.dev/mcp`, or add the URL as a custom connector in claude.ai.
- **Search quality.** The local embedding model is a small offline stand-in. Production search quality comes from Workers AI embeddings.
