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
};

export default nextConfig;
