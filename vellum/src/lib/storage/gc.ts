/**
 * Asset garbage collection.
 *
 * Image files and custom themes are SHARED: duplicating a document copies the
 * slides JSON verbatim (embedding the same /api/images/file/<name> URLs) and
 * reuses the same customThemeId, without copying GeneratedImage rows. Three
 * writers also create files with no DB row at all — the upload route, the
 * settings image test, and brand-logo extraction.
 *
 * So "does this document own the file" is unanswerable. The only sound
 * question is "does anything still reference it", which is computed by
 * scanning every piece of live DB text. Anything unreferenced and old enough
 * to not be mid-write is collectable.
 */
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { imagesDir } from "./paths";

/** Mirrors the serving route's allowlist. */
const IMAGE_URL_RE = /\/api\/images\/file\/([A-Za-z0-9_-]+\.(?:png|jpe?g))/gi;
/** Only ever touch files that look like ones we generated. */
const FILENAME_RE = /^[A-Za-z0-9_-]+\.(png|jpe?g)$/i;
/** An image is written before its row records the path — don't race it. */
const DEFAULT_MIN_AGE_MS = 10 * 60 * 1000;

export interface GcSummary {
  themes: number;
  files: number;
  errors: string[];
}

function collectUrls(text: string | null | undefined, into: Set<string>) {
  if (!text) return;
  for (const match of text.matchAll(IMAGE_URL_RE)) into.add(match[1]);
}

/**
 * Every image filename still referenced by live data: slides content, custom
 * theme payloads (brand logos), settings (the saved brand kit), and the paths
 * recorded on surviving GeneratedImage rows.
 */
export async function collectLiveImageFiles(): Promise<Set<string>> {
  const live = new Set<string>();

  const documents = await db.document.findMany({ select: { slides: true } });
  for (const doc of documents) collectUrls(doc.slides, live);

  const themes = await db.customTheme.findMany({ select: { data: true } });
  for (const theme of themes) collectUrls(theme.data, live);

  const settings = await db.setting.findMany();
  for (const setting of settings) collectUrls(setting.value, live);

  const images = await db.generatedImage.findMany({
    where: { path: { not: null } },
    select: { path: true },
  });
  for (const image of images) {
    if (!image.path) continue;
    collectUrls(image.path, live);
    // `path` may be a bare filename rather than a URL.
    const base = path.basename(image.path);
    if (FILENAME_RE.test(base)) live.add(base);
  }

  return live;
}

/** Themes no document points at any more — including historical orphans. */
export async function gcOrphanThemes(): Promise<number> {
  const result = await db.customTheme.deleteMany({
    where: { documents: { none: {} } },
  });
  return result.count;
}

export async function gcOrphanImages(options?: {
  minAgeMs?: number;
  dryRun?: boolean;
}): Promise<{ deleted: string[]; errors: string[] }> {
  const minAgeMs = options?.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const live = await collectLiveImageFiles();
  const deleted: string[] = [];
  const errors: string[] = [];
  const dir = imagesDir();
  const now = Date.now();

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { deleted, errors: [`readdir ${dir}: ${String(error)}`] };
  }

  for (const entry of entries) {
    if (!FILENAME_RE.test(entry)) continue;
    if (live.has(entry)) continue;
    const full = path.join(dir, entry);
    try {
      if (now - statSync(full).mtimeMs < minAgeMs) continue;
      if (!options?.dryRun) unlinkSync(full);
      deleted.push(entry);
    } catch (error) {
      errors.push(`${entry}: ${String(error)}`);
    }
  }
  return { deleted, errors };
}

/**
 * Best-effort cleanup after a document is removed. Never throws: the row is
 * already gone, and a failed sweep is self-healing because the next run
 * recomputes the reference set from scratch.
 */
export async function gcAfterDocumentDelete(): Promise<GcSummary> {
  const summary: GcSummary = { themes: 0, files: 0, errors: [] };

  // Themes first: a theme orphaned by this delete must stop pinning its
  // brand logo before live files are collected.
  try {
    summary.themes = await gcOrphanThemes();
  } catch (error) {
    summary.errors.push(`themes: ${String(error)}`);
  }

  try {
    const { deleted, errors } = await gcOrphanImages();
    summary.files = deleted.length;
    summary.errors.push(...errors);
  } catch (error) {
    summary.errors.push(`images: ${String(error)}`);
  }

  return summary;
}
