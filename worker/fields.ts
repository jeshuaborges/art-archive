/**
 * Flexible field definitions for artworks.attrs.
 * field_defs rows -> typed FieldDefs; writes go through applyAttrsPatch.
 */
import { z } from "zod";

export const FIELD_TYPES = ["text", "long_text", "number", "boolean", "select", "multi_select", "url", "fuzzy_date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;

const textOptions = z.object({ maxLength: z.number().int().positive().optional() }).strict();
const numberOptions = z.object({
  min: z.number().optional(), max: z.number().optional(),
  integer: z.boolean().optional(), unit: z.string().optional(),
}).strict();
const selectOptions = z.object({
  choices: z.array(z.string().trim().min(1)).default([]),
  allowNew: z.boolean().default(true),
}).strict();
const noOptions = z.object({}).strict();

export const OPTION_SCHEMAS = {
  text: textOptions, long_text: textOptions, number: numberOptions, boolean: noOptions,
  select: selectOptions, multi_select: selectOptions, url: noOptions, fuzzy_date: noOptions,
} satisfies Record<FieldType, z.ZodTypeAny>;

interface FieldBase {
  key: string; label: string; required: boolean; sortOrder: number;
  helpText: string | null; archived: boolean; filterable: boolean;
}
export type FieldDef =
  | (FieldBase & { type: "text" | "long_text"; options: z.infer<typeof textOptions> })
  | (FieldBase & { type: "number"; options: z.infer<typeof numberOptions> })
  | (FieldBase & { type: "select" | "multi_select"; options: z.infer<typeof selectOptions> })
  | (FieldBase & { type: "boolean" | "url" | "fuzzy_date"; options: Record<string, never> });

export interface FieldDefRow {
  key: string; label: string; type: string; options: string; required: number;
  sort_order: number; help_text: string | null; archived_at: string | null; filterable: number;
}

export function parseFieldDef(row: FieldDefRow): FieldDef {
  if (!FIELD_KEY_RE.test(row.key)) throw new Error(`Invalid field key: ${row.key}`);
  if (!(FIELD_TYPES as readonly string[]).includes(row.type)) throw new Error(`Unknown field type "${row.type}"`);
  const type = row.type as FieldType;
  const options = OPTION_SCHEMAS[type].parse(JSON.parse(row.options || "{}"));
  return {
    key: row.key, label: row.label, type, options,
    required: row.required === 1, sortOrder: row.sort_order, helpText: row.help_text,
    archived: row.archived_at !== null, filterable: row.filterable === 1,
  } as FieldDef;
}

export async function loadFieldDefs(db: D1Database): Promise<FieldDef[]> {
  const { results } = await db.prepare("SELECT * FROM field_defs ORDER BY sort_order, key").all<FieldDefRow>();
  return results.map(parseFieldDef);
}

export const fuzzyDateSchema = z.object({
  year: z.number().int().min(1800).max(2100),
  yearEnd: z.number().int().min(1800).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  circa: z.boolean().optional(),
}).strict()
  .refine((v) => v.yearEnd === undefined || v.yearEnd >= v.year, "End year must be on or after start year")
  .refine((v) => v.day === undefined || v.month !== undefined, "A day needs a month");
export type FuzzyDate = z.infer<typeof fuzzyDateSchema>;

type NewChoices = Map<string, Set<string>>;

function selectValue(def: Extract<FieldDef, { type: "select" | "multi_select" }>, newChoices: NewChoices) {
  const byLower = new Map(def.options.choices.map((c) => [c.toLowerCase(), c]));
  return z.string().trim().min(1).max(200)
    .superRefine((v, ctx) => {
      if (!def.options.allowNew && !byLower.has(v.toLowerCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${v}" is not one of the choices for ${def.label}` });
      }
    })
    .transform((v) => {
      const existing = byLower.get(v.toLowerCase());
      if (existing) return existing;
      if (!newChoices.has(def.key)) newChoices.set(def.key, new Set());
      newChoices.get(def.key)!.add(v);
      return v;
    });
}

function valueSchema(def: FieldDef, newChoices: NewChoices): z.ZodTypeAny {
  switch (def.type) {
    case "text":
    case "long_text": {
      let s = z.string().trim().min(1);
      if (def.options.maxLength) s = s.max(def.options.maxLength);
      return s;
    }
    case "number": {
      const { min, max, integer } = def.options;
      return z.number().refine(Number.isFinite, "Must be a finite number").superRefine((v, ctx) => {
        if (integer && !Number.isInteger(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a whole number" });
        if (min !== undefined && v < min) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be at least ${min}` });
        if (max !== undefined && v > max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be at most ${max}` });
      });
    }
    case "boolean": return z.boolean();
    case "url": return z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) link");
    case "fuzzy_date": return fuzzyDateSchema;
    case "select": return selectValue(def, newChoices);
    case "multi_select": return z.array(selectValue(def, newChoices)).min(1).max(50).transform((vs) => [...new Set(vs)]);
  }
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

export type Attrs = Record<string, unknown>;
export interface FieldIssue { key: string; message: string }
export type PatchResult =
  | { ok: true; attrs: Attrs; newChoices: Record<string, string[]> }
  | { ok: false; issues: FieldIssue[] };

export function applyAttrsPatch(defs: FieldDef[], existing: Attrs, patch: Attrs, mode: "create" | "update"): PatchResult {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const next: Attrs = { ...existing };
  const issues: FieldIssue[] = [];
  const newChoices: NewChoices = new Map();
  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) { issues.push({ key, message: "Unknown field" }); continue; }
    if (isEmpty(raw)) {
      if (def.required && !def.archived) issues.push({ key, message: `${def.label} is required` });
      else delete next[key];
      continue;
    }
    if (def.archived) { issues.push({ key, message: `${def.label} is archived; restore it to edit` }); continue; }
    const parsed = valueSchema(def, newChoices).safeParse(raw);
    if (!parsed.success) { for (const issue of parsed.error.issues) issues.push({ key, message: issue.message }); continue; }
    next[key] = parsed.data;
  }
  if (mode === "create") {
    for (const def of defs) {
      if (def.required && !def.archived && next[def.key] === undefined && !issues.some((i) => i.key === def.key)) {
        issues.push({ key: def.key, message: `${def.label} is required` });
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, attrs: next, newChoices: Object.fromEntries([...newChoices].map(([k, s]) => [k, [...s]])) };
}

export const fieldDefInputSchema = z.object({
  key: z.string().regex(FIELD_KEY_RE, "Use lowercase letters, numbers and underscores, starting with a letter"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.record(z.string(), z.unknown()).default({}),
  required: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  filterable: z.boolean().default(false),
  helpText: z.string().trim().max(300).nullable().default(null),
}).superRefine((v, ctx) => {
  const r = OPTION_SCHEMAS[v.type].safeParse(v.options);
  if (!r.success) for (const i of r.error.issues) ctx.addIssue({ ...i, path: ["options", ...i.path] });
});

export function formatFuzzyDate(d: FuzzyDate): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let s = d.yearEnd && d.yearEnd !== d.year ? `${d.year}–${d.yearEnd}` : `${d.year}`;
  if (d.month) s = `${d.day ? `${d.day} ` : ""}${months[d.month - 1]} ${s}`;
  return d.circa ? `c. ${s}` : s;
}

export function formatValue(def: FieldDef, value: unknown): string {
  switch (def.type) {
    case "boolean": return value ? "Yes" : "No";
    case "multi_select": return (value as string[]).join(", ");
    case "number": return def.options.unit ? `${value} ${def.options.unit}` : String(value);
    case "fuzzy_date": return formatFuzzyDate(value as FuzzyDate);
    default: return String(value);
  }
}

export function searchText(defs: FieldDef[], attrs: Attrs): string {
  return defs
    .filter((d) => attrs[d.key] !== undefined && d.type !== "url" && d.type !== "boolean")
    .map((d) => `${d.label}: ${formatValue(d, attrs[d.key])}`)
    .join("\n");
}

/**
 * Anne's inventory number ("OP 1154") compared loosely: case, spaces, dots,
 * hyphens and slashes don't matter, so "op1154" and "OP-1154" find it too.
 * `INVENTORY_KEY_SQL` is the same normalisation in SQLite, for exact lookups.
 */
export const inventoryKey = (s: string) => s.toLowerCase().replace(/[ .\-/]/g, "");
export const INVENTORY_KEY_SQL = "lower(replace(replace(replace(replace(json_extract(attrs, '$.inventory'), ' ', ''), '.', ''), '-', ''), '/', ''))";
/** Worth an exact inventory lookup: at least two characters, one of them a digit. */
export const looksLikeInventory = (key: string) => key.length >= 2 && /[0-9]/.test(key);
