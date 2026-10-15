/**
 * API integration tests against real `wrangler dev` instances (local D1 + R2).
 * Run with: npm run test:api   (tests/run-api.sh starts fresh servers)
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

const BASE = process.env.API_BASE || "http://localhost:8788";
const NOAUTH = process.env.NOAUTH_BASE || "http://localhost:8789";
const ACCESS = process.env.ACCESS_BASE || "http://localhost:8790";

async function j(path, init = {}, base = BASE) {
  const r = await fetch(base + path, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...init.headers } });
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}
async function jpeg(color, w = 800, h = 600) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
}
async function upload(id, buf, meta = {}, { name = "photo.jpg", type = "image/jpeg", variants = true } = {}) {
  const fd = new FormData();
  fd.append("original", new File([buf], name, { type }));
  if (variants) {
    fd.append("display", new File([await sharp(buf).resize(400).jpeg().toBuffer()], "d.jpg", { type: "image/jpeg" }));
    fd.append("thumb", new File([await sharp(buf).resize(120).jpeg().toBuffer()], "t.jpg", { type: "image/jpeg" }));
  }
  fd.append("meta", JSON.stringify({ width: 800, height: 600, ...meta }));
  return j(`/api/artworks/${id}/images`, { method: "POST", body: fd });
}

describe("auth (Cloudflare Access only)", () => {
  test("dev identity works only in the dev environment", async () => {
    const r = await j("/api/me");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { email: "dev@localhost", via: "dev" });
  });
  test("without Access or dev auth every route is refused", async () => {
    for (const p of ["/api/me", "/api/artworks", "/img/artworks/x/y.jpg", "/mcp"]) {
      const r = await j(p, p === "/mcp" ? { method: "POST", body: "{}" } : {}, NOAUTH);
      assert.equal(r.status, 401, p);
    }
  });
  test("with Access configured, missing or forged tokens are refused (fails closed)", async () => {
    assert.equal((await j("/api/artworks", {}, ACCESS)).status, 401);
    assert.equal((await j("/api/artworks", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } }, ACCESS)).status, 401);
    assert.equal((await j("/api/artworks", { headers: { "X-Dev-User": "anne@example.com" } }, ACCESS)).status, 401);
  });
  test("the app shell is still served so Access can show its login", async () => {
    const r = await fetch(ACCESS + "/");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<div id="root">/);
  });
});

describe("fields", () => {
  test("lists the starter fields", async () => {
    const r = await j("/api/fields");
    assert.equal(r.status, 200);
    const keys = r.body.map((f) => f.key);
    for (const k of ["medium", "subjects", "style", "dimensions", "location", "series", "notes"]) assert.ok(keys.includes(k), k);
    assert.equal(r.body.find((f) => f.key === "medium").filterable, true);
    assert.equal(r.body.find((f) => f.key === "location").filterable, true, "location is filterable (migration 0002)");
  });
  test("adds a new flexible field, rejects duplicates and bad definitions", async () => {
    const ok = await j("/api/fields", { method: "POST", body: JSON.stringify({ key: "frame", label: "Frame", type: "select", options: { choices: ["Gold", "Black"], allowNew: false }, filterable: true }) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.key, "frame");
    assert.equal((await j("/api/fields", { method: "POST", body: JSON.stringify({ key: "frame", label: "Frame", type: "text" }) })).status, 409);
    assert.equal((await j("/api/fields", { method: "POST", body: JSON.stringify({ key: "Bad Key", label: "x", type: "text" }) })).status, 422);
  });
});

describe("artworks", () => {
  let a;
  test("creates with an auto catalog number, canonical choices and new choices recorded", async () => {
    const r = await j("/api/artworks", { method: "POST", body: JSON.stringify({ title: "Soda Lake Study", yearStart: 2019, status: "in_studio", attrs: { medium: "pastel", subjects: ["Landscape", "Lake Shore"], frame: "Gold" } }) });
    assert.equal(r.status, 201);
    a = r.body;
    assert.match(a.catalogId, /^2019-\d{3}$/);
    assert.equal(a.attrs.medium, "Pastel");
    assert.equal(a.version, 1);
    const f = await j("/api/fields");
    assert.ok(f.body.find((x) => x.key === "subjects").options.choices.includes("Lake Shore"));
    const undated = await j("/api/artworks", { method: "POST", body: "{}" });
    assert.match(undated.body.catalogId, /^undated-\d{3}$/);
  });
  test("rejects invalid input with field-level issues", async () => {
    const r = await j("/api/artworks", { method: "POST", body: JSON.stringify({ yearStart: 1500, attrs: { nope: 1, frame: "Silver" } }) });
    assert.equal(r.status, 422);
    const r2 = await j("/api/artworks", { method: "POST", body: JSON.stringify({ attrs: { nope: 1, frame: "Silver" } }) });
    assert.equal(r2.status, 422);
    assert.deepEqual(r2.body.details.map((d) => d.key).sort(), ["frame", "nope"]);
    const r3 = await j("/api/artworks", { method: "POST", body: JSON.stringify({ yearStart: 2000, yearEnd: 1990 }) });
    assert.equal(r3.status, 422);
  });
  test("updates with optimistic concurrency and keeps revisions", async () => {
    const stale = await j(`/api/artworks/${a.id}`, { method: "PATCH", body: JSON.stringify({ version: 99, title: "x" }) });
    assert.equal(stale.status, 409);
    const missing = await j(`/api/artworks/${a.id}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) });
    assert.equal(missing.status, 422);
    const ok = await j(`/api/artworks/${a.id}`, { method: "PATCH", body: JSON.stringify({ version: 1, title: "Soda Lake Study No. 2", status: "on_show", attrs: { frame: null, notes: "Painted at dawn" } }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, 2);
    assert.equal(ok.body.status, "on_show");
    assert.equal(ok.body.attrs.frame, undefined);
    assert.equal(ok.body.attrs.notes, "Painted at dawn");
    assert.equal(ok.body.attrs.medium, "Pastel");
    const rev = await j(`/api/artworks/${a.id}/revisions`);
    assert.deepEqual(rev.body.map((x) => x.version), [2, 1]);
    assert.equal(rev.body[0].changed_by, "dev@localhost");
    const bad = await j(`/api/artworks/${a.id}`, { method: "PATCH", body: JSON.stringify({ version: 2, yearEnd: 2001 }) });
    assert.equal(bad.status, 422);
    a = ok.body;
  });
  test("looks up by catalog number and 404s on unknown ids", async () => {
    assert.equal((await j(`/api/artworks/${a.catalogId}`)).body.id, a.id);
    assert.equal((await j("/api/artworks/nope")).status, 404);
  });

  describe("images", () => {
    let img1, img2;
    test("uploads an original with phone-made variants; first finished image becomes the cover", async () => {
      const r = await upload(a.id, await jpeg({ r: 200, g: 60, b: 40 }), { kind: "work", role: "Front", palette: ["#C83C28", "#3050C0"] });
      assert.equal(r.status, 201);
      img1 = r.body.image;
      assert.equal(r.body.duplicate, false);
      assert.match(img1.original, /^\/img\/artworks\/2019-\d{3}\/[0-9a-f]{16}\.jpg$/);
      assert.match(img1.display, /-display\.jpg$/);
      assert.match(img1.thumb, /-thumb\.jpg$/);
      const art = await j(`/api/artworks/${a.id}`);
      assert.equal(art.body.coverImageId, img1.id);
      assert.deepEqual(art.body.palette, ["#C83C28", "#3050C0"]);
    });
    test("serves originals with caching, 304s and no path traversal", async () => {
      const r = await fetch(BASE + img1.original);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "image/jpeg");
      const etag = r.headers.get("etag");
      assert.ok(etag);
      assert.match(r.headers.get("cache-control"), /immutable/);
      const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      assert.equal(meta.width, 800);
      assert.equal((await fetch(BASE + img1.original, { headers: { "If-None-Match": etag } })).status, 304);
      assert.equal((await fetch(BASE + "/img/backups/x.json")).status, 404);
      assert.equal((await fetch(BASE + "/img/artworks/%2e%2e/secret")).status, 404);
      const dl = await fetch(BASE + img1.original + "?download=1");
      assert.match(dl.headers.get("content-disposition"), /attachment/);
    });
    test("keeps many images per piece of different kinds; detects duplicates", async () => {
      const s = await upload(a.id, await jpeg({ r: 120, g: 120, b: 120 }), { kind: "study", role: "Thumbnail sketch" });
      assert.equal(s.status, 201);
      img2 = s.body.image;
      await upload(a.id, await jpeg({ r: 90, g: 140, b: 90 }), { kind: "reference", role: "Reference photo" });
      await upload(a.id, await jpeg({ r: 240, g: 230, b: 210 }), { kind: "progress", role: "Underpainting" }, { variants: false });
      const dupe = await upload(a.id, await jpeg({ r: 200, g: 60, b: 40 }), { kind: "work" });
      assert.equal(dupe.status, 200);
      assert.equal(dupe.body.duplicate, true);
      const art = await j(`/api/artworks/${a.id}`);
      assert.deepEqual(art.body.images.map((i) => i.kind), ["work", "progress", "study", "reference"]);
      const noVariant = art.body.images.find((i) => i.kind === "progress");
      assert.equal(noVariant.display, noVariant.original, "falls back to the original when no variant was made");
    });
    test("rejects non-images, missing files and bad metadata", async () => {
      const txt = await upload(a.id, Buffer.from("hello"), {}, { name: "notes.txt", type: "text/plain", variants: false });
      assert.equal(txt.status, 415);
      const fd = new FormData(); fd.append("meta", "{}");
      assert.equal((await j(`/api/artworks/${a.id}/images`, { method: "POST", body: fd })).status, 422);
      const badKind = await upload(a.id, await jpeg({ r: 1, g: 2, b: 3 }), { kind: "selfie" });
      assert.equal(badKind.status, 422);
    });
    test("re-labels images, changes the cover, and removes images", async () => {
      const u = await j(`/api/images/${img2.id}`, { method: "PATCH", body: JSON.stringify({ kind: "work", role: "Detail", makeCover: true }) });
      assert.equal(u.status, 200);
      assert.equal(u.body.coverImageId, img2.id);
      assert.equal(u.body.images.find((i) => i.id === img2.id).role, "Detail");
      const d = await j(`/api/images/${img2.id}`, { method: "DELETE" });
      assert.equal(d.status, 200);
      assert.equal(d.body.images.some((i) => i.id === img2.id), false);
      assert.equal(d.body.coverImageId, img1.id, "cover falls back to another finished image");
      assert.equal((await j(`/api/images/${img2.id}`, { method: "PATCH", body: JSON.stringify({ role: "x" }) })).status, 404);
    });
    test("writes a self-describing record.json next to the images", async () => {
      const art = (await j(`/api/artworks/${a.id}`)).body;
      const r = await j(`/img/artworks/${art.catalogId}/record.json`);
      assert.equal(r.status, 200);
      assert.equal(r.body.title, "Soda Lake Study No. 2");
      assert.equal(r.body.status, "On show");
      assert.equal(r.body.images.length, art.images.length);
      assert.ok(r.body.fields.find((f) => f.key === "medium" && f.display === "Pastel"));
    });
  });

  describe("browse, search, similar", () => {
    before(async () => {
      const mk = async (title, year, attrs, color) => {
        const r = await j("/api/artworks", { method: "POST", body: JSON.stringify({ title, yearStart: year, attrs }) });
        await upload(r.body.id, await jpeg(color), { kind: "work", role: "Front", palette: [`#${[color.r, color.g, color.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`] });
        return r.body;
      };
      await mk("Paso Robles Jazz Fest", 2014, { medium: "Pastel", subjects: ["Music & people", "Night"] }, { r: 150, g: 40, b: 80 });
      await mk("Templeton Feed Grain", 1998, { medium: "Print", subjects: ["Rural"] }, { r: 166, g: 61, b: 46 });
      await mk("Prismatic Sunset at Soda Lake", 2024, { medium: "Oil", subjects: ["Landscape", "Water"] }, { r: 123, g: 58, b: 142 });
    });
    test("lists summaries with everything the timeline and wall need", async () => {
      const r = await j("/api/artworks");
      assert.equal(r.status, 200);
      const s = r.body.find((x) => x.title === "Soda Lake Study No. 2");
      assert.ok(s.thumb && s.display);
      assert.ok(Math.abs(s.aspect - 800 / 600) < 0.01);
      assert.equal(s.imageCount, 3);
      const years = r.body.map((x) => x.yearStart).filter((y) => y != null);
      assert.deepEqual(years, [...years].sort((x, y) => x - y));
    });
    test("finds pieces by meaning and by words", async () => {
      const m = await j("/api/search?q=" + encodeURIComponent("concert crowd at night"));
      assert.equal(m.status, 200);
      const list = (await j("/api/artworks")).body;
      const title = (id) => list.find((x) => x.id === id)?.title;
      assert.equal(title(m.body.results[0].id), "Paso Robles Jazz Fest");
      assert.ok(m.body.results[0].match > 0 && m.body.results[0].match <= 1);
      const w = await j("/api/search?q=templeton");
      assert.equal(title(w.body.results[0].id), "Templeton Feed Grain");
      assert.ok(w.body.results[0].via.includes("words") && w.body.results[0].via.includes("title"));
      assert.ok(w.body.results[0].match >= 0.97);
      const sunset = await j("/api/search?q=" + encodeURIComponent("warm sunset over water"));
      assert.ok(sunset.body.results.slice(0, 2).some((r) => /Sunset|Soda Lake/.test(title(r.id))));
      assert.deepEqual((await j("/api/search?q=")).body.results, []);
    });
    test("suggests similar pieces, never itself", async () => {
      const list = (await j("/api/artworks")).body;
      const sunset = list.find((x) => x.title.startsWith("Prismatic"));
      const r = await j(`/api/artworks/${sunset.id}/similar`);
      assert.equal(r.status, 200);
      assert.ok(r.body.length >= 2);
      assert.ok(!r.body.some((x) => x.id === sunset.id));
      assert.equal(list.find((x) => x.id === r.body[0].id).title, "Soda Lake Study No. 2");
    });
  });

  describe("delete + backup", () => {
    test("soft-deletes: gone from the list, lookups and search", async () => {
      const t = await j("/api/artworks", { method: "POST", body: JSON.stringify({ title: "Zanzibar Test Piece" }) });
      assert.ok((await j("/api/search?q=zanzibar")).body.results.length);
      assert.equal((await j(`/api/artworks/${t.body.id}`, { method: "DELETE" })).status, 204);
      assert.equal((await j(`/api/artworks/${t.body.id}`)).status, 404);
      assert.ok(!(await j("/api/artworks")).body.some((x) => x.id === t.body.id));
      assert.deepEqual((await j("/api/search?q=zanzibar")).body.results, []);
    });
    test("exports the whole archive to R2 on demand and on the nightly cron", async () => {
      const r = await j("/api/admin/backup", { method: "POST" });
      assert.equal(r.status, 200);
      assert.match(r.body.key, /^backups\/\d{4}-\d{2}-\d{2}\.json$/);
      assert.ok(r.body.artworks >= 5 && r.body.images >= 6);
      const cron = await fetch(BASE + "/__scheduled?cron=17+10+*+*+*");
      assert.equal(cron.status, 200);
      const list = await j("/api/admin/backups");
      assert.equal(list.body[0].key, r.body.key);
      assert.ok(list.body[0].bytes > 1000);
    });
  });
});

describe("review fixes", () => {
  test("concurrent adds never collide on catalog numbers", async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => j("/api/artworks", { method: "POST", body: JSON.stringify({ title: `Race ${i}`, yearStart: 2005 }) })));
    assert.deepEqual(rs.map((r) => r.status), Array(10).fill(201));
    const ids = rs.map((r) => r.body.catalogId);
    assert.equal(new Set(ids).size, 10, ids.join(","));
    assert.ok(ids.every((c) => /^2005-\d{3}$/.test(c)));
  });
  test("a required custom field never blocks adding a work, but can't be cleared once set", async () => {
    assert.equal((await j("/api/fields", { method: "POST", body: JSON.stringify({ key: "provenance", label: "Provenance", type: "text", required: true }) })).status, 201);
    const a = await j("/api/artworks", { method: "POST", body: JSON.stringify({ status: "in_studio" }) });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const set = await j(`/api/artworks/${a.body.id}`, { method: "PATCH", body: JSON.stringify({ version: 1, attrs: { provenance: "Bought from the artist" } }) });
    assert.equal(set.status, 200);
    const clear = await j(`/api/artworks/${a.body.id}`, { method: "PATCH", body: JSON.stringify({ version: 2, attrs: { provenance: "" } }) });
    assert.equal(clear.status, 422);
  });
  test("field definitions can be edited and archived (key and type fixed)", async () => {
    const r = await j("/api/fields/provenance", { method: "PATCH", body: JSON.stringify({ label: "Where it came from", required: false, filterable: true, archived: true }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.label, "Where it came from");
    assert.equal(r.body.archived, true);
    assert.equal(r.body.required, false);
    const back = await j("/api/fields/provenance", { method: "PATCH", body: JSON.stringify({ archived: false }) });
    assert.equal(back.body.archived, false);
    assert.equal((await j("/api/fields/medium", { method: "PATCH", body: JSON.stringify({ options: { choices: "nope" } }) })).status, 422);
    assert.equal((await j("/api/fields/medium", { method: "PATCH", body: JSON.stringify({ type: "text" }) })).status, 422);
    assert.equal((await j("/api/fields/nope", { method: "PATCH", body: JSON.stringify({ label: "x" }) })).status, 404);
    const m = await j("/api/fields/medium", { method: "PATCH", body: JSON.stringify({ options: { choices: ["Oil", "Pastel", "Print", "Serigraph", "Watercolor", "Mixed media", "Gouache"], allowNew: true } }) });
    assert.ok(m.body.options.choices.includes("Gouache"));
  });
  test("uploads must really be images: bytes are checked, not names or types", async () => {
    const a = (await j("/api/artworks", { method: "POST", body: JSON.stringify({ title: "Upload checks" }) })).body;
    const send = async (bytes, name, type) => { const fd = new FormData(); fd.append("original", new File([bytes], name, { type })); fd.append("meta", "{}"); return j(`/api/artworks/${a.id}/images`, { method: "POST", body: fd }); };
    assert.equal((await send(Buffer.from("definitely not a jpeg"), "x.jpg", "image/jpeg")).status, 415);
    assert.equal((await send(Buffer.alloc(0), "empty.jpg", "image/jpeg")).status, 422);
    assert.equal((await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "x.svg", "image/svg+xml")).status, 415);
    assert.equal((await send(Buffer.from("<html><script>alert(1)</script></html>"), "x.png", "image/png")).status, 415);
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 200, b: 90 } } }).png().toBuffer();
    const ok = await send(png, "camera-roll.bin", "application/octet-stream");
    assert.equal(ok.status, 201);
    assert.equal(ok.body.image.contentType, "image/png");
    assert.match(ok.body.image.original, /\.png$/);
    const fd = new FormData();
    fd.append("original", new File([await jpeg({ r: 5, g: 6, b: 7 })], "a.jpg", { type: "image/jpeg" }));
    fd.append("thumb", new File([Buffer.from("<svg/>")], "t.jpg", { type: "image/jpeg" }));
    assert.equal((await j(`/api/artworks/${a.id}/images`, { method: "POST", body: fd })).status, 415);
    const img = await fetch(BASE + ok.body.image.original);
    assert.equal(img.headers.get("x-content-type-options"), "nosniff");
    assert.match(img.headers.get("content-security-policy"), /sandbox/);
  });
  test("odd inputs are handled cleanly", async () => {
    assert.equal((await fetch(BASE + "/img/artworks/%E0%A4%A")).status, 404);
    const s = await j("/api/search?q=landscape&limit=-5");
    assert.equal(s.status, 200);
    assert.ok(s.body.results.length <= 60);
    const one = await j("/api/search?q=a");
    assert.ok(!one.body.results.some((r) => r.via.includes("title")), "single letters don't trigger title matches");
    assert.equal((await j("/api/artworks", { method: "POST", body: JSON.stringify({ yearEnd: 1990 }) })).status, 422);
    const bad = await j("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 9 }) });
    assert.equal(bad.body.error.code, -32600);
  });
});

describe("MCP endpoint", () => {
  const rpc = (method, params, id = 1) => j("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  test("initialises and lists tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.body.result.serverInfo.name, "anne-laddon-archive");
    assert.equal((await j("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })).status, 202);
    const tools = await rpc("tools/list");
    assert.deepEqual(tools.body.result.tools.map((t) => t.name).sort(), ["get_artwork", "list_fields", "search_artworks", "update_artwork"]);
  });
  test("searches, reads and updates through tools", async () => {
    const s = await rpc("tools/call", { name: "search_artworks", arguments: { query: "jazz music", limit: 3 } });
    const hits = JSON.parse(s.body.result.content[0].text);
    assert.equal(hits[0].title, "Paso Robles Jazz Fest");
    const filtered = JSON.parse((await rpc("tools/call", { name: "search_artworks", arguments: { medium: "print" } })).body.result.content[0].text);
    assert.ok(filtered.every((x) => x.medium === "Print"));
    const g = JSON.parse((await rpc("tools/call", { name: "get_artwork", arguments: { id: hits[0].catalogId } })).body.result.content[0].text);
    const u = await rpc("tools/call", { name: "update_artwork", arguments: { id: g.id, version: g.version, attrs: { notes: "Added from Claude" } } });
    assert.equal(JSON.parse(u.body.result.content[0].text).version, g.version + 1);
    const conflict = await rpc("tools/call", { name: "update_artwork", arguments: { id: g.id, version: g.version, title: "x" } });
    assert.equal(conflict.body.result.isError, true);
    const rev = await j(`/api/artworks/${g.id}/revisions`);
    assert.equal(rev.body[0].changed_by, "mcp:dev@localhost");
  });
  test("returns JSON-RPC errors for unknown methods and tools", async () => {
    assert.equal((await rpc("nope")).body.error.code, -32601);
    assert.equal((await rpc("tools/call", { name: "drop_tables", arguments: {} })).body.error.code, -32602);
    assert.equal((await j("/mcp", { method: "POST", body: "{bad" })).body.error.code, -32700);
  });
});

describe("routing", () => {
  test("unknown API routes 404 as JSON; app routes fall back to the SPA", async () => {
    const r = await j("/api/nope");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "Not found");
    const spa = await fetch(BASE + "/some/deep/link");
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /<div id="root">/);
  });
});
