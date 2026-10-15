/**
 * Telling an expired sign-in apart from a lost connection (the functional core;
 * api.ts and App.tsx do the requests and show the result).
 *
 * The app sits behind Cloudflare Access. When the Access session has expired,
 * Access answers a sub-request that carries `X-Requested-With: XMLHttpRequest`
 * with a 401 instead of a 302 to its login page, which is what lets the app
 * notice it: https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#ajax
 * Without that header the request is redirected cross-origin and fetch throws a
 * TypeError that looks exactly like being offline. The Worker also answers 401
 * when no valid Access JWT reaches it (worker/index.ts).
 */

export type Outcome = "ok" | "signed-out" | "offline" | "error";

/** Sent on every API request so Access answers an expired session with 401. */
export const AJAX_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

/** What a request ended with: a response, or no response at all. */
export type Attempt =
  | { kind: "response"; status: number; type?: ResponseType }
  | { kind: "network"; online: boolean };

export function classify(a: Attempt): Outcome {
  if (a.kind === "network") return a.online ? "error" : "offline";
  // API requests use `redirect: "manual"`, and the API itself never redirects,
  // so a redirect can only be Access sending us to its login page.
  if (a.type === "opaqueredirect") return "signed-out";
  if (a.status === 401) return "signed-out";
  if (a.status >= 200 && a.status < 300) return "ok";
  return "error";
}

export const SIGNED_OUT_MESSAGE = "You've been signed out.";
export const UNREACHABLE_MESSAGE = "Can't reach the archive. Check the connection and try again.";

/** Minimum gap between sign-in checks when the app comes back to the foreground. */
export const PROBE_GAP_MS = 60_000;

/** Whether to check the session now, given when it was last checked (0 = never). */
export function shouldProbe(now: number, last: number, gap = PROBE_GAP_MS): boolean {
  return last === 0 || now - last >= gap;
}
