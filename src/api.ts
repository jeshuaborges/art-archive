import type { ArchivedMode, Artwork, Config, FieldDef, ImageDTO, Summary } from "./types";
import type { Prepared } from "./imageprep";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) } });
  } catch {
    throw new ApiError(0, "Can't reach the archive. Check the connection and try again.");
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new ApiError(r.status, body.error || r.statusText, body.details);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export interface SearchResult { id: string; match: number; via: string[] }
export interface SimilarResult { id: string; match: number }
export interface BulkResult { changed: string[]; unchanged: string[]; notFound: string[] }

/** "?archived=…" (or "&…"), left off for the default. */
const archivedQs = (m: ArchivedMode | undefined, sep = "?") => (m && m !== "exclude" ? `${sep}archived=${m}` : "");
const bulk = (path: string, ids: string[]) => req<BulkResult>(path, { method: "POST", body: JSON.stringify({ ids }) });

export const api = {
  me: () => req<{ email: string }>("/api/me"),
  config: () => req<Config>("/api/config"),
  fields: () => req<FieldDef[]>("/api/fields"),
  list: (archived?: ArchivedMode) => req<Summary[]>(`/api/artworks${archivedQs(archived)}`),
  /** `images` chooses which of its images come back (archived ones are left out by default). */
  get: (id: string, images?: ArchivedMode) => req<Artwork>(`/api/artworks/${encodeURIComponent(id)}${archivedQs(images)}`),
  create: (body: Record<string, unknown>) => req<Artwork>("/api/artworks", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) => req<Artwork>(`/api/artworks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: string) => req<void>(`/api/artworks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  archive: (id: string) => req<Artwork>(`/api/artworks/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  unarchive: (id: string) => req<Artwork>(`/api/artworks/${encodeURIComponent(id)}/unarchive`, { method: "POST" }),
  archiveMany: (ids: string[]) => bulk("/api/artworks/archive", ids),
  unarchiveMany: (ids: string[]) => bulk("/api/artworks/unarchive", ids),
  search: (q: string, signal?: AbortSignal, archived?: ArchivedMode) =>
    req<{ backend: string; results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}${archivedQs(archived, "&")}`, { signal }),
  similar: (id: string) => req<SimilarResult[]>(`/api/artworks/${encodeURIComponent(id)}/similar?k=8`),
  updateImage: (id: string, body: Record<string, unknown>) => req<Artwork>(`/api/images/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteImage: (id: string) => req<Artwork>(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" }),
  archiveImage: (id: string) => req<Artwork>(`/api/images/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  unarchiveImage: (id: string) => req<Artwork>(`/api/images/${encodeURIComponent(id)}/unarchive`, { method: "POST" }),

  /** Upload with progress. Sends the untouched original plus phone-made display/thumb variants. */
  uploadImage(artworkId: string, p: Prepared, meta: Record<string, unknown>, onProgress: (f: number) => void): Promise<{ image: ImageDTO; duplicate: boolean }> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("original", p.original, p.original.name || "photo.jpg");
      if (p.display) fd.append("display", p.display, "display.jpg");
      if (p.thumb) fd.append("thumb", p.thumb, "thumb.jpg");
      fd.append("meta", JSON.stringify({ ...meta, width: p.width, height: p.height, palette: p.palette }));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/artworks/${encodeURIComponent(artworkId)}/images`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body: { error?: string; details?: unknown } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as never);
        else reject(new ApiError(xhr.status, body.error || "Upload failed", body.details));
      };
      xhr.onerror = () => reject(new ApiError(0, "Upload interrupted. Check the connection and try again."));
      xhr.send(fd);
    });
  },
};
