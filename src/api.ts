import type { Artwork, Config, FieldDef, ImageDTO, Summary } from "./types";
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

export const api = {
  me: () => req<{ email: string }>("/api/me"),
  config: () => req<Config>("/api/config"),
  fields: () => req<FieldDef[]>("/api/fields"),
  list: () => req<Summary[]>("/api/artworks"),
  get: (id: string) => req<Artwork>(`/api/artworks/${encodeURIComponent(id)}`),
  create: (body: Record<string, unknown>) => req<Artwork>("/api/artworks", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) => req<Artwork>(`/api/artworks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: string) => req<void>(`/api/artworks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  search: (q: string, signal?: AbortSignal) => req<{ backend: string; results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),
  similar: (id: string) => req<SimilarResult[]>(`/api/artworks/${encodeURIComponent(id)}/similar?k=8`),
  updateImage: (id: string, body: Record<string, unknown>) => req<Artwork>(`/api/images/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteImage: (id: string) => req<Artwork>(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" }),

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
