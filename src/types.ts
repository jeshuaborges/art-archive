export type Attrs = Record<string, unknown>;

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "long_text" | "number" | "boolean" | "select" | "multi_select" | "url" | "fuzzy_date";
  options: { choices?: string[]; allowNew?: boolean; maxLength?: number; min?: number; max?: number; unit?: string; integer?: boolean };
  required: boolean;
  sortOrder: number;
  helpText: string | null;
  archived: boolean;
  filterable: boolean;
}

export interface Summary {
  id: string;
  catalogId: string;
  title: string;
  yearStart: number | null;
  yearEnd: number | null;
  circa: boolean;
  status: string;
  attrs: Attrs;
  palette: string[];
  version: number;
  updatedAt: string;
  archivedAt: string | null; // archived: out of sight, not deleted
  thumb: string | null;
  display: string | null;
  preview: PreviewState | null; // of the cover; null when there is no image
  aspect: number | null;
  imageCount: number;
}

export type ImageKind = "work" | "progress" | "study" | "reference";

/** ready: display/thumb are set. pending: the server is still making them. unavailable: it can't (download the original). */
export type PreviewState = "ready" | "pending" | "unavailable";

export interface ImageDTO {
  id: string;
  artworkId: string;
  kind: ImageKind;
  role: string;
  caption: string | null;
  takenOn: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  contentType: string;
  sha256: string;
  palette: string[];
  sortOrder: number;
  createdAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
  original: string;              // names the file; only `download` fetches it
  download: string;
  display: string | null;        // previews only: never the original
  thumb: string | null;
  preview: PreviewState;
  originalName: string | null;   // the name the file arrived with
  tech: Tech | null;             // read from the original's headers (null until read)
  print: PrintAssessment | null; // what it can be reprinted at
  fixity: { state: FixityState; checkedAt: string | null };
}

/** What an original file is, from its headers (worker/techmeta.ts). */
export interface Tech {
  format: string;
  width: number | null;
  height: number | null;
  bitsPerChannel: number | null;
  colorMode: string | null;
  hasAlpha: boolean;
  iccProfile: string | null;
  dpi: number | null;
  compression: string | null;
  lossy: boolean | null;
  jpegQuality: number | null;
  camera: string | null;
  software: string | null;
  capturedAt: string | null;
  orientation: number | null;
}

export type PrintGrade = "master" | "print" | "small" | "reference";
/** worker/printready.ts */
export interface PrintAssessment {
  grade: PrintGrade;
  label: string;
  summary: string;
  megapixels: number;
  maxAt300: { w: number; h: number };
  ppiAtSize: number | null;
  sizeKnown: boolean;
  notes: string[];
  warnings: string[];
}
/** verified: re-read and matched within 90 days. due: matched, but longer ago. */
export type FixityState = "verified" | "failed" | "due" | "unchecked";

export interface AssetReport {
  generatedAt: string;
  pieces: number;
  grades: Record<PrintGrade | "none", number>;
  files: number;
  bytes: number;
  formats: { type: string; count: number }[];
  headersRead: number;
  missingSize: number;
  fixity: { verified: number; due: number; unchecked: number; failed: number; oldestCheck: string | null; failures: { imageId: string; artworkId: string; key: string }[] };
  needsAttention: { id: string; catalogId: string; title: string; year: number | null; sizeKnown: boolean; grade: PrintGrade | null; summary: string; thumb: string | null; files: number }[];
}

export interface Artwork extends Omit<Summary, "thumb" | "display" | "preview" | "aspect" | "imageCount"> {
  aiDescription: string | null;
  coverImageId: string | null;
  createdAt: string;
  archivedBy: string | null;
  images: ImageDTO[];          // archived images left out unless asked for
  cover: ImageDTO | null;
  archivedImageCount: number;
  /** The best file of the finished work, judged for reprints. */
  print: (PrintAssessment & { imageId: string }) | null;
}

export interface Config {
  statuses: { value: string; label: string }[];
  imageKinds: ImageKind[];
  search: string;
}

/** Which archived records a read shows: none (default), both, or only them. */
export type ArchivedMode = "exclude" | "include" | "only";

export interface Filters {
  values: Record<string, string[]>; // filterable field key -> selected choices
  status: string[];
  color: string | null;
  years: [number, number] | null;
  archived: ArchivedMode;
}

export const emptyFilters = (): Filters => ({ values: {}, status: [], color: null, years: null, archived: "exclude" });

/** The removable chip for a non-default archived choice. */
export const archivedChipLabel = (m: ArchivedMode) => (m === "only" ? "Only archived" : m === "include" ? "Including archived" : null);

/**
 * The small count beside the filter chips, only where it says something the
 * screen doesn't: how many pieces a search or the filters left, or how many are
 * archived. The plain whole archive gets no count (null).
 */
export function countLabel(o: { total: number | null; shown: number; searching: boolean; archived: ArchivedMode; filtered: boolean }): string | null {
  const { total, shown } = o;
  if (total == null) return null;
  if (o.searching) return `${shown} CLOSE ${shown === 1 ? "MATCH" : "MATCHES"}`;
  if (o.archived === "only") return o.filtered ? `${shown} OF ${total} ARCHIVED` : `${total} ARCHIVED`;
  if (o.filtered && shown !== total) return `${shown} OF ${total}`;
  return null;
}
