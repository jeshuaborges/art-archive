/**
 * Indexing: the functional core.
 *
 * Pure builders (FTS row, record.json, embedding text, vision prompt/parsing and
 * the decisions) plus `runIndexing`, which sequences the slow steps (including
 * making an upload's previews on the server when the phone couldn't). The steps
 * themselves are I/O and live in store.ts (`indexOps`); `runIndexing` gets them
 * injected along with a step runner: the `ArtworkIndexer` Workflow's `step.do`
 * in production, or `inlineStep` (call it now) in local dev and as a fallback.
 * Nothing here may import "cloudflare:workers" at runtime: unit tests import it.
 */
import type { WorkflowStepConfig } from "cloudflare:workers";
import { colorName } from "./embed";
import { formatValue, searchText, type FieldDef } from "./fields";
import { describeSource } from "./media";
import type { ArtworkDTO } from "./store";

/**
 * `describeKey`: a display preview to describe. `previewImageId`: an image whose
 * previews the server must make first; with `describePreview`, its new display
 * preview is then described (it is the piece's new main image). `tierOriginalImageId`:
 * move that image's original (uploaded before originals went to Infrequent
 * Access) to Infrequent Access; only scripts/originals-to-ia.mjs asks for it.
 */
export interface IndexParams { artworkId: string; describeKey?: string; previewImageId?: string; describePreview?: boolean; tierOriginalImageId?: string }

// ----------------------------------------------------------- text builders
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

/** Column values for the artworks_fts row. */
export function ftsRow(a: ArtworkDTO, defs: FieldDef[]) {
  return { artwork_id: a.id, catalog_id: a.catalogId, title: a.title, attrs_text: searchText(defs, a.attrs), ai_description: a.aiDescription || describeLocally(a) };
}

export const sidecarKey = (a: Pick<ArtworkDTO, "catalogId">) => `artworks/${a.catalogId}/record.json`;

/**
 * The self-describing record.json kept next to a piece's images in R2. `a` is read
 * with all of its images: archived ones stay listed, marked with when and by whom.
 */
export function sidecarRecord(a: ArtworkDTO, defs: FieldDef[], statusLabels: Record<string, string>) {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return {
    format: "anne-laddon-archive-record/v1",
    catalogId: a.catalogId, title: a.title,
    year: { start: a.yearStart, end: a.yearEnd, circa: a.circa },
    status: statusLabels[a.status] || a.status,
    archived: a.archivedAt ? { at: a.archivedAt, by: a.archivedBy } : null,
    fields: Object.entries(a.attrs).map(([key, value]) => {
      const d = byKey.get(key);
      return { key, label: d?.label ?? key, value, display: d ? formatValue(d, value) : String(value) };
    }),
    description: a.aiDescription, palette: a.palette,
    images: a.images.map((i) => ({
      file: i.original?.split("/").pop(), kind: i.kind, role: i.role, caption: i.caption, sha256: i.sha256, width: i.width, height: i.height,
      ...(i.archivedAt ? { archived: { at: i.archivedAt, by: i.archivedBy } } : {}),
    })),
    version: a.version, updatedAt: a.updatedAt,
  };
}

// ----------------------------------------------------------- vision
export const DEFAULT_VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
export const describePrompt = () => "Describe this artwork for a search index in two sentences: subject, setting, colors, mood and style.";

/** Production only (Workers AI configured), and never over an existing description or a removed piece. */
export function shouldDescribe(o: { describeKey?: string; visionReady: boolean; row: { ai_description: string | null; deleted_at: string | null } | null }): boolean {
  return !!o.describeKey && o.visionReady && !!o.row && !o.row.deleted_at && !o.row.ai_description?.trim();
}

/** The vision model's answer as a description, or null when it said nothing. */
export function parseVisionOutput(out: unknown): string | null {
  const o = (out && typeof out === "object" ? out : {}) as { description?: unknown; response?: unknown };
  const raw = typeof o.description === "string" && o.description.trim() ? o.description : typeof o.response === "string" ? o.response : "";
  const text = raw.trim().slice(0, 4000);
  return text || null;
}

// ----------------------------------------------------------- vectors
export interface Embedded { text: string; vec: number[] }
export type UpsertOutcome = "upserted" | "deleted" | "superseded";

/**
 * Upsert only if the piece still exists and still reads the same as when it was
 * embedded. Otherwise a later mutation has scheduled its own run, so an older
 * workflow finishing late can't overwrite a newer vector or revive a removed piece.
 */
export function upsertDecision(currentText: string | null, embeddedText: string): UpsertOutcome {
  if (currentText === null) return "deleted";
  return currentText === embeddedText ? "upserted" : "superseded";
}

// ----------------------------------------------------------- orchestration
/** The I/O behind each step, bound to one artwork. Each must be idempotent and return JSON. */
export interface IndexOps {
  /** Make the image's missing previews (Cloudflare Images) and record them. Throws to retry. */
  preview(imageId: string): Promise<PreviewOutcome>;
  /** Rewrite the image's original in Infrequent Access, unless it already is. Throws to retry. */
  tierOriginal(imageId: string): Promise<TierOutcome>;
  /** Write ai_description from the vision model; true if one was written. Throws to retry. */
  describe(key: string): Promise<boolean>;
  /** Re-sync FTS and record.json; false if the piece is gone. */
  refreshText(): Promise<boolean>;
  /** The embedding of the current text, or null if the piece is gone. */
  embed(): Promise<Embedded | null>;
  upsert(e: Embedded): Promise<UpsertOutcome>;
}
/** `displayKey`: the image's display preview, if it has one now. `paletteChanged`: the piece's palette was filled in. */
export interface PreviewOutcome { status: "made" | "ready" | "skipped" | "gone"; displayKey: string | null; paletteChanged: boolean }
export type TierOutcome = "moved" | "already" | "gone";
const NO_PREVIEW: PreviewOutcome = { status: "skipped", displayKey: null, paletteChanged: false };

export type DoStep = <T>(name: string, config: WorkflowStepConfig, fn: () => Promise<T>) => Promise<T>;

/** Local dev / fallback: run the step now, once. */
export const inlineStep: DoStep = (_name, _config, fn) => fn();

const retry = (limit: number, delay: `${number} seconds`) => ({ limit, delay, backoff: "exponential" as const });
export const STEPS = {
  preview: { retries: retry(3, "20 seconds"), timeout: "2 minutes" },
  tierOriginal: { retries: retry(3, "30 seconds"), timeout: "5 minutes" },
  describe: { retries: retry(2, "15 seconds"), timeout: "2 minutes" },
  refreshText: { retries: retry(5, "5 seconds"), timeout: "30 seconds" },
  embed: { retries: retry(5, "10 seconds"), timeout: "1 minute" },
  upsert: { retries: retry(5, "10 seconds"), timeout: "30 seconds" },
} satisfies Record<string, WorkflowStepConfig>;

/** The key the vision step may read: a display preview only, never an original. */
export function describeKeyFor(params: IndexParams, preview: PreviewOutcome | null): string | null {
  if (params.describeKey) return describeSource(params.describeKey);
  return params.describePreview && preview ? describeSource(preview.displayKey) : null;
}

export async function runIndexing(params: IndexParams, ops: IndexOps, doStep: DoStep) {
  let preview: PreviewOutcome | null = null;
  if (params.previewImageId) {
    const imageId = params.previewImageId;
    // Without previews the piece shows a "being made" tile; search must not wait on it.
    try { preview = await doStep("preview", STEPS.preview, () => ops.preview(imageId)); }
    catch (e) { console.warn("preview failed", params.artworkId, imageId, e); preview = NO_PREVIEW; }
  }
  // After the preview, which reads the original while it is still Standard (no retrieval fee).
  let tiered: TierOutcome | null = null;
  if (params.tierOriginalImageId) {
    const imageId = params.tierOriginalImageId;
    try { tiered = await doStep("tier-original", STEPS.tierOriginal, () => ops.tierOriginal(imageId)); }
    catch (e) { console.warn("moving the original to Infrequent Access failed", params.artworkId, imageId, e); }
  }
  let described = false;
  const key = describeKeyFor(params, preview);
  if (key) {
    // A missing description must not block search: give up on it and carry on.
    try { described = await doStep("describe", STEPS.describe, () => ops.describe(key)); }
    catch (e) { console.warn("vision description failed", params.artworkId, e); }
  }
  // FTS and record.json include the description and palette, so refresh them once either changes.
  if (described || preview?.paletteChanged) await doStep("refresh-text", STEPS.refreshText, () => ops.refreshText());
  const embedded = await doStep("embed", STEPS.embed, () => ops.embed());
  const outcome: UpsertOutcome = embedded ? await doStep("upsert", STEPS.upsert, () => ops.upsert(embedded)) : "deleted";
  return { artworkId: params.artworkId, preview: preview?.status ?? null, tiered, described, outcome };
}

/** Start the Workflow when bound; otherwise (or if it won't start) index inline so nothing is lost. */
export async function startIndexing(indexer: Pick<Workflow<IndexParams>, "create"> | undefined, params: IndexParams, inline: () => Promise<unknown>) {
  if (indexer) {
    try { await indexer.create({ params }); return "workflow" as const; }
    catch (e) { console.error("indexing workflow did not start; indexing inline", params.artworkId, e); }
  }
  await inline();
  return "inline" as const;
}
