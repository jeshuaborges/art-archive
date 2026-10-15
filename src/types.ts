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
}

export interface Artwork extends Omit<Summary, "thumb" | "display" | "preview" | "aspect" | "imageCount"> {
  aiDescription: string | null;
  coverImageId: string | null;
  createdAt: string;
  archivedBy: string | null;
  images: ImageDTO[];          // archived images left out unless asked for
  cover: ImageDTO | null;
  archivedImageCount: number;
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
