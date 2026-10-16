/**
 * Server packages that must not be bundled.
 *
 * pdf.js loads its in-process worker with a runtime import of
 * "./pdf.worker.mjs", relative to its own file. Bundled into
 * .next/server/chunks that file is not there, and every PDF upload failed with
 * "Setting up fake worker failed: Cannot find module
 * '.next/server/chunks/pdf.worker.mjs'". The unit tests mock pdf-parse, so
 * only a production build showed it; this pins the configuration that keeps
 * it working. scripts/e2e-import.ts checks the real upload path.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config", () => {
  it("keeps pdf-parse and pdfjs-dist out of the server bundle", () => {
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(["pdf-parse", "pdfjs-dist"]),
    );
  });

  it("relies on workers that ship beside the code that loads them", () => {
    const root = path.resolve(__dirname, "../node_modules");
    expect(existsSync(path.join(root, "pdfjs-dist/legacy/build/pdf.worker.mjs"))).toBe(true);
    expect(existsSync(path.join(root, "pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs"))).toBe(true);
  });
});
