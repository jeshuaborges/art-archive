import { describe, expect, it } from "vitest";
import { largeOriginalKey, refusedFormat, sniffImage } from "../../worker/store";

describe("large originals", () => {
  it("are stored where a one-request upload would put them, by their name's extension", () => {
    const sha = "a".repeat(64);
    expect(largeOriginalKey("1981-004", sha, "scan.TIFF")).toBe("artworks/1981-004/aaaaaaaaaaaaaaaa.tif");
    expect(largeOriginalKey("1981-004", sha, "photo.jpeg")).toBe("artworks/1981-004/aaaaaaaaaaaaaaaa.jpg");
  });
  it("refuse names that aren't images", () => {
    for (const n of ["notes.pdf", "page.html", "noext", "SP 014 Brownie.psd", "big.psb"]) expect(largeOriginalKey("x", "a".repeat(64), n)).toBeNull();
  });
});

describe("Photoshop files", () => {
  const head = (v: number) => new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, v, 0, 0, 0, 0, 0, 0]).buffer;
  it("are recognised by their bytes, PSD and the large-document PSB, so they can be refused by name", () => {
    expect(sniffImage(head(1))).toEqual({ type: "image/vnd.adobe.photoshop", ext: "psd" });
    expect(sniffImage(head(2))).toEqual({ type: "image/vnd.adobe.photoshop", ext: "psb" });
    expect(sniffImage(head(3))).toBeNull();
    expect(refusedFormat(sniffImage(head(1)))).toMatch(/Photoshop files aren't kept/);
    expect(refusedFormat({ ext: "psb" })).toMatch(/flattened TIFF/);
  });
  it("leave every picture format alone", () => {
    for (const type of ["image/jpeg", "image/tiff", "image/png", "image/heic", "image/webp"]) expect(refusedFormat({ type })).toBeNull();
    expect(refusedFormat(null)).toBeNull();
  });
});

describe("uploaded file names", () => {
  it("keep a quote that multipart encoding escaped, and nothing else", async () => {
    const { uploadedName } = await import("../../worker/store");
    expect(uploadedName('SP 06 La Comida Mexicana 30%22 wide.jpg')).toBe('SP 06 La Comida Mexicana 30" wide.jpg');
    expect(uploadedName("100% cotton%20rag.tif")).toBe("100% cotton%20rag.tif");
    expect(uploadedName("a%0Ab.jpg")).toBe("a b.jpg");
  });
});
