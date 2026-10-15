#!/usr/bin/env node
/**
 * Seeds a local archive through the real API with sample works. Titles are from
 * anneladdon.com; the images are generated stand-ins (no real photos), and
 * years, sizes and statuses are placeholders.
 *
 *   npm run dev            # in one terminal
 *   npm run seed           # in another (BASE=http://localhost:8787 by default)
 *
 * At the end it prints a bulk-archive command for the works it added, so sample
 * data can be put out of sight (reversibly) once it has served its purpose.
 */
import sharp from "sharp";

const BASE = process.env.BASE || "http://localhost:8787";
const EXTRAS = process.env.EXTRAS !== "0";

const W = 1400;
const noise = `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>`;

function svg(aspect, body) {
  const H = Math.round(W / aspect);
  return { H, xml: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 100 ${100 / aspect}" preserveAspectRatio="none"><defs>${noise}</defs>${body(100 / aspect)}<rect width="100" height="${100 / aspect}" filter="url(#g)" opacity=".9"/></svg>` };
}
const bands = (h, stops, id = "b") => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient></defs><rect width="100" height="${h}" fill="url(#${id})"/>`;
const hard = (stops) => stops.flatMap(([a, b, c], i, arr) => [[a, c], [b, c]]); // [[from,to,color]] -> hard bands
const dots = (h, y0, color, step, r, seed = 1) => {
  let s = seed, out = "";
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = y0; y < h; y += step) for (let x = 0; x < 100; x += step) out += `<circle cx="${(x + rnd() * step).toFixed(1)}" cy="${(y + rnd() * step).toFixed(1)}" r="${(r * (0.6 + rnd() * 0.8)).toFixed(2)}" fill="${color}"/>`;
  return out;
};

const WORKS = [
  { title: "Torpedo Factory serigraph", year: 1979, circa: true, status: "in_studio", medium: "Serigraph", subjects: ["Abstract"], style: "Graphic", dimensions: "[size]", location: "Archive box 1", series: "Torpedo Factory", aspect: 0.8,
    art: (h) => bands(h, hard([[0, .56, "#1D3557"], [.56, .7, "#E63946"], [.7, .77, "#F1FAEE"], [.77, 1, "#457B9D"]])) + `<circle cx="68" cy="${h * .34}" r="15" fill="#F2C14E"/>` },
  { title: "Bluff Trail Abstract", year: 1988, status: "gifted", medium: "Print", subjects: ["Abstract", "Water"], style: "Abstract", dimensions: "20 × 20 in", location: "Family", aspect: 1,
    art: (h) => `<rect width="100" height="${h}" fill="#7F5539"/><polygon points="0,0 100,0 100,18 0,52" fill="#1B4965"/><polygon points="0,52 100,18 100,34 0,64" fill="#62B6CB"/><polygon points="0,64 100,34 100,42 0,70" fill="#CAE9FF"/><polygon points="0,70 100,42 100,52 0,78" fill="#BEE9E8"/><polygon points="0,78 100,52 100,74 0,95" fill="#C9A66B"/>` },
  { title: "John Day River, Towering Rocks", year: 1993, status: "on_show", medium: "Pastel", subjects: ["Landscape", "Water"], style: "Representational", dimensions: "24 × 18 in", location: "Group show", aspect: 0.75,
    art: (h) => bands(h, [[0, "#9EC9E2"], [.36, "#D8E9F0"], [.36, "#C46A4A"], [.68, "#7D3B2C"], [.68, "#4F7C8A"], [1, "#2F5A68"]]) + `<polygon points="10,${h * .36} 28,${h * .1} 34,${h * .68} 6,${h * .68}" fill="#8E3B2E" opacity=".75"/><polygon points="62,${h * .68} 70,${h * .14} 86,${h * .2} 90,${h * .68}" fill="#B5523B" opacity=".7"/>` },
  { title: "Templeton Feed Grain", year: 1998, status: "sold", medium: "Print", subjects: ["Rural", "Landscape"], style: "Representational", dimensions: "20 × 20 in", location: "Private collection", aspect: 1,
    art: (h) => bands(h, [[0, "#F2D6A2"], [.55, "#F7E8C8"], [.78, "#C9A25A"], [1, "#8A6A35"]]) + `<rect x="12" y="45" width="40" height="33" fill="#A63D2E"/><polygon points="10,45 32,30 54,45" fill="#7E2C21"/><rect x="58" y="24" width="14" height="54" fill="#C8C3B8"/><ellipse cx="65" cy="24" rx="7" ry="5" fill="#B9B3A6"/>` },
  { title: "Adelaida Hilltop View", year: 2004, status: "in_studio", medium: "Print", subjects: ["Landscape", "Rural"], style: "Representational", dimensions: "16 × 24 in", location: "Print bin", aspect: 1.6,
    art: (h) => bands(h, [[0, "#8DB6D9"], [.62, "#E6EEF2"]]) + `<ellipse cx="55" cy="${h * 1.2}" rx="70" ry="${h * .7}" fill="#C9B458"/><ellipse cx="80" cy="${h * 1.05}" rx="50" ry="${h * .5}" fill="#9AA552"/><ellipse cx="30" cy="${h}" rx="45" ry="${h * .45}" fill="#7A8B3E"/><circle cx="62" cy="${h * .52}" r="2.4" fill="#2F3B22"/><circle cx="40" cy="${h * .61}" r="2" fill="#2F3B22"/>` },
  { title: "Summer Floral Classic", year: 2008, status: "gifted", medium: "Oil", subjects: ["Flowers"], style: "Representational", dimensions: "20 × 16 in", location: "Family", aspect: 0.8,
    art: (h) => `<defs><linearGradient id="fl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1F3B2D"/><stop offset=".55" stop-color="#2E5E45"/><stop offset="1" stop-color="#3F7A55"/></linearGradient></defs><rect width="100" height="${h}" fill="url(#fl)"/><circle cx="30" cy="${h * .35}" r="11" fill="#F25C54"/><circle cx="62" cy="${h * .28}" r="10" fill="#F7B267"/><circle cx="48" cy="${h * .58}" r="9" fill="#F4F1DE"/><circle cx="72" cy="${h * .62}" r="11" fill="#E07A9F"/><circle cx="25" cy="${h * .7}" r="8" fill="#9C89B8"/>` },
  { title: "Superbloom Classic", year: 2011, status: "in_studio", medium: "Print", subjects: ["Flowers", "Landscape"], style: "Representational", dimensions: "18 × 24 in", location: "Print bin", series: "Superbloom", aspect: 1.33,
    art: (h) => bands(h, [[0, "#F7D9C4"], [.3, "#FBE9DC"], [.3, "#7D6BB0"], [.4, "#5A4A93"], [.4, "#E8B92F"], [.7, "#D9A21E"], [1, "#6E8B3D"]]) + dots(h, h * .42, "#7E5BD1", 2.2, .45, 3) + dots(h, h * .44, "#FFD23F", 2.4, .4, 9) },
  { title: "Paso Robles Jazz Fest, Anthony Fung Trio", year: 2014, status: "in_studio", medium: "Pastel", subjects: ["Music & people", "Night"], style: "Representational", dimensions: "18 × 22 in", location: "Flat file 1", aspect: 1.2,
    art: (h) => bands(h, [[0, "#5A1E4A"], [.5, "#9B2D4F"], [.8, "#D9603B"], [.8, "#3A1630"], [1, "#3A1630"]]) + `<polygon points="30,0 18,${h * .8} 42,${h * .8}" fill="#FFD678" opacity=".28"/><polygon points="72,0 60,${h * .8} 84,${h * .8}" fill="#FF96AA" opacity=".25"/><ellipse cx="34" cy="${h * .68}" rx="5" ry="10" fill="#2A1530"/><ellipse cx="52" cy="${h * .64}" rx="6" ry="12" fill="#2A1530"/><ellipse cx="70" cy="${h * .69}" rx="5" ry="10" fill="#2A1530"/>` },
  { title: "September Sunset on Desolation Gray Canyon", year: 2016, status: "on_show", medium: "Oil", subjects: ["Landscape"], style: "Representational", dimensions: "24 × 36 in", location: "Group show", aspect: 1.5,
    art: (h) => bands(h, [[0, "#F6B26B"], [.2, "#E8775A"], [.36, "#9D4E6B"], [.36, "#6D5E66"], [1, "#4A4250"]]) + `<polygon points="0,${h * .36} 22,${h * .3} 36,${h} 0,${h}" fill="#5B5260"/><polygon points="36,${h} 30,${h * .4} 52,${h * .34} 60,${h}" fill="#A88C7D"/><polygon points="60,${h} 66,${h * .38} 100,${h * .32} 100,${h}" fill="#7D6F78"/><rect y="${h * .85}" width="100" height="${h * .05}" fill="#A0BED2" opacity=".55"/>` },
  { title: "Padres vs. Pittsburgh, Petco Park", year: 2017, status: "sold", medium: "Pastel", subjects: ["Sports", "Night"], style: "Representational", dimensions: "16 × 20 in", location: "Private collection", aspect: 1.25,
    art: (h) => bands(h, [[0, "#0E1A3A"], [.45, "#1F2F5C"], [.62, "#2C2A3A"], [1, "#3A3242"]]) + `<ellipse cx="50" cy="${h * 1.1}" rx="62" ry="${h * .45}" fill="#3E8E41"/><ellipse cx="50" cy="${h * 1.12}" rx="26" ry="${h * .2}" fill="#C99A5B"/><circle cx="18" cy="${h * .22}" r="6" fill="#FFF6D5" opacity=".35"/><circle cx="18" cy="${h * .22}" r="2" fill="#FFF6D5"/><circle cx="82" cy="${h * .22}" r="6" fill="#FFF6D5" opacity=".35"/><circle cx="82" cy="${h * .22}" r="2" fill="#FFF6D5"/>` },
  { title: "Soda Lake Superbloom", year: 2019, status: "sold", medium: "Oil", subjects: ["Flowers", "Landscape", "Water"], style: "Representational", dimensions: "24 × 30 in", location: "Private collection", series: "Soda Lake", aspect: 1.25,
    art: (h) => bands(h, [[0, "#9FC3E6"], [.34, "#D7E3EE"], [.34, "#9B8FC7"], [.48, "#6E62A6"], [.48, "#E9A23B"], [.72, "#F1C54A"], [1, "#8FA548"]]) + dots(h, h * .5, "#FFC94A", 2.4, .5, 5) + dots(h, h * .52, "#B46BD6", 2.6, .42, 11) },
  { title: "Dip Creek Abstract", year: 2021, status: "in_studio", medium: "Oil", subjects: ["Abstract", "Water"], style: "Abstract", dimensions: "36 × 28 in", location: "Rack B", aspect: 0.78,
    art: (h) => `<rect width="100" height="${h}" fill="#5E8B7E"/><polygon points="0,0 60,0 20,${h}  0,${h}" fill="#2F5D62"/><polygon points="60,0 100,0 100,${h * .5} 40,${h * .7}" fill="#A7C4A0"/><polygon points="40,${h * .7} 100,${h * .5} 100,${h} 70,${h}" fill="#D9824B"/><polygon points="20,${h} 40,${h * .7} 70,${h}" fill="#E8D8A6"/><polygon points="30,0 38,0 10,${h} 2,${h}" fill="#14282D" opacity=".5"/>` },
  { title: "Soda Lake Sunset Abstract at Carrizo Plains", year: 2023, status: "in_studio", medium: "Pastel", subjects: ["Abstract", "Water", "Landscape"], style: "Abstract", dimensions: "18 × 24 in", location: "Flat file 2", series: "Soda Lake", aspect: 1.33,
    notes: "Painted on site at the plains as the light went; the lake was almost dry that year.",
    art: (h) => bands(h, [[0, "#FFB5A7"], [.3, "#FCD5CE"], [.42, "#F8EDEB"], [.42, "#B8C0FF"], [.52, "#E2D4F7"], [.52, "#C08497"], [1, "#9D6B7F"]]) },
  { title: "Prismatic Sunset at Soda Lake", year: 2024, status: "in_studio", medium: "Oil", subjects: ["Landscape", "Water"], style: "Representational", dimensions: "30 × 40 in", location: "Studio wall", series: "Soda Lake", aspect: 1.33,
    art: (h) => bands(h, [[0, "#2E2463"], [.16, "#7B3A8E"], [.3, "#D9507A"], [.42, "#F7894A"], [.5, "#FFD27A"], [.5, "#C7B3EC"], [.56, "#EADCF7"], [.56, "#9C88CF"], [.64, "#5C4B8C"], [.64, "#D2A65C"], [.82, "#A07F3F"], [1, "#6E5528"]]) + `<circle cx="68" cy="${h * .47}" r="10" fill="#FFD68C" opacity=".45"/><circle cx="68" cy="${h * .47}" r="4" fill="#FFF4C8"/>` },
];

// ---------------------------------------------------------------- helpers
function kmeansPalette(px, k = 5) {
  if (!px.length) return [];
  const centers = [];
  for (let i = 0; i < k; i++) centers.push(px[Math.floor(((i + 0.5) / k) * px.length)].slice());
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    assign = px.map((p) => { let best = 0, bd = Infinity; centers.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } }); return best; });
    const sums = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sums.forEach((s, j) => { if (s[3]) centers[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = centers.map((_, j) => assign.filter((a) => a === j).length);
  const out = [];
  centers.map((c, j) => ({ c, n: counts[j] })).filter((x) => x.n).sort((a, b) => b.n - a.n).forEach(({ c }) => {
    if (out.some((h) => { const n = parseInt(h.slice(1), 16); return Math.abs(((n >> 16) & 255) - c[0]) + Math.abs(((n >> 8) & 255) - c[1]) + Math.abs((n & 255) - c[2]) < 36; })) return;
    out.push("#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase());
  });
  return out;
}

async function variants(buf) {
  const img = sharp(buf);
  const meta = await img.metadata();
  const display = await sharp(buf).resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  const thumb = await sharp(buf).resize(560, 560, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const { data } = await sharp(buf).resize(48, 48, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = []; for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i + 1], data[i + 2]]);
  return { display, thumb, width: meta.width, height: meta.height, palette: kmeansPalette(px) };
}

async function api(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...init.headers } });
  const body = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
}

async function upload(id, buf, name, meta) {
  const v = await variants(buf);
  const fd = new FormData();
  fd.append("original", new File([buf], name, { type: "image/jpeg" }));
  fd.append("display", new File([v.display], "display.jpg", { type: "image/jpeg" }));
  fd.append("thumb", new File([v.thumb], "thumb.jpg", { type: "image/jpeg" }));
  fd.append("meta", JSON.stringify({ ...meta, width: v.width, height: v.height, palette: v.palette }));
  return api(`/api/artworks/${id}/images`, { method: "POST", body: fd });
}

const BACK = (aspect) => svg(aspect, (h) => `<rect width="100" height="${h}" fill="#A47D50"/><rect x="5" y="5" width="90" height="${h - 10}" fill="none" stroke="#6E4F2E" stroke-width="3" opacity=".5"/><rect x="54" y="${h * .66}" width="30" height="${h * .14}" fill="#F7F3EA"/><path d="M57 ${h * .71} h22 M57 ${h * .75} h16" stroke="#6E6253" stroke-width=".8"/>`);

// ---------------------------------------------------------------- main
const existing = await api("/api/artworks");
if (existing.length && !process.env.FORCE) { console.log(`Archive already has ${existing.length} works; set FORCE=1 to add the samples anyway.`); process.exit(0); }

const seeded = [];
for (const w of WORKS) {
  const { xml } = svg(w.aspect, w.art);
  const master = await sharp(Buffer.from(xml)).jpeg({ quality: 92 }).toBuffer();
  const attrs = { medium: w.medium, subjects: w.subjects, style: w.style, dimensions: w.dimensions, location: w.location, ...(w.series ? { series: w.series } : {}), ...(w.notes ? { notes: w.notes } : {}) };
  const a = await api("/api/artworks", { method: "POST", body: JSON.stringify({ title: w.title, yearStart: w.year, circa: !!w.circa, status: w.status, attrs }) });
  await upload(a.id, master, `${a.catalogId}-front.jpg`, { kind: "work", role: "Front", makeCover: true });
  if (EXTRAS) {
    const m = await sharp(master).metadata();
    const cw = Math.round(m.width * .42), ch = Math.round(m.height * .42);
    const detail = await sharp(master).extract({ left: Math.round(m.width * .3), top: Math.round(m.height * .4), width: cw, height: ch }).resize(1400).jpeg({ quality: 90 }).toBuffer();
    const back = await sharp(Buffer.from(BACK(w.aspect).xml)).jpeg({ quality: 88 }).toBuffer();
    const sketch = await sharp(master).greyscale().linear(1.7, -60).blur(1.2).jpeg({ quality: 88 }).toBuffer();
    const colorStudy = await sharp(master).resize(Math.round(m.width / 6)).blur(3).resize(m.width).modulate({ saturation: 0.85 }).jpeg({ quality: 88 }).toBuffer();
    const paper = (frac) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><rect x="${Math.round(m.width * frac)}" width="${m.width}" height="${m.height}" fill="#EFE9DD" opacity=".93"/></svg>`);
    const under = await sharp(master).modulate({ saturation: 0.6 }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><rect y="${Math.round(m.height * .36)}" width="${m.width}" height="${m.height}" fill="#EFE9DD" opacity=".9"/></svg>`) }]).jpeg({ quality: 88 }).toBuffer();
    const half = await sharp(master).composite([{ input: paper(0.52) }]).jpeg({ quality: 88 }).toBuffer();
    const ref = await sharp(master).extract({ left: Math.round(m.width * .1), top: Math.round(m.height * .15), width: Math.round(m.width * .8), height: Math.round(m.height * .7) }).modulate({ saturation: 0.45, brightness: 1.05 }).tint({ r: 210, g: 190, b: 160 }).jpeg({ quality: 88 }).toBuffer();
    await upload(a.id, detail, `${a.catalogId}-detail.jpg`, { kind: "work", role: "Detail" });
    await upload(a.id, back, `${a.catalogId}-back.jpg`, { kind: "work", role: "Back & label" });
    await upload(a.id, ref, `${a.catalogId}-reference.jpg`, { kind: "reference", role: "Reference photo" });
    await upload(a.id, sketch, `${a.catalogId}-sketch.jpg`, { kind: "study", role: "Thumbnail sketch" });
    await upload(a.id, colorStudy, `${a.catalogId}-color-study.jpg`, { kind: "study", role: "Color study" });
    await upload(a.id, under, `${a.catalogId}-underpainting.jpg`, { kind: "progress", role: "Underpainting" });
    await upload(a.id, half, `${a.catalogId}-halfway.jpg`, { kind: "progress", role: "Halfway" });
  }
  seeded.push(a.id);
  console.log(`seeded ${a.catalogId}  ${w.title}`);
}
console.log("done");
// Sample works can be put out of sight later (reversibly) with one bulk archive:
// (Behind Cloudflare Access, send it with `cloudflared access curl` instead of curl.)
console.log(`\nTo archive these samples later:\n  curl -X POST ${BASE}/api/artworks/archive -H 'content-type: application/json' -d '${JSON.stringify({ ids: seeded })}'`);
