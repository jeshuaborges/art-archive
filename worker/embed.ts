/**
 * Semantic search backends.
 *
 * Production: Workers AI text embeddings stored in Vectorize.
 * Local dev:  a small offline embedding model (concept + token hashing) whose
 *             vectors live in the D1 `embeddings` table and are searched by
 *             brute-force cosine. It needs no network, so `wrangler dev` runs
 *             fully offline, and it exercises the same code paths.
 */
export interface EmbedEnv {
  DB: D1Database;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  EMBEDDINGS?: string;
  EMBED_MODEL?: string;
}

export interface VectorBackend {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
  upsert(id: string, vec: number[]): Promise<void>;
  remove(id: string): Promise<void>;
  query(vec: number[], topK: number): Promise<{ id: string; score: number }[]>;
  /** map a raw query-vs-document score to a 0–1 "match" for display */
  calibrate(score: number): number;
  /** map a raw document-vs-document score to a 0–1 similarity for display */
  calibrateSimilar(score: number): number;
}

// ------------------------------------------------------------ color helpers
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 0 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s: d / (1 - Math.abs(2 * l - 1)), l };
}

export function colorName(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (l > 0.9) return "white";
  if (l < 0.12) return "black";
  if (s < 0.15) return "gray";
  if ((h < 45 || h >= 345) && l < 0.35 && s < 0.6) return "brown";
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 65) return "gold";
  if (h < 160) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 295) return "purple";
  return "pink";
}

// ------------------------------------------------------- local embedding model
const CONCEPTS: Record<string, string[]> = {
  sunset: ["sunset", "warm", "evening"], sunsets: ["sunset", "warm", "evening"], evening: ["evening", "sunset"], dusk: ["evening", "sunset"],
  glow: ["sunset", "warm"], sun: ["sun", "sunset"], sunrise: ["sun", "warm"], warm: ["warm"], hot: ["warm"],
  water: ["water"], lake: ["lake", "water"], lakes: ["lake", "water"], river: ["river", "water"], creek: ["river", "water"], stream: ["river", "water"],
  ocean: ["coast", "water"], sea: ["coast", "water"], coast: ["coast", "water"], coastal: ["coast", "water"], bluff: ["coast"], beach: ["coast", "water"],
  flower: ["flowers"], flowers: ["flowers"], floral: ["flowers"], wildflowers: ["flowers", "hills"], wildflower: ["flowers"], bloom: ["flowers"],
  superbloom: ["flowers", "hills"], poppy: ["flowers", "orange"], poppies: ["flowers", "orange"], lupine: ["flowers", "purple"],
  hill: ["hills"], hills: ["hills", "landscape"], hilltop: ["hills", "landscape"], rolling: ["hills"], oak: ["oaks"], oaks: ["oaks", "hills"], trees: ["oaks"], tree: ["oaks"],
  abstract: ["abstract"], bold: ["abstract", "graphic"], shapes: ["abstract", "graphic"], modern: ["abstract"], graphic: ["graphic"],
  poster: ["graphic"], screenprint: ["graphic", "serigraph"], serigraph: ["graphic", "serigraph"], silkscreen: ["graphic", "serigraph"],
  music: ["music", "people"], jazz: ["music", "people", "night"], band: ["music", "people"], trio: ["music", "people"], concert: ["music", "people"], festival: ["music", "people"], fest: ["music", "people"],
  people: ["people"], crowd: ["people"], crowds: ["people"], figures: ["people"], figure: ["people"],
  baseball: ["sports", "night"], ballpark: ["sports"], stadium: ["sports"], game: ["sports"], padres: ["sports"], park: ["park"],
  night: ["night"], dark: ["night"], lights: ["night"],
  farm: ["rural", "barn"], rural: ["rural"], barn: ["barn", "rural"], grain: ["rural", "barn"], feed: ["rural"], silo: ["barn"],
  canyon: ["canyon", "rocks"], desert: ["canyon"], rock: ["rocks"], rocks: ["rocks", "canyon"], towering: ["rocks"], cliffs: ["rocks"],
  purple: ["purple"], lavender: ["purple"], violet: ["purple"], prismatic: ["purple", "warm"],
  gold: ["gold"], golden: ["gold"], yellow: ["gold"], orange: ["orange", "warm"], green: ["green"], blue: ["blue"], teal: ["teal", "blue"],
  red: ["red", "warm"], pink: ["pink"], rose: ["pink"], brown: ["brown"],
  landscape: ["landscape"], landscapes: ["landscape"], scenery: ["landscape"], view: ["landscape"], plains: ["landscape", "plains"],
  oil: ["oil"], pastel: ["pastel"], print: ["print"], watercolor: ["watercolor"],
};
const STOP = new Set(["a", "an", "the", "of", "and", "or", "with", "at", "on", "in", "by", "for", "to", "from", "over", "under", "near", "some", "my", "her", "his", "that", "this", "is", "are", "vs"]);
export const LOCAL_DIM = 384;

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

export function localEmbed(text: string): number[] {
  const v = new Array(LOCAL_DIM).fill(0);
  const add = (feat: string, w: number) => { const h = fnv(feat); v[h % LOCAL_DIM] += (h & 0x80000000 ? -1 : 1) * w; };
  for (const t of tokenize(text)) {
    const cs = CONCEPTS[t] || (t.endsWith("s") ? CONCEPTS[t.slice(0, -1)] : undefined);
    if (cs) for (const c of cs) add("c:" + c, 1);
    else add("t:" + t, 0.6);
  }
  const n = Math.hypot(...v);
  return n ? v.map((x) => x / n) : v;
}

export function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

class LocalBackend implements VectorBackend {
  name = "local-hash-384";
  constructor(private db: D1Database) {}
  async embed(texts: string[]) { return texts.map(localEmbed); }
  async upsert(id: string, vec: number[]) {
    await this.db.prepare("INSERT INTO embeddings (artwork_id, model, vec, updated_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artwork_id) DO UPDATE SET model = ?2, vec = ?3, updated_at = excluded.updated_at")
      .bind(id, this.name, JSON.stringify(vec.map((x) => Math.round(x * 1e5) / 1e5))).run();
  }
  async remove(id: string) { await this.db.prepare("DELETE FROM embeddings WHERE artwork_id = ?").bind(id).run(); }
  async query(vec: number[], topK: number) {
    const { results } = await this.db.prepare("SELECT e.artwork_id AS id, e.vec FROM embeddings e JOIN artworks a ON a.id = e.artwork_id WHERE a.deleted_at IS NULL").all<{ id: string; vec: string }>();
    return results.map((r) => ({ id: r.id, score: cosine(vec, JSON.parse(r.vec)) }))
      .sort((x, y) => y.score - x.score).slice(0, topK);
  }
  calibrate(s: number) { return Math.max(0, Math.min(1, s * 1.45)); }
  calibrateSimilar(s: number) { return Math.max(0, Math.min(0.99, s * 1.05)); }
}

class WorkersAIBackend implements VectorBackend {
  name: string;
  constructor(private ai: Ai, private index: VectorizeIndex, model: string) { this.name = model; }
  async embed(texts: string[]) {
    const out = (await this.ai.run(this.name as never, { text: texts } as never)) as unknown as { data: number[][] };
    return out.data;
  }
  async upsert(id: string, vec: number[]) { await this.index.upsert([{ id, values: vec }]); }
  async remove(id: string) { await this.index.deleteByIds([id]); }
  async query(vec: number[], topK: number) {
    const r = await this.index.query(vec, { topK });
    return r.matches.map((m) => ({ id: m.id, score: m.score }));
  }
  calibrate(s: number) { return Math.max(0, Math.min(1, (s - 0.45) / 0.4)); }
  calibrateSimilar(s: number) { return Math.max(0, Math.min(0.99, (s - 0.5) / 0.45)); }
}

export function vectorBackend(env: EmbedEnv): VectorBackend {
  if (env.EMBEDDINGS === "workers-ai" && env.AI && env.VECTORIZE) {
    return new WorkersAIBackend(env.AI, env.VECTORIZE, env.EMBED_MODEL || "@cf/baai/bge-base-en-v1.5");
  }
  return new LocalBackend(env.DB);
}
