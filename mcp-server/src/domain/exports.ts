/**
 * Export delivery.
 *
 * A real PPTX from this library measured 23 MB. Base64 in a tool result would
 * be ~31 MB of tokens, so bytes NEVER go inline: the file is written to a
 * configured directory and the tool returns a path plus metadata.
 *
 * ## Naming, and the mistake we are not repeating
 *
 * Vellum used to write a server-side copy of every export and deleted the
 * feature. Its own comment (export/[format]/[id]/route.ts:81-84) records why:
 * the file was "keyed by title, so it collided across documents, became
 * unmappable after a rename, was never read back by anything, and had grown to
 * hundreds of megabytes."
 *
 * So: files are keyed on `{documentId}-{format}-{sha256[0..8]}.{ext}` — never
 * the title — the human title is returned as display metadata only, and the
 * store enforces a TTL and a total-size cap with LRU eviction.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as api from "../vellum/endpoints/index.js";
import type { VellumClient } from "../vellum/client.js";
import type { ExportFormat } from "../vellum/types.js";
import { EXPORT_MIME } from "../vellum/types.js";
import { invalidInput, preconditionFailed } from "../infra/errors.js";
import type { Logger } from "../infra/logger.js";
import type { GenerationMutex } from "./mutex.js";
import { parseSlides } from "./projection.js";

export interface ArtifactResult {
  documentId: string;
  format: ExportFormat;
  path: string;
  filename: string;
  /** Vellum's human-facing filename, for display only. */
  suggestedFilename: string | null;
  mimeType: string;
  bytes: number;
  sha256: string;
  slideCount: number;
}

export interface ExportServiceOptions {
  exportDir: string;
  timeoutMs: number;
  ttlMs: number;
  maxBytes: number;
}

export class ExportService {
  constructor(
    private readonly client: VellumClient,
    private readonly mutex: GenerationMutex,
    private readonly log: Logger,
    private readonly opts: ExportServiceOptions,
  ) {}

  async export(
    documentId: string,
    format: ExportFormat,
    signal: AbortSignal,
  ): Promise<ArtifactResult> {
    // Pre-flight rather than burning a 300s Playwright run on an empty deck.
    // Vellum answers 409 for this, but locally we can answer instantly.
    const doc = await api.getDocument(this.client, documentId, signal);
    const slides = parseSlides(doc.slides);
    if (slides.length === 0) {
      throw preconditionFailed(
        "This document has no slides yet, so there is nothing to export. " +
          "Generate content first with vellum.generate_slides_from_outline.",
        { documentId, slideCount: 0 },
      );
    }

    await mkdir(this.opts.exportDir, { recursive: true });

    // Exports spawn headless Chromium. Serialize them so two concurrent
    // exports do not fight over the browser or the GPU.
    const release = await this.mutex.acquire(`export:${documentId}:${format}`, signal);
    let tmpPath: string;
    let bytes = 0;
    const hash = createHash("sha256");

    try {
      const { body, filename } = await api.exportDocument(
        this.client,
        format,
        documentId,
        signal,
        this.opts.timeoutMs,
      );

      tmpPath = path.join(this.opts.exportDir, `.tmp-${documentId}-${Date.now()}.${format}`);
      const out = createWriteStream(tmpPath);
      const source = Readable.fromWeb(body as never);
      source.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        hash.update(chunk);
      });
      await pipeline(source, out);

      const digest = hash.digest("hex");
      const finalName = `${documentId}-${format}-${digest.slice(0, 8)}.${format}`;
      const finalPath = path.join(this.opts.exportDir, finalName);
      await rm(finalPath, { force: true });
      const { rename } = await import("node:fs/promises");
      await rename(tmpPath, finalPath);

      this.log.info("export written", { documentId, format, bytes });
      void this.sweep().catch(() => undefined);

      return {
        documentId,
        format,
        path: finalPath,
        filename: finalName,
        suggestedFilename: filename,
        mimeType: EXPORT_MIME[format],
        bytes,
        sha256: digest,
        slideCount: slides.length,
      };
    } finally {
      release();
    }
  }

  /** Enforce TTL first, then the size cap by least-recently-modified. */
  private async sweep(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.opts.exportDir);
    } catch {
      return;
    }

    const now = Date.now();
    const files: { path: string; mtimeMs: number; size: number }[] = [];

    for (const name of entries) {
      const full = path.join(this.opts.exportDir, name);
      try {
        const s = await stat(full);
        if (!s.isFile()) continue;
        if (now - s.mtimeMs > this.opts.ttlMs) {
          await rm(full, { force: true });
          continue;
        }
        files.push({ path: full, mtimeMs: s.mtimeMs, size: s.size });
      } catch {
        /* raced with another sweep */
      }
    }

    let total = files.reduce((n, f) => n + f.size, 0);
    if (total <= this.opts.maxBytes) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    for (const f of files) {
      if (total <= this.opts.maxBytes) break;
      await rm(f.path, { force: true }).catch(() => undefined);
      total -= f.size;
      this.log.debug("evicted export artifact", { path: f.path });
    }
  }
}

export function assertFormat(value: string): ExportFormat {
  if (value === "pdf" || value === "pptx" || value === "docx") return value;
  throw invalidInput(`format must be one of pdf, pptx, docx — got "${value}".`);
}
