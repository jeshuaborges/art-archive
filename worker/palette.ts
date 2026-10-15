/**
 * k-means on a small sample of RGB pixels; returns up to `k` dominant colours,
 * most common first, as #RRGGBB. Pure: shared by the phone (src/imageprep.ts)
 * and the server, which reads pixels from a tiny Cloudflare Images render.
 */
export function kmeansPalette(px: number[][], k = 5): string[] {
  if (!px.length) return [];
  const centers: number[][] = [];
  for (let i = 0; i < k; i++) centers.push(px[Math.floor(((i + 0.5) / k) * px.length)].slice());
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    assign = px.map((p) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = j; } });
      return best;
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sums.forEach((s, j) => { if (s[3]) centers[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = centers.map((_, j) => assign.filter((a) => a === j).length);
  const out: string[] = [];
  centers.map((c, j) => ({ c, n: counts[j] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).forEach(({ c }) => {
    if (out.some((h) => { const n = parseInt(h.slice(1), 16); return Math.abs(((n >> 16) & 255) - c[0]) + Math.abs(((n >> 8) & 255) - c[1]) + Math.abs((n & 255) - c[2]) < 36; })) return;
    out.push("#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase());
  });
  return out;
}
