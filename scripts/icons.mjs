#!/usr/bin/env node
/**
 * Renders the app icons in public/ from public/icon.svg. Re-run after editing
 * the SVG and commit the results:
 *
 *   npm run icons
 *
 * - apple-touch-icon.png  180×180, opaque (iOS rounds the corners and turns
 *                         transparency black, so the background is flattened in)
 * - icon-192.png, icon-512.png       manifest icons
 * - icon-maskable-512.png            Android adaptive icon: the "art" group is
 *                                    scaled to 80% so it sits in the safe circle
 * - favicon.svg, favicon-32.png      browser tab, with rounded corners
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const BG = "#100F0E";
const icon = readFileSync(join(pub, "icon.svg"), "utf8");

// ---- pure: SVG variants of the source
const maskable = (svg) => {
  const out = svg.replace('<g id="art">', '<g id="art" transform="translate(512 512) scale(.8) translate(-512 -512)">');
  if (out === svg) throw new Error('icon.svg needs a <g id="art"> group for the maskable icon');
  return out;
};
const rounded = (svg) =>
  svg
    .replace("<defs>", '<defs>\n    <clipPath id="round"><rect width="1024" height="1024" rx="224"/></clipPath>')
    .replace(/(<\/defs>)([\s\S]*)(<\/svg>)/, '$1\n  <g clip-path="url(#round)">$2</g>\n$3');

// ---- shell: render and write
const png = (svg, size, file, { opaque = true } = {}) => {
  let img = sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil((72 * size) / 1024) * 2) }).resize(size, size);
  if (opaque) img = img.flatten({ background: BG });
  return img.png({ compressionLevel: 9 }).toFile(join(pub, file));
};

await png(icon, 180, "apple-touch-icon.png");
await png(icon, 192, "icon-192.png");
await png(icon, 512, "icon-512.png");
await png(maskable(icon), 512, "icon-maskable-512.png");
const fav = rounded(icon);
writeFileSync(join(pub, "favicon.svg"), fav);
await png(fav, 32, "favicon-32.png", { opaque: false });
console.log("icons written to public/");
