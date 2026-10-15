import type { ArchivedMode, Artwork, AssetReport, Config, FieldDef, ImageDTO, Summary } from "./types";
import type { Prepared } from "./imageprep";
import { AJAX_HEADERS, classify, SIGNED_OUT_MESSAGE, UNREACHABLE_MESSAGE, type Outcome } from "./session";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public outcome: Outcome = "error") { super(message); }
}

// Anyone who wants to know the Access session has expired (App shows a sign-in prompt).
const signedOutListeners = new Set<() => void>();
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => { signedOutListeners.delete(listener); };
}
function signedOut(): ApiError {
  signedOutListeners.forEach((l) => l());
  return new ApiError(401, SIGNED_OUT_MESSAGE, undefined, "signed-out");
}
const unreachable = (message = UNREACHABLE_MESSAGE) =>
  new ApiError(0, message, undefined, classify({ kind: "network", online: navigator.onLine }));

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    // redirect "manual": the API never redirects, so a redirect is Access's login page (see session.ts)
    r = await fetch(path, { ...init, redirect: "manual", headers: { ...AJAX_HEADERS, ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw unreachable();
  }
  if (classify({ kind: "response", status: r.status, type: r.type }) === "signed-out") throw signedOut();
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
  assetReport: () => req<AssetReport>("/api/assets/report"),
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
      for (const [k, v] of Object.entries(AJAX_HEADERS)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body: { error?: string; details?: unknown } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        const outcome = classify({ kind: "response", status: xhr.status });
        if (outcome === "ok") resolve(body as never);
        else if (outcome === "signed-out") reject(signedOut());
        else reject(new ApiError(xhr.status, body.error || "Upload failed", body.details));
      };
      xhr.onerror = () => reject(unreachable("Upload interrupted. Check the connection and try again."));
      xhr.send(fd);
    });
  },
};
