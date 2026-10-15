/**
 * Identity comes from Cloudflare Access, which sits in front of the Worker and
 * handles login. The app builds no auth of its own: it only verifies the Access
 * JWT (so the Worker can't be reached around Access) and reads the email.
 *
 * Local dev (ALLOW_DEV_AUTH="true", set only in the `dev` environment) uses a
 * dev identity instead.
 */
export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_DEV_AUTH?: string;
}
export interface Identity { email: string; via: "access" | "dev" }

type Jwk = JsonWebKey & { kid?: string };
export type KeyFetcher = (teamDomain: string) => Promise<Jwk[]>;

let keyCache: { domain: string; keys: Jwk[]; at: number } | null = null;

export const fetchAccessKeys: KeyFetcher = async (teamDomain) => {
  if (keyCache && keyCache.domain === teamDomain && Date.now() - keyCache.at < 10 * 60_000) return keyCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  keyCache = { domain: teamDomain, keys: body.keys, at: Date.now() };
  return body.keys;
};

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function verifyAccessJwt(token: string, teamDomain: string, aud: string, fetchKeys: KeyFetcher = fetchAccessKeys, now = Date.now()): Promise<{ email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string }, payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { return null; }
  if (header.alg !== "RS256") return null;
  const keys = await fetchKeys(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const sec = Math.floor(now / 1000);
  if (typeof payload.exp !== "number" || payload.exp < sec) return null;
  if (typeof payload.nbf === "number" && payload.nbf > sec + 60) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return null;
  if (!payload.email) return null;
  return { email: payload.email };
}

export async function authenticate(req: Request, env: AuthEnv, fetchKeys: KeyFetcher = fetchAccessKeys): Promise<Identity | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = req.headers.get("Cf-Access-Jwt-Assertion") || readCookie(req.headers.get("Cookie"), "CF_Authorization");
    if (!token) return null;
    try {
      const r = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, fetchKeys);
      return r ? { email: r.email, via: "access" } : null;
    } catch (e) {
      console.warn("Access JWT verification failed", e);
      return null; // fail closed
    }
  }
  if (env.ALLOW_DEV_AUTH === "true") {
    const who = req.headers.get("X-Dev-User");
    return { email: who && /^[^@\s]+@[^@\s]+$/.test(who) ? who : "dev@localhost", via: "dev" };
  }
  return null;
}
