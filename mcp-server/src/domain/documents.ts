/**
 * Document lifecycle: read, edit, repair, duplicate, delete.
 *
 * Includes `repair`, which exists because Vellum has several degraded states
 * that nothing else clears and that are invisible from the UI:
 *   - a failed outline strands the document at `status:"outlining"` forever
 *   - an interrupted generation persists a TRUNCATED deck marked `"ready"`
 *   - failed image jobs never surface as errors
 *   - a hung QA pass leaves the document at `"reviewing"`
 */
import * as api from "../vellum/endpoints/index.js";
import type { VellumClient } from "../vellum/client.js";
import type { AssetsResponse, DocumentDetail } from "../vellum/types.js";
import { invalidInput, notFound } from "../infra/errors.js";
import type { Logger } from "../infra/logger.js";
import {
  assetFailures,
  countOutlineCards,
  digestSlides,
  isQualityComplete,
  isTruncated,
  parseQuality,
  parseSlides,
  projectList,
  projectQuality,
  summarize,
  summarizeAssets,
  type DigestOptions,
  type DocumentView,
} from "./projection.js";

export interface RepairFinding {
  code: string;
  severity: "major" | "minor";
  detail: string;
  remedy: string;
}

export type RepairAction = "retry_failed_images" | "reset_stuck_status" | "rerun_quality";

export class DocumentService {
  constructor(
    private readonly client: VellumClient,
    private readonly log: Logger,
  ) {}

  async list(
    filter: {
      status?: string[];
      kind?: "deck" | "doc";
      titleContains?: string;
      updatedWithinHours?: number;
      limit?: number;
    },
    signal: AbortSignal,
  ) {
    const all = await api.listDocuments(this.client, signal);
    let rows = all;

    if (filter.status?.length) rows = rows.filter((d) => filter.status!.includes(d.status));
    if (filter.kind) rows = rows.filter((d) => d.kind === filter.kind);
    if (filter.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      rows = rows.filter((d) => d.title.toLowerCase().includes(needle));
    }
    if (filter.updatedWithinHours) {
      const cutoff = Date.now() - filter.updatedWithinHours * 3_600_000;
      rows = rows.filter((d) => Number(d.updatedAt) >= cutoff);
    }

    const total = rows.length;
    const limit = filter.limit ?? 20;
    return {
      documents: projectList(rows.slice(0, limit)),
      total,
      truncated: total > limit,
    };
  }

  /**
   * Read one document through a projection.
   *
   * There is deliberately no "give me everything" mode short of `raw_xml`:
   * the full row is median 30 KB and `rawXml` alone is 5-20 KB of LLM debug
   * output that no agent decision depends on.
   */
  async get(
    documentId: string,
    view: DocumentView,
    opts: DigestOptions & { includeMinorIssues?: boolean },
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    // The projected views are heterogeneous by design (the `view` is the
    // discriminant), so they are returned through an index-signature type
    // rather than a union the caller would have to narrow.
    const doc = await this.mustGet(documentId, signal);

    // Assets are only fetched for the views that need them — the call has a
    // side effect (it kicks Vellum's image queue), so it is not free.
    let assets: AssetsResponse | undefined;
    if (view === "summary" || view === "assets") {
      assets = await api.getAssets(this.client, documentId, signal).catch(() => undefined);
    }

    const base: Record<string, unknown> = { ...summarize(doc, assets) };

    switch (view) {
      case "summary":
        return base;

      case "outline":
        return { ...base, outline: doc.outline ?? "" };

      case "slides":
        return { ...base, slides: digestSlides(parseSlides(doc.slides), opts) };

      case "quality":
        return {
          ...base,
          qualityReport: projectQuality(
            parseQuality(doc.qualityReport),
            parseSlides(doc.slides),
            opts.includeMinorIssues ?? false,
          ),
        };

      case "assets":
        return {
          ...base,
          assets: {
            ...(assets ? summarizeAssets(assets) : { total: 0, done: 0, pending: 0, failed: 0 }),
            failures: assets ? assetFailures(assets) : [],
          },
        };

      case "raw_xml":
        return {
          ...base,
          rawXml: doc.rawXml ?? "",
          note:
            "rawXml is Vellum's raw LLM output, kept for debugging. It is large and " +
            "no agent decision should depend on it.",
        };

      default:
        throw invalidInput(`Unknown view "${String(view)}".`);
    }
  }

  /** Replace the outline. The `## ` heading count IS the slide-count contract. */
  async setOutline(
    documentId: string,
    outline: { title?: string; markdown?: string; cards?: { heading: string; bullets?: string[] }[] },
    signal: AbortSignal,
  ) {
    const doc = await this.mustGet(documentId, signal);

    let markdown: string;
    if (outline.markdown) {
      markdown = outline.markdown;
    } else if (outline.cards?.length) {
      const title = outline.title ?? doc.title;
      markdown = [
        `# ${title}`,
        "",
        ...outline.cards.flatMap((c) => [
          `## ${c.heading}`,
          ...(c.bullets ?? []).map((b) => `- ${b}`),
          "",
        ]),
      ].join("\n");
    } else {
      throw invalidInput("Provide either `cards` or `markdown`.");
    }

    const cardCount = countOutlineCards(markdown);
    if (cardCount === 0) {
      throw invalidInput(
        "The outline contains no '## ' headings. Vellum counts those to decide how many " +
          "slides to generate, so this outline would produce an empty deck. Use the `cards` " +
          "array to guarantee the right format.",
      );
    }
    if (cardCount > 30) {
      throw invalidInput(`The outline has ${cardCount} sections; Vellum's maximum is 30.`);
    }

    await api.patchDocument(
      this.client,
      documentId,
      { outline: markdown, ...(outline.title ? { title: outline.title } : {}) },
      signal,
    );

    return { documentId, title: outline.title ?? doc.title, cardCount, outline: markdown };
  }

  /** Metadata only. Content changes go through the generation tools. */
  async updateMeta(
    documentId: string,
    patch: { title?: string; themeName?: string },
    signal: AbortSignal,
  ) {
    if (patch.title === undefined && patch.themeName === undefined) {
      throw invalidInput("Provide at least one of title or themeName.");
    }
    const updated = await api.patchDocument(
      this.client,
      documentId,
      {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.themeName !== undefined ? { themeName: patch.themeName } : {}),
      },
      signal,
    );
    return {
      documentId: updated.id,
      title: updated.title,
      themeName: updated.themeName,
      status: updated.status,
    };
  }

  async duplicate(documentId: string, signal: AbortSignal) {
    const copy = await api.duplicateDocument(this.client, documentId, signal);
    return {
      documentId: copy.id,
      sourceDocumentId: documentId,
      title: copy.title,
      status: copy.status,
      slideCount: parseSlides(copy.slides).length,
      warnings: [
        "Vellum's duplicate does not copy the quality report or the image job records, " +
          "so the copy shows no score and zero image jobs even though its slides keep " +
          "their existing image URLs.",
      ],
    };
  }

  /** 404 is treated as success so a destructive tool stays safely retryable. */
  async delete(documentId: string, confirmTitle: string | undefined, signal: AbortSignal) {
    let title: string | undefined;
    try {
      const doc = await api.getDocument(this.client, documentId, signal);
      title = doc.title;
      if (confirmTitle !== undefined && confirmTitle !== doc.title) {
        throw invalidInput(
          `confirmTitle "${confirmTitle}" does not match this document's title "${doc.title}". ` +
            `Nothing was deleted.`,
        );
      }
    } catch (err) {
      if ((err as { kind?: string }).kind === "not_found") {
        return { documentId, deleted: true, alreadyDeleted: true };
      }
      throw err;
    }

    await api.deleteDocument(this.client, documentId, signal);
    return { documentId, deleted: true, alreadyDeleted: false, title };
  }

  /* ---------------------------------------------------------------------- */
  /* Repair                                                                  */
  /* ---------------------------------------------------------------------- */

  async repair(
    documentId: string,
    actions: RepairAction[] | undefined,
    staleAfterSeconds: number,
    signal: AbortSignal,
  ) {
    const doc = await this.mustGet(documentId, signal);
    const assets = await api.getAssets(this.client, documentId, signal).catch(() => undefined);
    const slides = parseSlides(doc.slides);
    const cardCount = countOutlineCards(doc.outline);
    const report = parseQuality(doc.qualityReport);
    const images = assets
      ? summarizeAssets(assets)
      : { total: 0, done: 0, pending: 0, failed: 0 };

    const staleMs = staleAfterSeconds * 1000;
    const age = Date.now() - Number(doc.updatedAt);
    const findings: RepairFinding[] = [];

    if (doc.status === "outlining" && age > staleMs) {
      findings.push({
        code: "stuck_outlining",
        severity: "major",
        detail:
          `Stuck at "outlining" for ${Math.round(age / 1000)}s. Vellum's outline route has ` +
          `no error handling, so a failure there strands the document permanently.`,
        remedy: "reset_stuck_status",
      });
    }
    if (doc.status === "generating" && age > staleMs) {
      findings.push({
        code: "stuck_generating",
        severity: "major",
        detail: `Stuck at "generating" for ${Math.round(age / 1000)}s.`,
        remedy: "reset_stuck_status",
      });
    }
    if (doc.status === "reviewing" && age > staleMs) {
      findings.push({
        code: "stuck_reviewing",
        severity: "minor",
        detail:
          `Stuck at "reviewing" for ${Math.round(age / 1000)}s — the QA pass is best-effort ` +
          `and can hang. The document content itself is fine.`,
        remedy: "reset_stuck_status",
      });
    }
    if (isTruncated(slides.length, cardCount)) {
      findings.push({
        code: "truncated_deck",
        severity: "major",
        detail:
          `${slides.length} slides against an outline of ${cardCount}. The generation was cut ` +
          `short, and Vellum marks such decks "ready" with no warning.`,
        remedy: "vellum.generate_slides_from_outline",
      });
    }
    if (images.failed > 0) {
      findings.push({
        code: "failed_images",
        severity: "minor",
        detail: `${images.failed} image job(s) failed. Failed images never fail a generation.`,
        remedy: "retry_failed_images",
      });
    }
    if (doc.status === "ready" && report && !isQualityComplete(report)) {
      findings.push({
        code: "no_quality_report",
        severity: "minor",
        detail: "The quality report has no score — the critique did not finish.",
        remedy: "rerun_quality",
      });
    }
    if (doc.status === "error") {
      findings.push({
        code: "document_error",
        severity: "major",
        detail: doc.errorMessage ?? "The document is in an error state.",
        remedy: "vellum.generate_slides_from_outline",
      });
    }
    if (slides.length === 0) {
      findings.push({
        code: "empty_document",
        severity: "major",
        detail: "No slides. Any export will fail.",
        remedy: "vellum.generate_slides_from_outline",
      });
    }

    // Diagnosis only unless the caller explicitly asked to act.
    const actionsTaken: { action: string; result: string; detail?: string }[] = [];
    for (const action of actions ?? []) {
      try {
        if (action === "retry_failed_images") {
          const { retried } = await api.retryFailedImages(this.client, documentId, signal);
          actionsTaken.push({ action, result: "ok", detail: `${retried} job(s) re-queued` });
        } else if (action === "rerun_quality") {
          const r = await api.startQualityCheck(this.client, documentId, signal);
          actionsTaken.push({
            action,
            result: r.started ? "ok" : "skipped",
            detail: r.reason ?? "started",
          });
        } else if (action === "reset_stuck_status") {
          if (age <= staleMs) {
            actionsTaken.push({
              action,
              result: "skipped",
              detail:
                "The document was updated recently, so a generation may genuinely be running. " +
                "Refusing to stomp it.",
            });
          } else {
            // "reviewing" is not an accepted PATCH *target*, but a document
            // currently in it can be moved to "ready" — which is the rescue.
            const target = doc.status === "reviewing" ? "ready" : "draft";
            await api.patchDocument(this.client, documentId, { status: target }, signal);
            actionsTaken.push({ action, result: "ok", detail: `status -> ${target}` });
          }
        }
      } catch (err) {
        actionsTaken.push({
          action,
          result: "failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      documentId,
      status: doc.status,
      cardCount,
      slideCount: slides.length,
      images,
      findings,
      actionsTaken,
      healthy: findings.filter((f) => f.severity === "major").length === 0,
    };
  }

  private async mustGet(documentId: string, signal: AbortSignal): Promise<DocumentDetail> {
    try {
      return await api.getDocument(this.client, documentId, signal);
    } catch (err) {
      if ((err as { kind?: string }).kind === "not_found") throw notFound("Document", documentId);
      throw err;
    }
  }
}
