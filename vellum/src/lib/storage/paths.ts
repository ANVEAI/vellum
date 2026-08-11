/**
 * Canonical on-disk locations.
 *
 * Everything resolves through here so tests can redirect writes and the
 * garbage collector at a temp directory. Without the VELLUM_DATA_DIR override
 * a route test would sweep the developer's real image library.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

export function dataDir(): string {
  return process.env.VELLUM_DATA_DIR
    ? path.resolve(process.env.VELLUM_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

export function imagesDir(): string {
  const dir = path.join(dataDir(), "images");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportsDir(): string {
  const dir = path.join(dataDir(), "exports");
  mkdirSync(dir, { recursive: true });
  return dir;
}
