# Anne Laddon · Archive

A phone-first archive for fifty years of Anne Laddon's work: every original, its studies, progress shots and reference photos, with the details that go with them. It runs as one Cloudflare Worker.

## Status (October 2026)

- **Live** at https://art-archive.irving-family.workers.dev, on the Irving Family Cloudflare account, behind Cloudflare Access (family policy, 30-day sessions). Install it on a phone with Share → Add to Home Screen.
- **Data:** the live archive has no real pieces yet. `1999-001` "MCP test piece (sample data)" is archived; see it under Filters → Only archived.
- **Verified in production over MCP:**
  - URL uploads, with server-made previews (WebP display, thumb, size, palette).
  - Originals stored in Infrequent Access and previews in Standard.
  - All Workflow steps (preview, describe, refresh text, embed, upsert).
  - Search by meaning.
  - Archiving and unarchiving images and pieces, including the cover handover.
- **Verified locally only:**
  - The landscape layouts and the lavender accent, in a desktop browser at phone and tablet sizes.
  - The full-screen fix for the home-screen app, which has not yet been tried on a real iPhone.
  - Re-describing when the cover changes, checked with fakes and database tests (there is no vision model locally).
  - The iPhone fixes from `docs/iphone-web-app-audit.md` (its Status column says which need a real device): home-screen icon and manifest, the "You've been signed out" prompt (shown with a simulated 401), keyboard-aware sheets, self-hosted fonts, smaller decodes of big photos.

## What it does

- **Timeline**: scrub through the years on a draggable filmstrip, or jump to a decade. Swipe the hero image to step through pieces, and tap it to open the piece.
- **Wall**: a two-column masonry grouped by decade, with sticky headers and a decade rail for jumping.
- **One top row**: the Timeline/Wall toggle, an expanding search field, and filters.
- **Either way up**: on a phone held sideways (or a tablet or desktop) the timeline puts the painting large on the left with the filmstrip under it and the label, decade jumps and Add work beside it; the wall grows to 3–6 columns; a piece shows its images on the left and details on the right. Rotating keeps your place. It fills the screen edge to edge from the home screen, with controls kept clear of the notch and home indicator.
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
- **MCP endpoint** (`/mcp`): Claude can search, read, create and update pieces, add images, and archive or unarchive pieces and images.

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
| Descriptions | Production: a Workers AI vision model describes the main image's display preview (never the original), as a Workflow step, and `ai_description_image_id` records which image it described. When a different finished work becomes the main image (chosen, or after the old one is archived or removed), it is described again; a description someone typed or edited (no image id) is never replaced. If it keeps failing, the piece is indexed without one. Local: built from palette and fields |
| Layout | `src/layout.ts` (pure sizing: orientation, hero box, filmstrip spacing, wall columns) and `src/viewport.ts` (follows resize and rotation). The app sets `data-layout` (portrait/landscape) and `data-compact` on the shell, so CSS and JS agree. Landscape means wider than tall and at least 560px wide; compact means 500px tall or less. The shell is `position: fixed` on all four edges, with `100vh` in home-screen mode (`html.standalone`). Safe-area variables (`--sat/--sab/--sal/--sar`, gutters `--gl/--gr`) keep controls clear of the notch and home indicator in both orientations |
| Home screen | `public/manifest.webmanifest` (name "Anne Laddon · Archive", label "Archive", standalone) and the icons in `public/`, rendered from `public/icon.svg` by `npm run icons` (re-run after editing the SVG and commit the PNGs). Fonts are self-hosted from `@fontsource-variable` (`src/fonts.css`), latin only |
| Signed out | Every API request sends `X-Requested-With: XMLHttpRequest`, so Access answers an expired session with 401 instead of a redirect to its login page; `src/session.ts` classifies responses (`ok`, `signed-out`, `offline`, `error`). A 401 shows a "You've been signed out" prompt whose Sign in button reloads the page, and coming back to the app checks `GET /api/me` at most once a minute |
| Keyboard | `useKeyboardInset` (`src/viewport.ts`) follows `visualViewport` and sets `--kb` on `<html>` to the height the on-screen keyboard covers; sheets and the edit form pad their scroll areas by it, and a focused field is scrolled above the keyboard |
| Theme | Tokens in `src/styles.css` `:root`. Highlights (focus ring, primary buttons, selection, filter badge, playhead, catalog numbers) use `--accent`, `--accent-soft`, `--accent-rgb` and `--on-accent`, currently pointed at lupine lavender; change those four lines to re-theme. Status colours (`STATUS_COLOR`) and image-kind colours (`KIND_META`, e.g. Finished orange, Study lavender) are category palettes and stay separate |
| Login | **Cloudflare Access.** The app has no auth code; it verifies the Access JWT and reads the email. MCP clients sign in through Access Managed OAuth (see below). Scripts such as the importer use an Access **service token**: the same JWT check, with changes attributed to `service:<name>` |
| Backups | Cron trigger → `backups/YYYY-MM-DD.json` in R2 |

## Run it locally

```bash
npm install
npm run dev          # builds, applies D1 migrations, serves on http://localhost:8787
npm run seed         # optional, in another terminal: 14 sample works with 8 images each
```

Local development is fully offline: local D1 and R2, the offline embedding model, and a dev identity in place of Access. The `dev` environment in `wrangler.jsonc` controls this. It has no Images binding, so an upload without phone-made previews stays "Preview being made" locally (the original is still kept and downloadable). Local R2 accepts the Infrequent Access storage class but doesn't simulate it. For hot-reloading UI work, run `npm run dev:ui` (Vite on :5173, proxying to :8787).

The sample works use real titles from anneladdon.com, but the images are generated stand-ins, and the years, sizes and statuses are placeholders.

### Iterating against the real archive

```bash
npm run dev:prod     # Vite with hot reload on http://localhost:5174, using the live archive's data
```

This mode runs the UI from your working copy, so edits show instantly. `/api`, `/img` and `/mcp` go to the production Worker, authenticated with the importer's Access service token.

- **Setup:** put the token in `.env.local`, which is gitignored and should be mode 600: `ARCHIVE_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`. These are the same values as `art-archive-importer/.env`.
- **Read-only by default:** the proxy refuses POST, PATCH, PUT and DELETE before they leave your machine. Set `ARCHIVE_ALLOW_WRITES=1` in `.env.local` only when you mean to change the live archive. Changes are then attributed to the service token, not to you.
- **Launchers:** `.claude/launch.json` has three entries for the desktop app's browser pane:
  - `archive-real-data` runs `dev:prod`.
  - `archive-local` runs `dev`.
  - `archive-local-hot-reload` runs `dev:ui`, which needs `archive-local` running too.

## Tests

```bash
npm run typecheck
npm run test:unit    # layout (orientation, hero, filmstrip and wall sizing, keyboard inset), signed-out detection, phone preview sizes, fields and inventory numbers, Access JWT verification (people and service tokens), embeddings, palette, indexing steps and order, archive decisions, storage classes and previews, production search backend (fakes), MCP tool arguments
npm run test:api     # 46 integration tests against three fresh `wrangler dev` servers (dev / no-auth / Access)
npm run test:e2e     # 21 browser steps in Chromium at 390×844 with touch, on a freshly seeded archive
npm test             # all of the above
```

The end-to-end run saves a screenshot for every step in `tests/shots/`. It needs Python Playwright with Chromium.

## Deploy

1. **Create the resources:**
   ```bash
   npx wrangler d1 create art-archive             # put the id in wrangler.jsonc → d1_databases[0].database_id
   npx wrangler r2 bucket create art-archive-images
   npx wrangler vectorize create art-archive-artworks --dimensions=768 --metric=cosine
   ```
   These already exist on the Irving Family account (`account_id` in `wrangler.jsonc`). The `art-archive-indexer` Workflow is created by `wrangler deploy`.
2. **Put Cloudflare Access in front of it.** In Zero Trust → Access → Applications, add a self-hosted application for the Worker's domain, with a policy allowing the family's email addresses (one-time PIN or Google login). Set the session duration to as long as one month so her phone stays signed in.
3. **Tell the Worker about Access** so it verifies the JWT and can't be reached around Access, for example via `workers.dev`. In `wrangler.jsonc` → `vars`:
   - `ACCESS_TEAM_DOMAIN`, e.g. `yourteam.cloudflareaccess.com`
   - `ACCESS_AUD`, the application's Audience (AUD) tag

   If these are empty in production, every API request returns 401. The Worker fails closed.
4. **Service token for the importer** (optional; only scripts need it). In Zero Trust → Access → Service credentials → Service Tokens, create a token (e.g. `art-archive-importer`) and keep its Client ID and Secret outside the repo. On the Access application, add a policy with action **Service Auth** that includes that service token. The importer sends `CF-Access-Client-Id: <id>` and `CF-Access-Client-Secret: <secret>` on every request; Access then forwards a `Cf-Access-Jwt-Assertion` whose payload has no `email` but `common_name` = the Client ID. The Worker verifies it exactly like a person's (signature, `ACCESS_AUD`, issuer, expiry) and attributes changes to `service:<Client ID>`. For a friendlier name, set `SERVICE_TOKEN_NAMES` in `vars`, e.g. `{"<client id>.access":"importer"}` → `service:importer`. A JWT with neither `email` nor `common_name` is refused. The importer uses the REST API like the phone: `GET /api/fields`, `GET /api/artworks` (all summaries with `attrs`, so it can map inventory numbers to ids on its side), `POST /api/artworks`, `PATCH /api/artworks/:id`, `POST /api/artworks/:id/images` (multipart `original` + `display` + `thumb` + `meta`), `POST /api/artworks/archive`. `GET /api/search?q=OP%201154` also puts an exact inventory number first.
5. **Cloudflare Images** must be available on the account: `wrangler.jsonc` binds it as `"images": { "binding": "IMAGES" }`. It makes previews only for uploads that arrive without them; each is billed as a [unique transformation](https://developers.cloudflare.com/images/pricing/) (three per such image: display, thumb and a tiny palette sample). It reads at most 20 MB and doesn't read TIFF (or AVIF below Enterprise); those images show "No preview for this file" and can still be downloaded.
6. **Deploy:** `npm run deploy`. This builds, applies remote migrations (`0001`–`0005`), and runs `wrangler deploy`. Set `CLOUDFLARE_ACCOUNT_ID=9962565b22f960c8f86eb6597a4bd559` if your login can see several accounts. If the migration step fails with code 7403, run `npx wrangler d1 migrations apply DB --remote --env=""` and then `npx wrangler deploy --env=""` separately; this happened once and didn't recur.
7. **Home-screen manifest and icons behind Access.** `/manifest.webmanifest`, `/apple-touch-icon.png`, `/icon-*.png` and `/favicon*` are static files behind Access like the rest of the app. The manifest link uses `crossorigin="use-credentials"` so it's fetched with the Access cookie, and Safari fetches the touch icon while the user is signed in, so no change to Access should be needed. If an installed copy shows a letter (monogram) instead of the icon, add an Access **Bypass** policy for just those paths; they contain nothing private.
8. **MCP sign-in:** turn on **Managed OAuth** for the Access application (Advanced settings), with dynamic client registration allowing `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` and localhost/loopback. This is already done for the live app.

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

- `artworks`: catalog number (`YEAR-NNN` or `undated-NNN`, fixed at creation), title, year range, circa, status, `attrs` JSON, palette, AI description and `ai_description_image_id` (the image it was generated from; null means a person wrote it; migration 0004), cover image, version, `archived_at`/`archived_by` (migration 0003).
- `field_defs`: the schema for `attrs`. Add fields with `POST /api/fields`; the edit form and filters pick them up automatically. `inventory` ("Inventory no.", text up to 40, shown first, not a filter since every value is unique; migration 0005) holds Anne's own number, e.g. `OP 1154` (OP oil, PA pastel). Search matches it exactly, ignoring case, spaces, dots, hyphens and slashes (`op1154` finds `OP 1154`).
- `images`: kind (`work`, `progress`, `study`, `reference`), label, R2 keys for the original/display/thumb (display/thumb are null until a preview exists; the API then reports `preview: "pending"` or `"unavailable"`), SHA-256 for duplicate detection, size, palette, `archived_at`/`archived_by`.
- `artwork_revisions`: a full snapshot on every change, with who made it.
- `artworks_fts`, `embeddings`: derived, rebuilt from the records. Archived pieces stay in both (and in Vectorize); search leaves them out at query time, so unarchiving makes a piece searchable again at once.

## API notes

- Archive state: `POST /api/artworks/:id/archive` and `/unarchive`, the same for `/api/images/:id`. Bulk: `POST /api/artworks/archive` or `/unarchive` with `{ "ids": [...] }` (ids or catalog numbers, up to 500), answering `{ changed, unchanged, notFound }`. Archiving a piece is a new version with a revision; repeating it changes nothing. `npm run seed` prints the bulk command for the works it added.
- `GET /api/artworks` and `GET /api/search` take `archived=exclude` (default), `include` or `only`. `GET /api/artworks/:id` always returns the piece, archived or not (`archivedAt`); there `archived` chooses its images, and `archivedImageCount` says how many are hidden.
- MCP (`worker/mcp.ts`; argument parsing in `worker/tools.ts`). Changes are attributed to `mcp:<email>`. `GET /api/me` answers `{ actor, email, via }`: `actor` is what changes are attributed to (the email, or `service:<name>` with `email: null` and `via: "service"` for a service token).
  - `search_artworks` `{ query?, medium?, status?, yearFrom?, yearTo?, limit?, includeArchived? }`: archived pieces are left out unless `includeArchived`.
  - `get_artwork` `{ id }` (id or catalog number): all fields and images, with `archivedAt` and `preview` for each image.
  - `list_fields` `{}`; `update_artwork` `{ id, version, title?, yearStart?, yearEnd?, circa?, status?, attrs? }`.
  - `create_artwork` `{ title?, yearStart?, yearEnd?, circa?, status?, attrs? }`: the same input as `POST /api/artworks`; returns the piece.
  - `add_image` `{ artworkId, kind, caption?, makeCover?, base64?, filename?, contentType?, url? }`: exactly one of `base64` (a `data:` URL works too) or `url` (public http(s) only; private and loopback hosts, credentials and redirects to them are refused). Up to 80 MB, like uploads. It goes through the same upload code as the app but sends no previews, so the server makes them (`preview: "pending"` until then; it stays pending locally). Returns the image and whether it was a duplicate.
  - `archive_artworks` `{ ids, archived? }` (ids or catalog numbers, up to 500; `archived: false` brings them back): answers `{ changed, unchanged, notFound }`.
  - `archive_image` `{ imageId, archived? }`: answers the piece's `coverImageId` afterwards.
  - Bad arguments are JSON-RPC "invalid params" (`-32602`); not found, conflicts and rejected files come back as tool errors (`isError`).

## Known limits / next steps

- **HEIC photos.** Browsers that can't decode HEIC upload the original without phone-made previews. In production, Cloudflare Images makes them in the indexing Workflow, usually within a minute; the piece shows "Preview being made" until then (it checks back a few times) and its main image is described once the preview exists. Locally there is no Images binding, so they stay pending. Originals over 20 MB, TIFF and AVIF get no server preview ("No preview for this file"); download the original instead. A preview that keeps failing stays pending: `scripts/originals-to-ia.mjs --previews` retries it.
- **Studies.** They are images attached to a finished piece. If one study fed several paintings, make studies their own records linked to each work.
- **MCP sign-in.** The Access application has **Managed OAuth** turned on, so Access itself is the OAuth server for `/mcp`. MCP clients get a `401` that points to Access's discovery metadata, and they sign in with the same family policy. The Worker needs no OAuth code: Access passes the usual `Cf-Access-Jwt-Assertion` header after resolving the token. Dynamic client registration allows the claude.ai/claude.com callbacks and any localhost or loopback redirect. Tokens last 1h, and the OAuth session lasts 720h. Connect with `claude mcp add --transport http art-archive https://art-archive.irving-family.workers.dev/mcp`, or add the URL as a custom connector in claude.ai.
- **MCP tool list.** The server says its tool list never changes (`listChanged: false`), so clients keep the list they first saw. After adding or changing tools, reconnect the connector to see them.
- **Search quality.** The local embedding model is a small offline stand-in. Production search quality comes from Workers AI embeddings.
- **Not yet checked on a real iPhone:** the safe areas and full-screen fix in the home-screen app, in both orientations (the browser can't simulate iOS safe areas); and the items marked "device test" in `docs/iphone-web-app-audit.md`: the installed icon and label, signing in again after the Access session expires (in the installed app), the keyboard with the edit sheet, what the photo pickers hand over for HEIC (the app logs each picked file's name, type and size with `console.debug`), and a 48 MP upload.
- **Large tablets in landscape.** At 1366×1024 the timeline painting fills only part of the left column; it could grow.
- **End-to-end tests** need Python Playwright with Chromium, which isn't installed on the dev machine, and they cover portrait only.
