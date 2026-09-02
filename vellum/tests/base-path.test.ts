import { describe, expect, it } from "vitest";
import { applyBase, assetUrl, withBase, BASE_PATH } from "@/lib/client/base-path";

const BASE = "/vellum";

describe("applyBase", () => {
  it("prefixes a root-relative path", () => {
    expect(applyBase(BASE, "/api/documents")).toBe("/vellum/api/documents");
    expect(applyBase(BASE, "/dashboard")).toBe("/vellum/dashboard");
    expect(applyBase(BASE, "/api/images/file/abc.png")).toBe("/vellum/api/images/file/abc.png");
  });

  it("is idempotent — an already-prefixed path is untouched", () => {
    // Values can pass through more than one helper on the way to the DOM, so
    // double-prefixing has to be impossible rather than merely unlikely.
    expect(applyBase(BASE, "/vellum/api/documents")).toBe("/vellum/api/documents");
    expect(applyBase(BASE, "/vellum")).toBe("/vellum");
    expect(applyBase(applyBase(BASE, "/dashboard") as string, "/vellum/dashboard")).toBe(
      "/vellum/dashboard",
    );
  });

  it("does not treat a path that merely starts with the same letters as prefixed", () => {
    // "/vellumx" is not inside "/vellum".
    expect(applyBase(BASE, "/vellumx")).toBe("/vellum/vellumx");
  });

  it("leaves absolute and protocol-relative URLs alone", () => {
    expect(applyBase(BASE, "http://example.com/api")).toBe("http://example.com/api");
    expect(applyBase(BASE, "https://example.com/api")).toBe("https://example.com/api");
    expect(applyBase(BASE, "//cdn.example.com/x.png")).toBe("//cdn.example.com/x.png");
  });

  it("leaves data:, blob: and relative paths alone", () => {
    expect(applyBase(BASE, "data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(applyBase(BASE, "blob:http://localhost/abc")).toBe("blob:http://localhost/abc");
    expect(applyBase(BASE, "fonts/Inter.woff2")).toBe("fonts/Inter.woff2");
    expect(applyBase(BASE, "./x.png")).toBe("./x.png");
    expect(applyBase(BASE, "../x.png")).toBe("../x.png");
  });

  it("is the identity when the base is empty — the default build is unchanged", () => {
    for (const p of [
      "/api/documents",
      "/dashboard",
      "http://example.com",
      "data:image/png;base64,AA",
      "relative/x.png",
      "",
    ]) {
      expect(applyBase("", p)).toBe(p);
    }
  });
});

describe("withBase", () => {
  it("applies the build-time BASE_PATH", () => {
    // Unset in the test environment, so this must be the identity. If this ever
    // fails, the default (unprefixed) build has stopped being a no-op.
    expect(BASE_PATH).toBe("");
    expect(withBase("/api/documents")).toBe("/api/documents");
  });
});

describe("assetUrl", () => {
  it("returns an empty string for a missing url so callers need no guard", () => {
    expect(assetUrl(null)).toBe("");
    expect(assetUrl(undefined)).toBe("");
    expect(assetUrl("")).toBe("");
  });

  it("passes through data and blob URIs untouched", () => {
    expect(assetUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(assetUrl("blob:http://localhost/abc")).toBe("blob:http://localhost/abc");
  });

  it("passes a stored root-relative image url through unchanged with no base", () => {
    expect(assetUrl("/api/images/file/abc.png")).toBe("/api/images/file/abc.png");
  });
});
