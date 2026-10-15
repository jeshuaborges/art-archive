/**
 * Print readiness: what each original can be reprinted at, judged against the
 * painting's own size when the record has one ("24 × 36 in", "61 × 91 cm").
 * Pure decisions, so the piece view, the archive report and MCP all say the same.
 *
 *   master     prints the painting at its own size at 300 ppi or more
 *   print      at its own size at 150 ppi or more (fine for canvas giclée),
 *              or, size unknown, at least 16 in on the long edge at 300 ppi
 *   small      good prints only below its size: at least 7 in long at 300 ppi
 *   reference  less than that: a record of the piece, rescan before printing
 */
import type { Tech } from "./techmeta";

export type PrintGrade = "master" | "print" | "small" | "reference";
export const GRADE_ORDER: PrintGrade[] = ["master", "print", "small", "reference"];
export const GRADE_LABEL: Record<PrintGrade, string> = {
  master: "Archival master", print: "Print quality", small: "Small prints only", reference: "Reference only",
};

export const PPI_MASTER = 300;
export const PPI_PRINT = 150;
const PRINT_LONG_PX = 16 * 300;
const SMALL_LONG_PX = 7 * 300;
const HEAVY_JPEG = 80;

export interface Inches { w: number; h: number }

const NUM = String.raw`(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)`;
const toNumber = (s: string) =>
  s.trim().split(/\s+/).reduce((t, part) => { const [n, d] = part.split("/"); return t + (d ? Number(n) / Number(d) : Number(n)); }, 0);

/** The painting's width × height in inches from the size field; inches when no unit is given. Null if it can't tell. */
export function parsePhysicalSize(text: unknown): Inches | null {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase().replace(/[″”"]/g, " in ").replace(/,/g, ".");
  const m = t.match(new RegExp(`${NUM}\\s*(cm|mm|in|inch|inches)?\\s*[x×✕*by]+\\s*${NUM}\\s*(cm|mm|in|inch|inches)?`));
  if (!m) return null;
  const unit = m[4] || m[2] || (/\bcm\b/.test(t) ? "cm" : /\bmm\b/.test(t) ? "mm" : "in");
  const f = unit === "cm" ? 1 / 2.54 : unit === "mm" ? 1 / 25.4 : 1;
  const w = toNumber(m[1]) * f, h = toNumber(m[3]) * f;
  return w > 0 && h > 0 && w < 1000 && h < 1000 ? { w: round1(w), h: round1(h) } : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface PrintAssessment {
  grade: PrintGrade;
  label: string;
  /** One line for the artist: what it can be printed at. */
  summary: string;
  megapixels: number;
  /** Largest print at 300 ppi, as the image is oriented. */
  maxAt300: Inches;
  /** Pixels per inch at the painting's own size; null without a size. */
  ppiAtSize: number | null;
  sizeKnown: boolean;
  /** Good to know (16-bit, lossless, the profile). */
  notes: string[];
  /** Things that would hold a reprint back. */
  warnings: string[];
}

/**
 * One file against the painting. `width`/`height` are its pixels as shown;
 * `tech` adds what its headers say (absent until they've been read).
 */
export function assessPrint(px: { width: number | null; height: number | null }, tech: Tech | null, size: Inches | null): PrintAssessment | null {
  if (!px.width || !px.height) return null;
  const long = Math.max(px.width, px.height), short = Math.min(px.width, px.height);
  const maxAt300 = { w: round1(px.width / 300), h: round1(px.height / 300) };
  const ppiAtSize = size ? Math.floor(Math.min(long / Math.max(size.w, size.h), short / Math.min(size.w, size.h))) : null;
  const notes: string[] = [], warnings: string[] = [];

  let grade: PrintGrade = ppiAtSize !== null
    ? ppiAtSize >= PPI_MASTER ? "master" : ppiAtSize >= PPI_PRINT ? "print" : long >= SMALL_LONG_PX ? "small" : "reference"
    : long >= PRINT_LONG_PX ? "print" : long >= SMALL_LONG_PX ? "small" : "reference";

  if (size && Math.abs(Math.log((long / short) / (Math.max(size.w, size.h) / Math.min(size.w, size.h)))) > 0.12)
    warnings.push("Its shape doesn't match the painting's size: it may be cropped, framed or a detail");
  if (tech) {
    if (tech.bitsPerChannel && tech.bitsPerChannel >= 16) notes.push(`${tech.bitsPerChannel}-bit colour`);
    if (tech.lossy === false) notes.push(`Lossless (${tech.compression ?? tech.format})`);
    if (tech.iccProfile) notes.push(`Colour profile: ${tech.iccProfile}`);
    else if (tech.colorMode !== "Grayscale") warnings.push("No colour profile embedded: colours may shift in print");
    if (tech.colorMode === "CMYK") notes.push("CMYK (already separated for press)");
    if (tech.jpegQuality !== null && tech.jpegQuality < HEAVY_JPEG) {
      warnings.push(`Saved with heavy JPEG compression (quality ≈${tech.jpegQuality})`);
      if (grade === "master") grade = "print";
    }
  }
  if (!size) warnings.push("Add the painting's size to check full-size prints");

  const inch = (d: Inches) => `${fmt(d.w)} × ${fmt(d.h)} in`;
  const summary =
    grade === "master" ? `Prints at full size (${inch(size!)}) at ${ppiAtSize} ppi`
    : grade === "print" && ppiAtSize !== null ? `Prints at full size (${inch(size!)}) at ${ppiAtSize} ppi`
    : grade === "reference" ? `Up to ${inch(maxAt300)} at 300 ppi: rescan before printing`
    : `Prints up to ${inch(maxAt300)} at 300 ppi`;
  return {
    grade, label: GRADE_LABEL[grade], summary, megapixels: round1((px.width * px.height) / 1e6), maxAt300, ppiAtSize, sizeKnown: !!size, notes, warnings,
  };
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The best of a piece's files, by grade then pixels. Null when none can be judged. */
export function bestOf<T extends { print: PrintAssessment | null }>(files: T[]): T | null {
  let best: T | null = null;
  for (const f of files) {
    if (!f.print) continue;
    if (!best || GRADE_ORDER.indexOf(f.print.grade) < GRADE_ORDER.indexOf(best.print!.grade)
      || (f.print.grade === best.print!.grade && f.print.megapixels > best.print!.megapixels)) best = f;
  }
  return best;
}

// ----------------------------------------------------------- fixity
/** How long a checksum check stays current before the original is read and hashed again. */
export const FIXITY_DAYS = 90;

export type FixityState = "verified" | "failed" | "due" | "unchecked";
export function fixityState(checkedAt: string | null, ok: number | null, now: Date): FixityState {
  if (!checkedAt || ok === null) return "unchecked";
  if (!ok) return "failed";
  return now.getTime() - Date.parse(checkedAt) > FIXITY_DAYS * 864e5 ? "due" : "verified";
}

/** Compare a hash against the one recorded when the file arrived. */
export const fixityMatches = (recorded: string, computed: string) => recorded.toLowerCase() === computed.toLowerCase();
