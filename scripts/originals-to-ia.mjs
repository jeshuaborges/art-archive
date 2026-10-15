#!/usr/bin/env node
/**
 * One-off backfill, run by hand, never automatically. It does two things for
 * images uploaded before originals went to R2 Infrequent Access:
 *
 *   --previews   make the missing display/thumb previews (uploads the phone
 *                couldn't preview, e.g. HEIC), so the app stops showing
 *                "Preview being made" for them
 *   --tier       rewrite each original in Infrequent Access (originals of
 *                removed images too: they are still the backup)
 *
 * It only reads D1 and starts ArtworkIndexer Workflow instances; the work itself
 * happens in the Worker's own retried steps (worker/store.ts: makePreviews,
 * tierOriginal), which keep R2 metadata and are idempotent: an image that has its
 * previews, or an original already in Infrequent Access, is left alone (a rewrite
 * would restart its 30-day minimum and pay a retrieval). Running it twice is safe.
 *
 * Previews come first, so they read each original while it is still Standard.
 * Workflows only run in production, so --apply needs --remote. Without --apply it
 * prints the plan and changes nothing.
 *
 *   node scripts/originals-to-ia.mjs --previews --tier                    # plan, local dev DB
 *   node scripts/originals-to-ia.mjs --previews --tier --remote           # plan, production DB (read-only)
 *   node scripts/originals-to-ia.mjs --previews --tier --remote --apply   # do it (production)
 *
 * Options: --before 2026-10-15 (only images uploaded before then), --limit N.
 * Watch progress with: npx wrangler workflows instances list art-archive-indexer
 */
import { execFileSync } from "node:child_process";

const WORKFLOW = "art-archive-indexer";

// ----------------------------------------------------------- core (pure)
export function parseArgs(argv) {
  const o = { previews: false, tier: false, remote: false, apply: false, before: null, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--previews") o.previews = true;
    else if (a === "--tier") o.tier = true;
    else if (a === "--remote") o.remote = true;
    else if (a === "--apply") o.apply = true;
    else if (a === "--before") o.before = argv[++i];
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  if (!o.previews && !o.tier) throw new Error("Choose --previews, --tier or both");
  if (o.before !== null && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(o.before)) throw new Error("--before takes a date like 2026-10-15");
  if (!(o.limit > 0)) throw new Error("--limit takes a positive number");
  if (o.apply && !o.remote) throw new Error("--apply needs --remote: the Workflow only runs in production");
  return o;
}

/** The SQL for the candidates. `before` is validated by parseArgs (wrangler d1 execute takes no bound parameters). */
export function candidatesSql(o) {
  return `SELECT id, artwork_id, r2_key, display_key, thumb_key, content_type, bytes, deleted_at, created_at FROM images
          ${o.before ? `WHERE created_at < '${o.before}'` : ""} ORDER BY created_at`;
}

/** One Workflow instance per image that needs anything, with the steps it needs. */
export function plan(rows, o) {
  const out = [];
  for (const r of rows) {
    const preview = o.previews && !r.deleted_at && (!r.display_key || !r.thumb_key);
    if (!preview && !o.tier) continue;
    out.push({
      artworkId: r.artwork_id,
      ...(preview ? { previewImageId: r.id } : {}),
      ...(o.tier ? { tierOriginalImageId: r.id } : {}),
      // for the printout only
      key: r.r2_key, bytes: r.bytes,
    });
    if (out.length >= o.limit) break;
  }
  return out;
}

// ----------------------------------------------------------- shell
function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function readCandidates(o) {
  const where = o.remote ? ["--remote", "--env="] : ["--local", "--env", "dev"]; // --env= is the top level (production)
  const out = JSON.parse(wrangler(["d1", "execute", "DB", ...where, "--json", "--command", candidatesSql(o)]));
  return out[0]?.results ?? [];
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const jobs = plan(readCandidates(o), o);
  const gb = jobs.reduce((n, j) => n + (j.bytes || 0), 0) / 1e9;
  console.log(`${jobs.length} image(s): ${jobs.filter((j) => j.previewImageId).length} need previews${o.tier ? `, ${jobs.length} original(s) to check for Infrequent Access (${gb.toFixed(2)} GB at most)` : ""}`);
  for (const j of jobs) console.log(`  ${j.previewImageId ? "preview " : "        "}${j.tierOriginalImageId ? "tier " : "     "}${j.key}`);
  if (!o.apply) { console.log("\nPlan only. Add --remote --apply to start the Workflow instances."); return; }
  for (const { key, bytes, ...params } of jobs) {
    wrangler(["workflows", "trigger", WORKFLOW, JSON.stringify(params)]);
    console.log("started", key);
    await new Promise((r) => setTimeout(r, 250)); // gentle on the Workflows API
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message || e); process.exit(1); });
