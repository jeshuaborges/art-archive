import { describe, expect, it } from "vitest";
import { AJAX_HEADERS, classify, PROBE_GAP_MS, shouldProbe } from "../../src/session";

describe("classify", () => {
  it("treats a 401 (Access with X-Requested-With, or the Worker's own check) as signed out", () => {
    expect(classify({ kind: "response", status: 401 })).toBe("signed-out");
    expect(classify({ kind: "response", status: 401, type: "basic" })).toBe("signed-out");
  });
  it("treats a redirect caught with redirect: manual as signed out (Access's login page)", () => {
    expect(classify({ kind: "response", status: 0, type: "opaqueredirect" })).toBe("signed-out");
  });
  it("accepts any 2xx", () => {
    expect(classify({ kind: "response", status: 200, type: "basic" })).toBe("ok");
    expect(classify({ kind: "response", status: 201 })).toBe("ok");
    expect(classify({ kind: "response", status: 204 })).toBe("ok");
  });
  it("keeps other statuses as ordinary errors, including 403 (originals sent only as downloads)", () => {
    for (const status of [400, 403, 404, 409, 413, 422, 500, 502]) expect(classify({ kind: "response", status })).toBe("error");
  });
  it("tells offline apart from an unreachable server when there was no response", () => {
    expect(classify({ kind: "network", online: false })).toBe("offline");
    expect(classify({ kind: "network", online: true })).toBe("error");
  });
});

describe("AJAX_HEADERS", () => {
  it("asks Access for a 401 instead of a login redirect", () => {
    expect(AJAX_HEADERS).toEqual({ "X-Requested-With": "XMLHttpRequest" });
  });
});

describe("shouldProbe", () => {
  it("checks the first time", () => expect(shouldProbe(5_000, 0)).toBe(true));
  it("checks at most once a minute", () => {
    expect(shouldProbe(1_000_000 + PROBE_GAP_MS - 1, 1_000_000)).toBe(false);
    expect(shouldProbe(1_000_000 + PROBE_GAP_MS, 1_000_000)).toBe(true);
    expect(shouldProbe(1_000_000 + 10 * 60_000, 1_000_000)).toBe(true);
  });
  it("takes a custom gap", () => expect(shouldProbe(1_500, 1_000, 400)).toBe(true));
});
