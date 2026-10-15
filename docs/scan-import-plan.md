# Importing the painting scans

A plan for turning `/Volumes/Express/Shared/Painting Scans Tiffs n jpgs` into ordered, well-described pieces in the archive. Nothing in that folder is changed at any step; it is only read.

## What's in the folder

A read-only survey (October 2026) found:

| | |
|---|---|
| Size | 24 GB, 4,225 files in 186 folders; most files (4,022) loose at the top level |
| Images | 4,125 readable images: about 3,350 JPEG and about 700 TIFF by content. About 107 files have lost their extension, and 4 can't be read at all |
| Exact copies | 1,097 redundant files in 974 groups, about 5.6 GB |
| Near copies | 3,037 distinct files fall into **1,769 visual clusters**: resized exports, TIFF masters with JPG copies, reshoots and camera bursts. Keeping one master per cluster saves about 13 GB |
| Artworks | About **1,250 inventory numbers**: OP (oil) 900, PA (pastel) 366, plus a few AC (France 2012 series), WC (Spain series, 1591–1597) and SP (serigraphs). 29 folders have no number |
| Dates | 92% of images carry a camera capture date. Cameras: Nikon D70 (2004–07), D80 (2007–11), D90 (2011–26), iPhones, and a professional shoot by "Ron Bez Photography" (2013) |
| Descriptive metadata | None embedded: no titles, keywords or captions in EXIF, IPTC or XMP |
| anneladdon.com | 898 listed works. **Its SKU is her inventory number** (about 760 OP/PA). It has official titles and some sizes, and years only for newer works |

The naming grammar is `<MEDIUM> <NUMBER>[.5] <Title> [shot words]`, for example `OP 1154 Rd to Bradley reshot D90`. Shot words describe the photograph, not the painting:

- **Reshoots and edits:** reshot, redo, retouched, adjusted, lighter, D90, Orig File
- **Sizes and formats:** sml, large, tiff, a size like 24x30
- **Finder copies:** a trailing " 2" or " copy"
- **Print versions:** "for MFA", "for justine", "for card", "for mug"

### Dating evidence

The inventory number rises steadily with time from about #800 up. Using the earliest capture date per piece (1,098 pieces):

| Inventory # | Median capture year | Spread (p10–p90) |
|---|---|---|
| 800–999 | 2007 | 2006–2008 |
| 1000–1199 | 2010–2011 | 2008.8–2012 |
| 1200–1399 | 2012–2013 | 2012.2–2013.7 |
| 1400–1599 | 2014–2016 | 2014–2016.5 |
| 1600–1699 | 2018 | 2016.8–2019.2 |
| 1700–1799 | 2020–2021 | 2020–2021.8 |
| 1800–1899 | 2023 | 2022.6–2024.3 |
| 1900+ | 2025–2026 | 2024.7–2026.2 |

The correlation is 0.996 (Spearman). Below #800, numbers were assigned in a 2005 cataloguing: most were photographed in 2005 on the D70, so their capture date is only a "painted no later than" date. Her bio says she ran a silkscreen studio at the Torpedo Factory from 1975 to 1984 and moved to Cambria in 1984, which helps place the early SP serigraphs.

## Principles

1. **One piece per inventory key.** The key is medium + number, e.g. `OP 1154`. Medium matters because 23 numbers were used for both an oil and a pastel (e.g. OP 1062 and PA 1062 "Cowboy Bar"). Titles vary between copies ("Where the Blue Begins" vs "Blue Begins redo"), so group by number, never by title.
2. **Keep the best original, not every copy.** Within a piece, collapse exact copies, then keep one master per visual cluster: the largest image, preferring lossless TIFF. Keep a distinct reshoot only when it looks different (lighting, before and after retouching). Skip Finder copies, small exports and print versions unless one is the best master.
3. **Every fact records where it came from.** Each value is tagged with its source: website, folder name, camera date or estimate. Estimates are marked circa. Nothing guessed is presented as known.
4. **Bytes move through a script; judgment comes from Claude or a person.** 24 GB of TIFFs can't travel through MCP tool calls (base64 in a conversation). A local importer uploads files. Claude, over MCP, does the judgment work: matching titles, resolving conflicts, writing notes, checking results.
5. **Pilot, then batches, and everything is reversible.** Each batch is imported, checked, and archived (not deleted) if it's wrong. A local manifest makes re-runs skip what's already uploaded; the server also refuses duplicate files by SHA-256.

## Pipeline

### Phase 1 — Manifest (done as a survey; make it permanent)

Move the survey outputs from the session scratchpad to a durable working folder, e.g. `~/art-archive-import/`, outside the repo and backed up. The files are `files.tsv`, `metadata.tsv`, `sha256.tsv`, `raw.tsv`, `clusters.tsv`, `website_catalog.tsv` and `pieces.tsv`. Turn the survey scripts into one re-runnable `scripts/import/manifest.py`. It detects file type from content, not extension. For each file it records the SHA-256, a 64-bit dHash (a fingerprint of how the image looks), size and EXIF, and parses the name.

### Phase 2 — Group into pieces

- Assign every image to an inventory key, from its file name first and its folder second. Root files with a title but no number ("Cupcake", "Haybales") are matched against the website and other folders' titles, or else queued for review.
- Thematic folders without numbers become **series** (`Youth Portraits`, `Zin Fest`, `River Paintings`, `Anne Bar Paintings`) or **exhibitions** (`ADM Show 05`). `No Cnty Roads Orig File` belongs to OP 1040 "North County Roads".
- Ignore `_Desktop` (email saves and Studios on the Park paperwork) and `.DS_Store`, `.BridgeSort`, `.js` and `.html`.
- **Conflicts go to a review queue, never auto-merged:**
  - the 23 OP/PA shared numbers;
  - 67 visual clusters spanning two inventory numbers (e.g. OP 1470/1476, OP 836–839, PA 1668/1678 typos);
  - folders whose files carry another number (`OP 1828 Hearts/OP 1827 …`);
  - the 4 unreadable files.

### Phase 3 — Choose images per piece

1. Drop exact copies by SHA-256.
2. Cluster the rest by dHash at a distance of 6 or less, with an aspect-ratio guard. Use a distance of 10 or less only to suggest a review, never to merge automatically.
3. Pick the master per cluster: among members within 90% of the largest pixel count, prefer TIFF/PNG/PSD, then more pixels, then more bytes.
4. Classify each kept image into the app's kinds:
   - **work:** the finished painting. The best-lit master becomes the main image.
   - **progress:** "before/after retouch" or a dated sequence on the easel.
   - **study:** "study" in the name, or a pastel the website says inspired an oil (link both pieces in notes).
   - **reference:** source photos, if any are found.
5. Typical result: 1–3 images per piece rather than a dozen copies.

### Phase 4 — Metadata per piece

| Field | Source, in order of trust |
|---|---|
| Title | Website title by SKU (official) → cleaned folder title → cleaned file title (shot words stripped, typos kept in notes) |
| Medium | OP → Oil, PA → Pastel, AC → Acrylic?, WC → Watercolor, SP → Serigraph. AC needs confirming |
| Year | Website text year → for #800 and up, the year of the earliest non-reshoot capture (circa, typically within months of finishing) → for #800 and up without a date, the year from the number table (circa, "estimated from inventory number") → below #800, no year: catalogued as undated, with notes "photographed by 2005" |
| Size | Website text or SKU (e.g. `OP 1154 24x30`) → a size like 24x30 in the file name |
| Series | Website gallery for newer works; thematic folders; the WC Spain and AC France series |
| Status | `unknown` by default. The website can't tell sold from available, so the family fills this in |
| Inventory number | New text field `inventory` (filterable), e.g. `OP 1154`. Searchable, and how the family thinks of the work |
| Notes | Provenance: source files, how the year was decided, alternative titles, the photographer for Ron Bez shots, website URL |

The app's catalog number (`YEAR-NNN`) comes from the year, so getting the year right before upload matters. The catalog number can't change afterwards; the inventory number is the stable identifier.

### Phase 5 — Review

Produce a review sheet, an interactive page the family can open on a phone or laptop. It has one row per piece: thumbnail, proposed title, year (and how it was found), medium, size, the images kept and dropped, and conflicts flagged. Approving or editing rows feeds the importer. Claude Sonnet sub-agents can do a first pass on the conflict queue: compare thumbnails, match titles to the website, propose a resolution. A person confirms.

### Phase 6 — Upload

- **Importer:** a Node script at `scripts/import/upload.mjs`. It runs through approved manifest rows, creates each piece and uploads its images.
- **Previews made locally.** Cloudflare Images can't read TIFF or anything over 20 MB, so the importer makes the display and thumb previews and the palette locally with `sharp` (already a dependency). It sends them with the original, as the phone does. The original goes to R2 Infrequent Access.
- **Authentication.** The importer can't use the browser sign-in. Recommended: an **Access service token** scoped to this app, with a Service Auth policy. The Worker would need a small change to accept that token for the API, attributing changes to `import:<token name>`. Alternatives are an OAuth token from the Managed OAuth flow used through the MCP endpoint (it can't send local previews), or `cloudflared access`.
- **Order of work:**
  1. Pilot: 20 pieces across the range (old PA, 2005 OP, D90 reshoots, a series, a conflict), uploaded and then **archived** as sample data. Review them in the app on a phone in both orientations, and check descriptions and search.
  2. Fix the rules, then unarchive the good ones or re-import.
  3. Batches of about 100 pieces in inventory order. After each batch, Claude checks it over MCP: counts, missing previews, duplicate warnings, the year distribution on the timeline.
- **Cost:** about 11–12 GB of masters in Infrequent Access is cents per month. Vision descriptions and embeddings run once per piece through the indexing Workflow.

### Phase 7 — Order

Once the pieces are in, the archive has a real timeline from about 2005 on, and an undated shelf for older work until the family dates it. Order comes from:

- **Timeline and Wall by year:** estimated years show as circa.
- **Filters:** inventory number, medium, series, decade and colour.
- **Series:** website galleries and the thematic folders.
- **Lineage:** pastel studies linked to the oils they led to.
- **Search by meaning:** each piece gets a vision description, so "haybales at sunset" finds the right works whatever they were named.
- **Follow-up passes over MCP:** fill status (sold, gifted, where it hangs), sizes and stories. These are best done as sessions with the family.

## Decisions needed

1. **Pre-2005 dating:** leave pieces below #800 undated (with "photographed by 2005" in notes), or try to place them, from family memory or rough decade guesses?
2. **What to keep:** only the best master per piece, or also distinct reshoots? Should print versions ("for MFA") and phone re-photos be dropped entirely?
3. **Inventory field:** add `inventory` as a visible, filterable field? Recommended.
4. **Importer access:** create an Access service token for the importer and allow it in the Worker? Recommended. Or upload through MCP only, which can't send TIFF previews.
5. **AC medium:** is AC acrylic? Is SP serigraph for all SP numbers?

## Work to build

| Piece | Who |
|---|---|
| `scripts/import/manifest.py` (from the survey scripts) | Sonnet sub-agent |
| Grouping, master choice and metadata rules, as pure functions with tests (`scripts/import/plan.mjs`) | Opus sub-agent |
| Review sheet (interactive page or CSV) | Opus sub-agent |
| Service-token auth for the importer (Worker + Access policy) | Here, with your OK |
| `scripts/import/upload.mjs` with local previews, manifest resume and batch reports | Opus sub-agent |
| Conflict-queue first pass, title matching, post-batch checks over MCP | Sonnet sub-agents |
