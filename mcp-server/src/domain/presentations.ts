/**
 * The generation pipeline: prompt -> document -> outline -> slides -> images.
 *
 * This is the file that turns four HTTP calls, two SSE streams and two polling
 * loops into one capability. Everything subtle about Vellum lives here.
 */
import * as api from "../vellum/endpoints/index.js";
import { SseSession } from "../vellum/sse.js";
import type { VellumClient } from "../vellum/client.js";
import type { DocumentDetail, GenParams, VellumSseEvent } from "../vellum/types.js";
import type { Logger } from "../infra/logger.js";
import { generationFailed, preconditionFailed, VellumMcpError } from "../infra/errors.js";
import { sleep } from "../infra/retry.js";
import type { GenerationMutex } from "./mutex.js";
import {
  countOutlineCards,
  isQualityComplete,
  isTruncated,
  parseQuality,
  parseSlides,
  summarizeAssets,
} from "./projection.js";

/**
 * Vellum schedules its QA critique 500ms AFTER emitting `complete`
 * (content/route.ts:396-400). That critique is another Ollama call, so we hold
 * our lane briefly past completion rather than letting the next generation
 * start straight into contention.
 */
const SETTLE_MS = 750;
/** Vellum heartbeats every 5s; prolonged silence means a dead socket. */
const SSE_IDLE_TIMEOUT_MS = 45_000;
const ASSET_POLL_MS = 2_000;
const QUALITY_POLL_MS = 3_000;

export interface GenerateInput {
  prompt: string;
  kind?: "deck" | "doc";
  templateId?: string;
  useBrandTheme?: boolean;
  genParams?: GenParams;
  /** Grounds generation and disables web research. */
  sourceText?: string;
  /** Stop once the outline exists so it can be reviewed and edited. */
  stopAfterOutline?: boolean;
  waitForImagesMs?: number;
  waitForQualityMs?: number;
}

export interface GenerateResult {
  documentId: string;
  phase: "outline" | "complete" | "failed";
  title: string;
  kind: string;
  cardCount: number;
  outline?: string;
  slideCount?: number;
  /** True when the run was cut short — slideCount < cardCount. */
  truncated?: boolean;
  images?: { total: number; done: number; pending: number; failed: number };
  quality?: { score: number | null; complete: boolean } | null;
  warnings: string[];
  elapsedSeconds: number;
  nextSteps: string[];
  errorMessage?: string;
}

export interface ProgressSink {
  status?(message: string): void;
  progress?(current: number, total: number): void;
  /** Called the moment the document row exists, so the caller gets a durable handle early. */
  documentCreated?(documentId: string): void;
}

export class PresentationService {
  constructor(
    private readonly client: VellumClient,
    private readonly mutex: GenerationMutex,
    private readonly log: Logger,
  ) {}

  /* ---------------------------------------------------------------------- */

  async generate(
    input: GenerateInput,
    signal: AbortSignal,
    sink: ProgressSink = {},
  ): Promise<GenerateResult> {
    const startedAt = Date.now();
    const warnings: string[] = [];

    // 1. Create the row. documentId exists from here on, so even a later
    //    failure leaves the agent a durable handle.
    const created = await api.createDocument(
      this.client,
      {
        kind: input.kind ?? "deck",
        prompt: input.prompt,
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.useBrandTheme !== undefined ? { useBrandTheme: input.useBrandTheme } : {}),
        ...(input.genParams ? { genParams: input.genParams } : {}),
      },
      signal,
    );
    const documentId = created.id;
    const log = this.log.child({ documentId });
    log.info("document created", { kind: created.kind });
    // Surface the handle immediately: even if everything after this fails, the
    // agent can still find and repair the document.
    sink.documentCreated?.(documentId);

    // 2. Grounding source, if supplied. Setting researchContext is a hard
    //    override: outline/route.ts:60-61 skips web research when it is set.
    if (input.sourceText?.trim()) {
      await api.patchDocument(this.client, documentId, { researchContext: input.sourceText }, signal);
    }

    // 3. Outline. Serialized because it hits Ollama, even though Vellum's lock
    //    does not cover this route.
    const outlineDoc = await this.runOutline(documentId, signal, sink, warnings, log);
    const cardCount = countOutlineCards(outlineDoc.outline);

    if (cardCount === 0) {
      return {
        documentId,
        phase: "failed",
        title: outlineDoc.title,
        kind: outlineDoc.kind,
        cardCount: 0,
        warnings,
        elapsedSeconds: elapsed(startedAt),
        errorMessage:
          "The outline stage produced no sections. Vellum counts '## ' headings, " +
          "so content generation would have nothing to work from.",
        nextSteps: ["vellum.generate_outline", "vellum.set_outline"],
      };
    }

    if (input.stopAfterOutline) {
      return {
        documentId,
        phase: "outline",
        title: outlineDoc.title,
        kind: outlineDoc.kind,
        cardCount,
        outline: outlineDoc.outline ?? "",
        warnings,
        elapsedSeconds: elapsed(startedAt),
        nextSteps: ["vellum.set_outline", "vellum.generate_slides_from_outline"],
      };
    }

    // 4. Content + waits.
    return this.runContent(
      documentId,
      { cardCount, startedAt, warnings, ...input },
      signal,
      sink,
      log,
    );
  }

  /* ---------------------------------------------------------------------- */

  /** Stage 1. Compensates the stranded-"outlining" state Vellum cannot clear itself. */
  private async runOutline(
    documentId: string,
    signal: AbortSignal,
    sink: ProgressSink,
    warnings: string[],
    log: Logger,
  ): Promise<DocumentDetail> {
    const release = await this.mutex.acquire(`outline:${documentId}`, signal);
    const controller = linkedController(signal);
    try {
      const body = await api.streamOutline(this.client, documentId, controller.signal);
      const session = new SseSession(body, {
        controller,
        idleTimeoutMs: SSE_IDLE_TIMEOUT_MS,
      });

      try {
        for await (const event of session.events()) {
          forwardProgress(event, sink);
        }
      } catch (err) {
        await this.compensateStrandedOutline(documentId, log);
        throw err;
      }

      if (session.errorDetail) {
        await this.compensateStrandedOutline(documentId, log);
        throw generationFailed(session.errorDetail, { documentId, stage: "outline" });
      }
      if (session.outcome?.sawTerminal === null) {
        await this.compensateStrandedOutline(documentId, log);
        throw generationFailed(
          "Vellum ended the outline stream without completing — it aborted or crashed.",
          { documentId, stage: "outline" },
        );
      }

      return await api.getDocument(this.client, documentId, signal);
    } finally {
      release();
    }
  }

  /**
   * `outline/route.ts` has no try/catch: a failure there leaves the document at
   * `status:"outlining"` forever, and nothing in Vellum sweeps it. Since we set
   * it in motion, we clean it up.
   */
  private async compensateStrandedOutline(documentId: string, log: Logger): Promise<void> {
    try {
      await api.patchDocument(this.client, documentId, { status: "draft" });
      log.info("reset stranded outlining status to draft");
    } catch (err) {
      log.warn("could not reset stranded outlining status", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* ---------------------------------------------------------------------- */

  /** Stage 2 plus the asset and quality waits. */
  async runContent(
    documentId: string,
    ctx: {
      cardCount: number;
      startedAt: number;
      warnings: string[];
      waitForImagesMs?: number;
      waitForQualityMs?: number;
    },
    signal: AbortSignal,
    sink: ProgressSink,
    log: Logger,
  ): Promise<GenerateResult> {
    const { warnings } = ctx;
    const release = await this.mutex.acquire(`content:${documentId}`, signal);
    const controller = linkedController(signal);
    let generationError: string | null = null;

    try {
      const body = await api.streamContent(this.client, documentId, controller.signal);
      const session = new SseSession(body, {
        controller,
        idleTimeoutMs: SSE_IDLE_TIMEOUT_MS,
      });

      for await (const event of session.events()) {
        forwardProgress(event, sink);
      }

      if (session.errorDetail) generationError = session.errorDetail;
      else if (session.outcome?.sawTerminal === null) {
        generationError =
          "Vellum ended the content stream without completing — it aborted or crashed. " +
          "Note that Vellum persists partial output and marks it 'ready', so the deck may be incomplete.";
      }

      log.debug("content stream retired", {
        reason: session.outcome?.reason,
        aborted: session.outcome?.aborted,
        drainCompleted: session.outcome?.drainCompleted,
      });
      if (session.outcome && !session.outcome.drainCompleted) {
        warnings.push(
          "The generation stream could not be drained cleanly after abort; " +
            "Vellum's generation lock may still be held.",
        );
      }
    } finally {
      // Hold the lane briefly: Vellum's QA critique is another Ollama call
      // scheduled 500ms after `complete`.
      await sleep(SETTLE_MS).catch(() => undefined);
      release();
    }

    // --- waits -------------------------------------------------------------
    const images = await this.waitForImages(
      documentId,
      ctx.waitForImagesMs ?? 120_000,
      signal,
      warnings,
    );
    const finalDoc = await this.waitForQuality(
      documentId,
      ctx.waitForQualityMs ?? 90_000,
      signal,
      warnings,
    );

    const slides = parseSlides(finalDoc.slides);
    const cardCount = ctx.cardCount || countOutlineCards(finalDoc.outline);
    const truncated = isTruncated(slides.length, cardCount);
    const report = parseQuality(finalDoc.qualityReport);

    if (truncated) {
      warnings.push(
        `The deck has ${slides.length} slides but the outline promised ${cardCount}. ` +
          `The generation was cut short. Re-run vellum.generate_slides_from_outline to replace it in place.`,
      );
    }
    if (images.failed > 0) {
      warnings.push(
        `${images.failed} image job(s) failed. The deck is still usable; ` +
          `call vellum.retry_failed_images to try again.`,
      );
    }

    return {
      documentId,
      phase: generationError ? "failed" : "complete",
      title: finalDoc.title,
      kind: finalDoc.kind,
      cardCount,
      slideCount: slides.length,
      truncated,
      images,
      quality: report ? { score: report.score, complete: isQualityComplete(report) } : null,
      warnings,
      elapsedSeconds: elapsed(ctx.startedAt),
      ...(generationError ? { errorMessage: generationError } : {}),
      nextSteps: generationError
        ? ["vellum.get_document", "vellum.generate_slides_from_outline"]
        : ["vellum.export_document", "vellum.get_document"],
    };
  }

  /* ---------------------------------------------------------------------- */

  /** Poll until no image job is pending, or the budget expires. Never fatal. */
  private async waitForImages(
    documentId: string,
    budgetMs: number,
    signal: AbortSignal,
    warnings: string[],
  ) {
    const deadline = Date.now() + budgetMs;
    let summary = { total: 0, done: 0, pending: 0, failed: 0 };

    for (;;) {
      const assets = await api.getAssets(this.client, documentId, signal);
      summary = summarizeAssets(assets);
      if (summary.pending === 0) return summary;
      if (Date.now() > deadline) {
        warnings.push(
          `${summary.pending} image(s) were still generating after ${Math.round(budgetMs / 1000)}s. ` +
            `They continue in the background; poll vellum.get_asset_status.`,
        );
        return summary;
      }
      await sleep(ASSET_POLL_MS, signal);
    }
  }

  /**
   * Poll until the quality pass genuinely finishes.
   *
   * `qualityReport != null` is NOT the predicate: qa/run.ts writes a PARTIAL
   * report with `score: null` at the same instant it sets status "reviewing".
   * Quality is also best-effort and can hang, so this is a bounded wait that
   * never fails the operation.
   */
  private async waitForQuality(
    documentId: string,
    budgetMs: number,
    signal: AbortSignal,
    warnings: string[],
  ): Promise<DocumentDetail> {
    const deadline = Date.now() + budgetMs;
    let doc = await api.getDocument(this.client, documentId, signal);

    for (;;) {
      const report = parseQuality(doc.qualityReport);
      if (doc.status === "ready" && isQualityComplete(report)) return doc;
      if (doc.status === "error") return doc;
      if (Date.now() > deadline) {
        warnings.push(
          `The quality review had not finished after ${Math.round(budgetMs / 1000)}s. ` +
            `The document itself is complete; the score may appear later.`,
        );
        return doc;
      }
      await sleep(QUALITY_POLL_MS, signal);
      doc = await api.getDocument(this.client, documentId, signal);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Single-slide and theme operations                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Regenerate one slide. Takes Vellum's generation lock, so it goes through
   * the same queue as a full generation.
   */
  async regenerateSlide(
    documentId: string,
    input: { slideNumber?: number; slideId?: string; instruction?: string },
    signal: AbortSignal,
  ) {
    const doc = await api.getDocument(this.client, documentId, signal);
    const slides = parseSlides(doc.slides);

    // Agents count from 1 and never hold Vellum's internal FNV-1a slide ids,
    // so resolve the number here rather than making them find it.
    let slideId = input.slideId;
    if (!slideId) {
      const n = input.slideNumber;
      if (!n) throw preconditionFailed("Provide either slideNumber or slideId.");
      const slide = slides[n - 1];
      if (!slide) {
        throw preconditionFailed(
          `This document has ${slides.length} slides; slide ${n} does not exist.`,
          { slideCount: slides.length },
        );
      }
      slideId = slide.id;
    }

    const release = await this.mutex.acquire(`slide:${documentId}`, signal);
    try {
      const result = await api.regenerateSlide(
        this.client,
        {
          documentId,
          slideId,
          ...(input.instruction ? { instruction: input.instruction } : {}),
        },
        signal,
        300_000,
      );
      const index = slides.findIndex((s) => s.id === slideId);
      return {
        documentId,
        slideId,
        slideNumber: index >= 0 ? index + 1 : null,
        imagesQueued: result.imageCount,
        note:
          result.imageCount > 0
            ? "New images were queued; poll vellum.get_asset_status."
            : "No new images were needed.",
      };
    } finally {
      await sleep(SETTLE_MS).catch(() => undefined);
      release();
    }
  }

  /** Restyle without touching content. */
  async setTheme(
    documentId: string,
    input: { mode: "builtin" | "brand" | "ai"; themeName?: string; hint?: string },
    signal: AbortSignal,
  ) {
    if (input.mode === "builtin") {
      if (!input.themeName) {
        throw preconditionFailed('mode "builtin" requires themeName.');
      }
      const updated = await api.patchDocument(
        this.client,
        documentId,
        { themeName: input.themeName, customThemeId: null },
        signal,
      );
      return { documentId, mode: input.mode, themeName: updated.themeName };
    }

    if (input.mode === "brand") {
      const r = await api.applyBrandTheme(this.client, documentId, signal);
      return { documentId, mode: input.mode, themeName: "custom", customThemeId: r.customThemeId, name: r.name };
    }

    // AI theming calls Ollama. Vellum does not lock this route, but running it
    // alongside a generation contends for the GPU — so we serialize anyway.
    const release = await this.mutex.acquire(`theme:${documentId}`, signal);
    try {
      const r = await api.generateTheme(
        this.client,
        { documentId, ...(input.hint ? { hint: input.hint } : {}) },
        signal,
        300_000,
      );
      return {
        documentId,
        mode: input.mode,
        themeName: "custom",
        customThemeId: r.id,
        theme: r.theme,
        note: "A new theme record is created on every call; do not retry this in a loop.",
      };
    } finally {
      release();
    }
  }
}

/* -------------------------------------------------------------------------- */

function elapsed(from: number): number {
  return Math.round((Date.now() - from) / 1000);
}

function forwardProgress(event: VellumSseEvent, sink: ProgressSink): void {
  if (event.type === "status") {
    const d = event.data as { status?: string };
    // Vellum's status strings are server-authored prose, safe to surface
    // verbatim — but never parse them, they are not an enum.
    if (d?.status) sink.status?.(d.status);
  } else if (event.type === "progress") {
    const d = event.data as { sections?: number; total?: number };
    if (typeof d?.sections === "number" && typeof d?.total === "number") {
      sink.progress?.(d.sections, d.total);
    }
  }
  // `chunk` is the raw LLM stream — 30 KB+ of deck XML. Counted, never retained.
}

/** A controller that also aborts when the caller's signal does. */
function linkedController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

export { preconditionFailed, VellumMcpError };
