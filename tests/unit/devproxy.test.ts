import { describe, expect, it } from "vitest";
import { allowProdRequest } from "../../vite.config";

describe("dev:prod proxy", () => {
  it("lets reads through", () => {
    for (const m of ["GET", "get", "HEAD", "OPTIONS", undefined]) expect(allowProdRequest(m, false)).toBe(true);
  });
  it("refuses writes unless allowed", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(allowProdRequest(m, false)).toBe(false);
      expect(allowProdRequest(m, true)).toBe(true);
    }
  });
});
