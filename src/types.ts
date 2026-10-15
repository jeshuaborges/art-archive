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
  thumb: string | null;
  display: string | null;
  aspect: number | null;
  imageCount: number;
}

export type ImageKind = "work" | "progress" | "study" | "reference";

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
  original: string;
  display: string;
  thumb: string;
}

export interface Artwork extends Omit<Summary, "thumb" | "display" | "aspect" | "imageCount"> {
  aiDescription: string | null;
  coverImageId: string | null;
  createdAt: string;
  images: ImageDTO[];
  cover: ImageDTO | null;
}

export interface Config {
  statuses: { value: string; label: string }[];
  imageKinds: ImageKind[];
  search: string;
}

export interface Filters {
  values: Record<string, string[]>; // filterable field key -> selected choices
  status: string[];
  color: string | null;
  years: [number, number] | null;
}

export const emptyFilters = (): Filters => ({ values: {}, status: [], color: null, years: null });
