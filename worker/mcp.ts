/**
 * Minimal MCP server (Streamable HTTP transport, JSON responses) so Claude can
 * search, read and update the archive, add pieces and images, and archive them.
 * It sits behind the same Cloudflare Access policy as the app, so it adds no
 * auth of its own. Argument parsing for the writing tools is in tools.ts.
 */
import { loadFieldDefs } from "./fields";
import {
  addImage, assetReport, createArtwork, getArtwork, listSummaries, search, setArtworksArchived, setImageArchived, updateArtwork, HttpError, IMAGE_KINDS, MAX_ORIGINAL,
  STATUS_LABELS, type ArtworkDTO, type Env,
} from "./store";
import {
  checkFetchUrl, filenameFromUrl, imageForm, parseAddImageArgs, parseArchiveArtworksArgs, parseArchiveImageArgs, type ImageFile, type Parsed,
} from "./tools";

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "search_artworks",
    description: "Search Anne Laddon's archive by words or meaning (e.g. 'warm sunsets over water'). Optional filters narrow by medium, status or year range. Archived pieces (put out of sight, e.g. sample data) are left out unless includeArchived is true.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for. Leave empty to list everything that matches the filters." },
        medium: { type: "string" }, status: { type: "string", enum: Object.keys(STATUS_LABELS) },
        yearFrom: { type: "integer" }, yearTo: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 100 },
        includeArchived: { type: "boolean", description: "Also return archived pieces (marked archived: true)." },
      },
    },
  },
  {
    name: "get_artwork",
    description: "Get one artwork with all of its fields and images, by id or catalog number (e.g. 2019-001). Shows whether the piece or any image is archived (archivedAt).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_fields",
    description: "List the archive's field definitions (names, types and allowed choices) before writing changes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_artwork",
    description: "Update an artwork. Pass the version from get_artwork; fields go in `attrs` using keys from list_fields. Empty values clear a field.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }, version: { type: "integer" },
        title: { type: "string" }, yearStart: { type: ["integer", "null"] }, yearEnd: { type: ["integer", "null"] }, circa: { type: "boolean" },
        status: { type: "string", enum: Object.keys(STATUS_LABELS) }, attrs: { type: "object" },
      },
      required: ["id", "version"],
    },
  },
  {
    name: "create_artwork",
    description: "Create an artwork. Its catalog number comes from yearStart and is fixed. Fields go in `attrs` using keys from list_fields.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" }, yearStart: { type: ["integer", "null"] }, yearEnd: { type: ["integer", "null"] }, circa: { type: "boolean" },
        status: { type: "string", enum: Object.keys(STATUS_LABELS) }, attrs: { type: "object" },
      },
    },
  },
  {
    name: "add_image",
    description: "Attach an image to an artwork, as base64 (with filename and contentType) or an http(s) url the server fetches (up to 80 MB). Previews are made on the server; the result's `preview` is \"pending\" until they exist.",
    inputSchema: {
      type: "object",
      properties: {
        artworkId: { type: "string", description: "Artwork id or catalog number." },
        kind: { type: "string", enum: [...IMAGE_KINDS] },
        caption: { type: "string" }, makeCover: { type: "boolean", description: "Make it the main image." },
        base64: { type: "string", description: "The file's bytes, base64 (a data: URL works too). Pass this or url." },
        filename: { type: "string" }, contentType: { type: "string" },
        url: { type: "string", description: "A public http(s) URL to fetch the file from. Pass this or base64." },
      },
      required: ["artworkId", "kind"],
    },
  },
  {
    name: "archive_artworks",
    description: "Archive pieces (out of sight, not deleted), or bring them back with archived: false. Answers which changed, were already so, or weren't found.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500, description: "Artwork ids or catalog numbers." },
        archived: { type: "boolean", default: true },
      },
      required: ["ids"],
    },
  },
  {
    name: "print_readiness",
    description: "How ready the archive is for reprints: pieces by print grade (master: full size at 300 ppi; print: full size at 150 ppi or 16 in at 300; small; reference), how the originals are kept (file count, bytes, formats, SHA-256 fixity checks), and the pieces most worth rescanning, weakest first.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "How many pieces to list as worth rescanning" } } },
  },
  {
    name: "archive_image",
    description: "Archive one image (if it was the main image, the next one takes over), or bring it back with archived: false.",
    inputSchema: {
      type: "object",
      properties: { imageId: { type: "string" }, archived: { type: "boolean", default: true } },
      required: ["imageId"],
    },
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function text(obj: unknown) { return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] }; }

/** A parsed tool argument, or the error the client sees (400 becomes "invalid params"). */
function must<T>(p: Parsed<T>): T {
  if (!p.ok) throw new HttpError(p.status, p.message);
  return p.value;
}

const artworkView = (a: ArtworkDTO) => ({
  ...a, images: a.images.map((i) => ({
    id: i.id, kind: i.kind, role: i.role, caption: i.caption, url: i.display, preview: i.preview, archivedAt: i.archivedAt,
    originalName: i.originalName, contentType: i.contentType, width: i.width, height: i.height, bytes: i.bytes, sha256: i.sha256,
    tech: i.tech, print: i.print, fixity: i.fixity, download: i.download,
  })),
});

const MAX_REDIRECTS = 5;

/** Fetch an image by URL: every hop checked, at most MAX_ORIGINAL bytes read. */
async function fetchImage(start: URL): Promise<ImageFile> {
  let url = start;
  for (let hop = 0; ; hop++) {
    const res = await fetch(url.toString(), { redirect: "manual", headers: { accept: "image/*" } });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (loc) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new HttpError(422, "Too many redirects fetching the image");
      const next = checkFetchUrl(new URL(loc, url).toString());
      if (typeof next === "string") throw new HttpError(422, `Redirected to a URL that can't be fetched: ${next}`);
      url = next;
      continue;
    }
    if (!res.ok || !res.body) throw new HttpError(422, `Fetching the image failed (HTTP ${res.status})`);
    if (Number(res.headers.get("content-length") || 0) > MAX_ORIGINAL) { await res.body.cancel(); throw new HttpError(413, "Image is larger than 80 MB"); }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      size += r.value.byteLength;
      if (size > MAX_ORIGINAL) { await reader.cancel(); throw new HttpError(413, "Image is larger than 80 MB"); }
      chunks.push(r.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    return { bytes, filename: filenameFromUrl(url), contentType: res.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream" };
  }
}

async function callTool(env: Env, name: string, args: Record<string, unknown>, by: string) {
  switch (name) {
    case "search_artworks": {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      const archived = args.includeArchived === true ? "include" : "exclude";
      let rows = await listSummaries(env, archived);
      let matchById: Map<string, number> | null = null;
      if (typeof args.query === "string" && args.query.trim()) {
        const r = await search(env, args.query, 100, archived);
        matchById = new Map(r.results.map((x) => [x.id, x.match]));
        rows = rows.filter((x) => matchById!.has(x.id));
      }
      if (typeof args.medium === "string") rows = rows.filter((x) => String(x.attrs.medium || "").toLowerCase() === (args.medium as string).toLowerCase());
      if (typeof args.status === "string") rows = rows.filter((x) => x.status === args.status);
      if (typeof args.yearFrom === "number") rows = rows.filter((x) => (x.yearStart ?? 0) >= (args.yearFrom as number));
      if (typeof args.yearTo === "number") rows = rows.filter((x) => (x.yearStart ?? 9999) <= (args.yearTo as number));
      if (matchById) rows.sort((a, b) => (matchById!.get(b.id)! - matchById!.get(a.id)!));
      return text(rows.slice(0, limit).map((x) => ({
        id: x.id, catalogId: x.catalogId, title: x.title, year: x.yearStart, status: STATUS_LABELS[x.status],
        medium: x.attrs.medium, subjects: x.attrs.subjects, images: x.imageCount, match: matchById?.get(x.id),
        ...(x.archivedAt ? { archived: true } : {}),
      })));
    }
    case "get_artwork":
      return text(artworkView(await getArtwork(env, String(args.id || ""), "include")));
    case "list_fields":
      return text(await loadFieldDefs(env.DB));
    case "update_artwork": {
      const { id, ...rest } = args;
      const a = await updateArtwork(env, String(id || ""), rest, by);
      return text({ ok: true, id: a.id, catalogId: a.catalogId, version: a.version });
    }
    case "create_artwork":
      return text(artworkView(await createArtwork(env, args, by)));
    case "add_image": {
      const { artworkId, meta, source } = must(parseAddImageArgs(args));
      const file = source.from === "bytes" ? source.file : await fetchImage(source.url);
      const { image, duplicate } = await addImage(env, artworkId, imageForm(file, meta), by);
      return text({
        duplicate,
        image: {
          id: image.id, artworkId: image.artworkId, kind: image.kind, caption: image.caption, contentType: image.contentType, bytes: image.bytes,
          preview: image.preview, display: image.display, thumb: image.thumb, download: image.download, archivedAt: image.archivedAt,
        },
      });
    }
    case "archive_artworks": {
      const { ids, archived } = must(parseArchiveArtworksArgs(args));
      return text(await setArtworksArchived(env, { ids }, archived, by));
    }
    case "print_readiness": {
      const r = await assetReport(env);
      const limit = Math.min(500, Math.max(1, Number(args.limit) || 50));
      return text({ ...r, needsAttention: r.needsAttention.slice(0, limit).map(({ thumb, ...p }) => p), needsAttentionTotal: r.needsAttention.length });
    }
    case "archive_image": {
      const { imageId, archived } = must(parseArchiveImageArgs(args));
      const a = await setImageArchived(env, imageId, archived, by);
      return text({ ok: true, imageId, archived, artworkId: a.id, catalogId: a.catalogId, coverImageId: a.coverImageId });
    }
    default:
      throw new HttpError(400, `Unknown tool: ${name}`);
  }
}

export async function handleMcp(req: Request, env: Env, by: string): Promise<Response> {
  if (req.method === "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204 });
  let msg: Rpc;
  try { msg = await req.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  if (Array.isArray(msg)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batching is not supported" } }, { status: 400 });
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return Response.json({ jsonrpc: "2.0", id: (msg as Rpc)?.id ?? null, error: { code: -32600, message: "Invalid Request" } }, { status: 400 });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notification
  const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string, data?: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, error: { code, message, data } });
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "anne-laddon-archive", version: "1.0.0" },
        instructions: "Tools for Anne Laddon's artwork archive. Call list_fields before create_artwork or update_artwork, and pass the version you got from get_artwork. Archiving hides without deleting and can be undone." });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name || "");
      const args = (msg.params?.arguments as Record<string, unknown>) || {};
      try {
        return reply(await callTool(env, name, args, by));
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 400) return fail(-32602, e.message);
          return reply({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: e.message, details: e.details }) }] });
        }
        throw e;
      }
    }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}
