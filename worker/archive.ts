/**
 * Archive: the functional core.
 *
 * Archiving puts an artwork or image out of sight without deleting it (unlike
 * deleted_at, it is meant to be undone). These are the pure decisions: which
 * records a read shows, the SQL fragments that express that, what happens to a
 * piece's cover when an image is hidden or comes back, and how a bulk request is
 * read and reported. The I/O lives in store.ts.
 */
import { z } from "zod";

/** exclude (default): leave archived out; include: show both; only: archived alone. */
export const ARCHIVED_MODES = ["exclude", "include", "only"] as const;
export type ArchivedMode = (typeof ARCHIVED_MODES)[number];

/** The `archived` query parameter; missing or blank means exclude, anything unknown is null. */
export function parseArchivedMode(v: string | null | undefined): ArchivedMode | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return "exclude";
  return (ARCHIVED_MODES as readonly string[]).includes(s) ? (s as ArchivedMode) : null;
}

export function isShown(archivedAt: string | null | undefined, mode: ArchivedMode): boolean {
  if (mode === "include") return true;
  return mode === "only" ? !!archivedAt : !archivedAt;
}

// ----------------------------------------------------------- SQL fragments
// Only ever built from the fixed column names below, never from input.

/** A WHERE condition on an archived_at column, e.g. "a.archived_at". */
export function archivedWhere(mode: ArchivedMode, col = "archived_at"): string {
  if (mode === "include") return "1 = 1";
  return mode === "only" ? `${col} IS NOT NULL` : `${col} IS NULL`;
}

/** A WHERE condition on a column holding artwork ids (e.g. the FTS table's artwork_id). */
export function archivedIdFilter(mode: ArchivedMode, idCol: string): string {
  if (mode === "include") return "1 = 1";
  return `${idCol} ${mode === "only" ? "IN" : "NOT IN"} (SELECT id FROM artworks WHERE archived_at IS NOT NULL)`;
}

/** The SET values and the guard for an archive/unarchive UPDATE; the guard makes a repeat a no-op. */
export function archivePatch(archived: boolean, at: string, by: string) {
  return archived
    ? { archivedAt: at, archivedBy: by, guard: "archived_at IS NULL" }
    : { archivedAt: null, archivedBy: null, guard: "archived_at IS NOT NULL" };
}

// ----------------------------------------------------------- vectors
/**
 * How many nearest vectors to ask for. Archived pieces stay in the vector index
 * and are filtered out after the query, so ask for enough to make up for them.
 */
export function vectorTopK(want: number, mode: ArchivedMode, archivedCount: number, max = 100): number {
  if (mode === "only") return max;
  return Math.min(max, want + (mode === "exclude" ? archivedCount : 0));
}

/** A filter for vector hits, given the ids of the archived pieces. */
export const shownIds = (mode: ArchivedMode, archived: ReadonlySet<string>) => (id: string) => isShown(archived.has(id) ? "archived" : null, mode);

// ----------------------------------------------------------- images and covers
export interface CoverCandidate {
  id: string; kind: string; sort_order: number; created_at: string;
  archived_at: string | null; deleted_at?: string | null;
}

const visible = (r: CoverCandidate) => !r.archived_at && !r.deleted_at;

/** The cover a piece falls back to: the first visible finished image, else the first visible image. */
export function pickCover(rows: CoverCandidate[]): string | null {
  const best = rows.filter(visible).sort((a, b) =>
    (Number(a.kind !== "work") - Number(b.kind !== "work")) || (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at))[0];
  return best ? best.id : null;
}

export type CoverDecision = { kind: "keep" } | { kind: "set"; imageId: string } | { kind: "clear" };

/** An image was archived or removed: a cover that was something else stays; otherwise the next one takes over. */
export function coverAfterHiding(coverId: string | null, hiddenId: string, rows: CoverCandidate[]): CoverDecision {
  if (coverId !== hiddenId) return { kind: "keep" };
  const next = pickCover(rows.filter((r) => r.id !== hiddenId));
  return next ? { kind: "set", imageId: next } : { kind: "clear" };
}

/**
 * An image came back: it never takes the cover from a visible one. If the piece
 * had no visible cover (say every image was archived), the usual fallback picks one.
 */
export function coverAfterRestoring(coverId: string | null, rows: CoverCandidate[]): CoverDecision {
  if (coverId && rows.some((r) => r.id === coverId && visible(r))) return { kind: "keep" };
  const next = pickCover(rows);
  return next ? { kind: "set", imageId: next } : { kind: "keep" };
}

/** Split a piece's images for a read: what to show, and how many are archived. */
export function selectImages<T extends { archived_at: string | null }>(rows: T[], mode: ArchivedMode) {
  return { shown: rows.filter((r) => isShown(r.archived_at, mode)), archivedCount: rows.filter((r) => r.archived_at).length };
}

// ----------------------------------------------------------- bulk
export const bulkIdsSchema = z.object({ ids: z.array(z.string().trim().min(1).max(100)).min(1).max(500) }).strict();

export type BulkOutcome = "changed" | "unchanged" | "notFound";

/** The ids of a bulk request, deduplicated in order. */
export const uniqueIds = (ids: string[]) => [...new Set(ids)];

/** The bulk response: which ids changed, were already in that state, or weren't found. */
export function tallyBulk(outcomes: [string, BulkOutcome][]) {
  const out: Record<BulkOutcome, string[]> = { changed: [], unchanged: [], notFound: [] };
  for (const [id, o] of outcomes) out[o].push(id);
  return out;
}

// ----------------------------------------------------------- export
export const countArchived = (rows: { archived_at?: unknown }[]) => rows.filter((r) => r.archived_at != null).length;
