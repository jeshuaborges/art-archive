/**
 * Minimal MCP server (Streamable HTTP transport, JSON responses) so Claude can
 * search and update the archive. It sits behind the same Cloudflare Access
 * policy as the app, so it adds no auth of its own.
 */
import { loadFieldDefs } from "./fields";
import { getArtwork, listSummaries, search, updateArtwork, HttpError, STATUS_LABELS, type Env } from "./store";

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "search_artworks",
    description: "Search Anne Laddon's archive by words or meaning (e.g. 'warm sunsets over water'). Optional filters narrow by medium, status or year range.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for. Leave empty to list everything that matches the filters." },
        medium: { type: "string" }, status: { type: "string", enum: Object.keys(STATUS_LABELS) },
        yearFrom: { type: "integer" }, yearTo: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "get_artwork",
    description: "Get one artwork with all of its fields and images, by id or catalog number (e.g. 2019-001).",
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
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function text(obj: unknown) { return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] }; }

async function callTool(env: Env, name: string, args: Record<string, unknown>, by: string) {
  switch (name) {
    case "search_artworks": {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      let rows = await listSummaries(env);
      let matchById: Map<string, number> | null = null;
      if (typeof args.query === "string" && args.query.trim()) {
        const r = await search(env, args.query, 100);
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
      })));
    }
    case "get_artwork": {
      const a = await getArtwork(env, String(args.id || ""));
      return text({ ...a, images: a.images.map((i) => ({ id: i.id, kind: i.kind, role: i.role, caption: i.caption, url: i.display })) });
    }
    case "list_fields":
      return text(await loadFieldDefs(env.DB));
    case "update_artwork": {
      const { id, ...rest } = args;
      const a = await updateArtwork(env, String(id || ""), rest, by);
      return text({ ok: true, id: a.id, catalogId: a.catalogId, version: a.version });
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
        instructions: "Tools for Anne Laddon's artwork archive. Call list_fields before update_artwork, and pass the version you got from get_artwork." });
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
