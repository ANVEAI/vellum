import type { NextConfig } from "next";

/**
 * Optional URL prefix, so Vellum can be reverse-proxied under a path on another
 * origin (e.g. https://host/vellum/* -> http://127.0.0.1:3210/vellum/*).
 *
 * Empty by default, and an empty value must leave the build byte-for-byte as it
 * was — hence the conditional spread rather than `basePath: ""`, which Next
 * treats as a distinct (and rejected) configuration.
 *
 * This is a BUILD-TIME value. It is inlined into the client bundle because of
 * the NEXT_PUBLIC_ prefix, which is what lets src/lib/client/base-path.ts read
 * the same variable in the browser. Changing it requires a rebuild, not just a
 * restart.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  /**
   * Loaded by Node from node_modules at runtime instead of being bundled into
   * the server build.
   *
   * pdf.js runs its worker in-process on the server and loads it with a
   * dynamic import of "./pdf.worker.mjs", marked webpackIgnore so bundlers
   * leave it alone: a runtime import resolved against the file the code sits
   * in. Installed, that file is pdfjs-dist/legacy/build/pdf.mjs and the
   * worker is beside it. Bundled into .next/server/chunks, the same relative
   * path names a file that does not exist, and every PDF import failed with
   * "Setting up fake worker failed: Cannot find module
   * '.next/server/chunks/pdf.worker.mjs'". Neither package is on Next's
   * built-in list of server externals. pdf-parse is what the import route
   * loads; pdfjs-dist is listed too, so importing it directly would not bring
   * the failure back.
   */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
