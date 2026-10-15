import { describe, expect, it } from "vitest";
import { authenticate, identityFromClaims, parseServiceTokenNames, verifyAccessJwt } from "../../worker/auth";

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
  return { kp, jwk };
}
async function sign(kp: CryptoKeyPair, payload: Record<string, unknown>, kid = "k1") {
  const h = enc({ alg: "RS256", kid, typ: "JWT" }), p = enc(payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
}

const TEAM = "family.cloudflareaccess.com", AUD = "aud-123";
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const now = Math.floor(Date.now() / 1000);

describe("Cloudflare Access JWT", async () => {
  const { kp, jwk } = await keypair();
  const keys = async () => [jwk];
  const good = { aud: [AUD], email: "anne@example.com", exp: now + 3600, iss: `https://${TEAM}` };

  it("accepts a valid token and returns the email", async () => {
    expect(await verifyAccessJwt(await sign(kp, good), TEAM, AUD, keys)).toEqual({ email: "anne@example.com" });
    const req = new Request("https://x/api/me", { headers: { "Cf-Access-Jwt-Assertion": await sign(kp, good) } });
    expect(await authenticate(req, env, keys)).toEqual({ actor: "anne@example.com", email: "anne@example.com", via: "access" });
  });
  // Service token JWT (Access docs, "Application token" → Service token authentication):
  // no email, `common_name` = the token's Client ID, `sub` = "".
  const service = { type: "app", aud: [AUD], exp: now + 3600, iss: `https://${TEAM}`, common_name: "abc123.access", sub: "" };
  it("accepts a service token and attributes it to service:<client id>", async () => {
    expect(await verifyAccessJwt(await sign(kp, service), TEAM, AUD, keys)).toEqual({ commonName: "abc123.access" });
    const req = new Request("https://x/api/artworks", { headers: { "Cf-Access-Jwt-Assertion": await sign(kp, service) } });
    expect(await authenticate(req, env, keys)).toEqual({ actor: "service:abc123.access", email: null, via: "service" });
  });
  it("uses a friendly service token name from SERVICE_TOKEN_NAMES", async () => {
    const req = new Request("https://x/api/artworks", { headers: { "Cf-Access-Jwt-Assertion": await sign(kp, service) } });
    expect((await authenticate(req, { ...env, SERVICE_TOKEN_NAMES: '{"abc123.access":"importer"}' }, keys))?.actor).toBe("service:importer");
    expect((await authenticate(req, { ...env, SERVICE_TOKEN_NAMES: "not json" }, keys))?.actor).toBe("service:abc123.access");
  });
  it("refuses a token with neither email nor common_name, and a service token for another audience", async () => {
    const { common_name: _, ...anonymous } = service;
    expect(await verifyAccessJwt(await sign(kp, anonymous), TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, { ...service, common_name: "" }), TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, { ...service, common_name: 42 }), TEAM, AUD, keys)).toBeNull();
    expect(await authenticate(new Request("https://x/", { headers: { "Cf-Access-Jwt-Assertion": await sign(kp, anonymous) } }), env, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, { ...service, aud: ["other"] }), TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, { ...service, exp: now - 10 }), TEAM, AUD, keys)).toBeNull();
  });
  it("accepts the CF_Authorization cookie", async () => {
    const req = new Request("https://x/", { headers: { Cookie: `a=b; CF_Authorization=${await sign(kp, good)}` } });
    expect((await authenticate(req, env, keys))?.email).toBe("anne@example.com");
  });
  it("rejects wrong audience, expired, wrong issuer, unknown key, tampered and malformed tokens", async () => {
    expect(await verifyAccessJwt(await sign(kp, { ...good, aud: ["other"] }), TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, { ...good, exp: now - 10 }), TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, { ...good, iss: "https://evil.example" }), TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt(await sign(kp, good, "k2"), TEAM, AUD, keys)).toBeNull();
    const t = await sign(kp, good);
    const [h, , s] = t.split(".");
    expect(await verifyAccessJwt(`${h}.${enc({ ...good, email: "mallory@example.com" })}.${s}`, TEAM, AUD, keys)).toBeNull();
    expect(await verifyAccessJwt("not.a.jwt", TEAM, AUD, keys)).toBeNull();
  });
  it("fails closed when Access is configured but no token or certs are available", async () => {
    expect(await authenticate(new Request("https://x/"), env, keys)).toBeNull();
    const broken = async () => { throw new Error("network"); };
    const req = new Request("https://x/", { headers: { "Cf-Access-Jwt-Assertion": await sign(kp, good) } });
    expect(await authenticate(req, env, broken)).toBeNull();
  });
  it("only allows the dev identity when explicitly enabled and Access isn't configured", async () => {
    expect(await authenticate(new Request("https://x/"), {})).toBeNull();
    expect(await authenticate(new Request("https://x/"), { ALLOW_DEV_AUTH: "true" })).toEqual({ actor: "dev@localhost", email: "dev@localhost", via: "dev" });
    expect(await authenticate(new Request("https://x/"), { ...env, ALLOW_DEV_AUTH: "true" }, keys)).toBeNull();
  });
});

describe("identity from Access claims (pure)", () => {
  it("prefers the email, then the service token, else refuses", () => {
    expect(identityFromClaims({ email: "anne@example.com" })).toEqual({ actor: "anne@example.com", email: "anne@example.com", via: "access" });
    expect(identityFromClaims({ email: "anne@example.com", commonName: "abc.access" })?.via).toBe("access");
    expect(identityFromClaims({ commonName: "abc.access" })).toEqual({ actor: "service:abc.access", email: null, via: "service" });
    expect(identityFromClaims({ commonName: "abc.access" }, { "abc.access": "importer" })?.actor).toBe("service:importer");
    expect(identityFromClaims({})).toBeNull();
    expect(identityFromClaims(null)).toBeNull();
  });
  it("parses SERVICE_TOKEN_NAMES, dropping anything malformed", () => {
    expect(parseServiceTokenNames(undefined)).toEqual({});
    expect(parseServiceTokenNames("")).toEqual({});
    expect(parseServiceTokenNames("[1]")).toEqual({});
    expect(parseServiceTokenNames("{oops")).toEqual({});
    expect(parseServiceTokenNames('{"a.access":"importer","b.access":42,"c.access":"has space","d.access":""}')).toEqual({ "a.access": "importer" });
  });
});
