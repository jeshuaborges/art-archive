import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` builds the app and serves everything through `wrangler dev` (local data).
// `npm run dev:ui` gives hot reload for UI work, proxying the API to that local wrangler.
// `npm run dev:prod` gives hot reload against the real archive: /api, /img and /mcp go to
// ARCHIVE_URL with the Access service token from .env.local. Reads only, unless
// ARCHIVE_ALLOW_WRITES=1, so iterating on the UI can't change the live archive by accident.

const PROXIED = ["/api", "/img", "/mcp"];
/** Request headers the real-data proxy never forwards: the caller's own login (cookies, Access JWT and identity). */
export const FORWARD_DROP = ["cookie", "cf-access-jwt-assertion", "cf-access-authenticated-user-email", "cf-access-token"];

/** Pure: should the real-data proxy let this request through? */
export function allowProdRequest(method: string | undefined, allowWrites: boolean): boolean {
  const m = (method || "GET").toUpperCase();
  return allowWrites || m === "GET" || m === "HEAD" || m === "OPTIONS";
}

function localProxy() {
  return Object.fromEntries(PROXIED.map((p) => [p, "http://localhost:8787"]));
}

function prodProxy(env: Record<string, string>) {
  const target = env.ARCHIVE_URL || "https://art-archive.irving-family.workers.dev";
  const id = env.CF_ACCESS_CLIENT_ID, secret = env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) throw new Error("dev:prod needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in .env.local (see README → Run it locally)");
  const allowWrites = env.ARCHIVE_ALLOW_WRITES === "1";
  const rule = {
    target, changeOrigin: true, secure: true,
    headers: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret, "X-Requested-With": "XMLHttpRequest" },
    // Through the tunnel the browser also sends its own Access login for archive-dev
    // (the CF_Authorization cookie and Cf-Access-* headers). Production's Access
    // checks that first and rejects it as another app's login, so drop it and
    // authenticate with the service token alone.
    // Production also answers with Set-Cookie: CF_Authorization for the service
    // token; passed on, it would overwrite the browser's own archive-dev login
    // cookie (same name) and sign it out. Never pass cookies back either.
    configure(proxy: { on(ev: string, fn: (msg: { removeHeader?(name: string): void; headers?: Record<string, unknown> }) => void): void }) {
      proxy.on("proxyReq", (req) => { for (const h of FORWARD_DROP) req.removeHeader?.(h); });
      proxy.on("proxyRes", (res) => { if (res.headers) delete res.headers["set-cookie"]; });
    },
    // Refuse writes before they leave the machine.
    bypass(req: { method?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(b: string): void }) {
      if (allowProdRequest(req.method, allowWrites)) return undefined;
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "dev:prod is read-only. Set ARCHIVE_ALLOW_WRITES=1 to change the live archive." }));
      return false;
    },
  };
  return Object.fromEntries(PROXIED.map((p) => [p, rule]));
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const prod = (process.env.ARCHIVE_TARGET || env.ARCHIVE_TARGET) === "prod";
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
    server: {
      port: prod ? 5174 : 5173,
      strictPort: true,
      // `npm run tunnel` serves this through a Cloudflare Tunnel on DEV_TUNNEL_HOST,
      // behind the same Access policy as the live app (see README).
      allowedHosts: [env.DEV_TUNNEL_HOST || "archive-dev.sashua.org"],
      proxy: prod ? prodProxy({ ...env, ...process.env } as Record<string, string>) : localProxy(),
    },
    test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
  } as never;
});
