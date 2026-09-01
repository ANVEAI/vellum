/**
 * The tool registry.
 *
 * Ordering is a fixed authored array, not `sort()`. The spec requires
 * determinism, not alphabetisation — and workflow order (observe, plan, create,
 * refine, deliver, recover, manage) both reads better and puts the tools a model
 * most needs near the front, where they carry more weight.
 *
 * Descriptions are written FOR a model: what the tool does, what it costs, what
 * it requires first, and what to call next.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { withContent, type ToolDefinition } from "../tool.js";
import {
  IMAGE_MODELS,
  IMAGE_STYLES,
  TEMPLATES,
  TEMPLATE_IDS,
  TEXT_DENSITIES,
} from "../../domain/templates.js";
import { assertFormat } from "../../domain/exports.js";
import { invalidInput, notFound } from "../../infra/errors.js";

const documentId = z.string().min(1).describe("The document id returned when it was created.");

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/* -------------------------------------------------------------------------- */
/* Shared generation parameters                                                */
/* -------------------------------------------------------------------------- */

/**
 * A plain string, deliberately NOT an enum of all 20 template ids.
 *
 * The enum was roughly 40% of generate_presentation's schema bytes, and
 * multi-argument tool calls are where local models' output format frays — a
 * malformed call costs the whole turn. Ids are discoverable through
 * vellum.list_templates and validated in the handler against the same list, so
 * a wrong value still gets a precise error naming the valid ids. Discoverability
 * is preserved; the per-call schema cost is not paid.
 */
const templateIdSchema = z
  .string()
  .optional()
  .describe(
    'Blueprint id from vellum.list_templates, e.g. "pitch-deck". Omit for no template.',
  );

/** How many slides, as a REQUIRED field on generate_presentation — see below. */
const nCardsSchema = z
  .number()
  .int()
  .min(1)
  .max(30)
  .describe(
    "How many slides to produce (1-30). The outline stage enforces this; editing the " +
      "outline afterwards changes it again.",
  );

const genParamShape = {
  nCards: nCardsSchema
    .optional()
    .describe(
      "How many slides/sections to produce (1-30). Overrides the template default. " +
        "Note the outline stage is what enforces this; editing the outline afterwards changes it again.",
    ),
  language: z.string().optional().describe('Output language. Defaults to "English".'),
  tone: z.string().optional().describe('Free text, e.g. "confident and concrete".'),
  audience: z.string().optional().describe('Free text, e.g. "hospital procurement leads".'),
  textDensity: z.enum(TEXT_DENSITIES).optional(),
  webSearch: z
    .boolean()
    .optional()
    .describe(
      "Ground the outline in live web research via the local SearXNG. Defaults true. " +
        "Ignored when sourceText is supplied, and requires SearXNG to be up (check vellum.health).",
    ),
  imageStyle: z.enum(IMAGE_STYLES).optional(),
  imageModel: z.enum(IMAGE_MODELS).optional(),
};

function collectGenParams(args: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(genParamShape)) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

/* -------------------------------------------------------------------------- */

export const TOOLS: ToolDefinition[] = [
  /* ---------------------------------------------------------------- observe */
  {
    name: "vellum.health",
    title: "Check Vellum status",
    description:
      "Check whether Vellum is reachable and whether a generation can start right now. " +
      "Call this BEFORE any generation: Ollama being down is the most common cause of a " +
      "multi-minute failure, and this catches it in milliseconds. Also reports whether a " +
      "generation is already running, since Vellum runs exactly one at a time.",
    inputSchema: {},
    annotations: READ_ONLY,
    handler: (_a, ctx, s) => s.system.health(ctx.signal),
  },

  {
    name: "vellum.list_templates",
    title: "List generation blueprints",
    description:
      "List Vellum's 20 templates. A template fixes the narrative skeleton (section order and " +
      "per-section guidance), seeds the default section count and tone, and pairs a theme. " +
      "Choosing a fitting template is the largest quality lever available before generation.",
    inputSchema: {
      kind: z.enum(["deck", "doc"]).optional().describe("Filter to presentations or documents."),
    },
    annotations: READ_ONLY,
    handler: async (a) => {
      const kind = a.kind as "deck" | "doc" | undefined;
      const rows = kind ? TEMPLATES.filter((t) => t.kind === kind) : TEMPLATES;
      return { count: rows.length, templates: rows };
    },
  },

  {
    name: "vellum.list_documents",
    title: "List documents",
    description:
      "List documents in the Vellum library, newest first. Returns identity and status only — " +
      "use vellum.get_document for content. A status of 'outlining' or 'generating' on an old " +
      "document usually means it is stuck; vellum.repair_document can diagnose it.",
    inputSchema: {
      status: z
        .array(z.enum(["draft", "outlining", "generating", "ready", "error", "reviewing"]))
        .optional(),
      kind: z.enum(["deck", "doc"]).optional(),
      titleContains: z.string().optional(),
      updatedWithinHours: z.number().min(0.1).max(8760).optional(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
    },
    annotations: READ_ONLY,
    handler: (a, ctx, s) =>
      s.documents.list(
        {
          status: a.status as string[] | undefined,
          kind: a.kind as "deck" | "doc" | undefined,
          titleContains: a.titleContains as string | undefined,
          updatedWithinHours: a.updatedWithinHours as number | undefined,
          limit: a.limit as number | undefined,
        },
        ctx.signal,
      ),
  },

  {
    name: "vellum.get_document",
    title: "Read a document",
    description:
      "Read one document through a projection. Defaults to 'summary' (small): status, slide and " +
      "outline counts, image progress and quality score. Use 'outline' to review the plan, " +
      "'slides' for a compact text digest of the content, 'quality' for the QA report, 'assets' " +
      "for image failures. A summary with truncated:true means the deck has FEWER slides than its " +
      "outline promised — the generation was cut short even though the status says ready.",
    inputSchema: {
      documentId,
      view: z
        .enum(["summary", "outline", "slides", "quality", "assets", "raw_xml"])
        .optional()
        .describe("Default 'summary'. 'raw_xml' is large debug output; avoid unless debugging."),
      maxCharsPerSlide: z.number().int().min(0).max(4000).optional().describe("Default 400; 0 = unbounded."),
      slideNumbers: z.array(z.number().int().min(1)).optional().describe("1-based subset."),
      includeSpeakerNotes: z.boolean().optional(),
      includeMinorIssues: z.boolean().optional().describe("Quality view: include minor lint. Default false."),
    },
    annotations: READ_ONLY,
    handler: (a, ctx, s) =>
      s.documents.get(
        a.documentId as string,
        (a.view as never) ?? "summary",
        {
          maxCharsPerSlide: a.maxCharsPerSlide as number | undefined,
          slideNumbers: a.slideNumbers as number[] | undefined,
          includeSpeakerNotes: a.includeSpeakerNotes as boolean | undefined,
          includeMinorIssues: a.includeMinorIssues as boolean | undefined,
        },
        ctx.signal,
      ),
  },

  /* ----------------------------------------------------------------- create */
  {
    name: "vellum.generate_presentation",
    title: "Generate a presentation",
    description:
      "Generate a slide deck from a prompt. This is the main entry point: it creates the " +
      "document, researches the topic, drafts an outline, generates all slide content, and " +
      "waits for images. Generation takes MINUTES on a local model, so this returns a job " +
      "handle immediately — poll vellum.get_generation_status with the returned jobId. " +
      "Set stopAfterOutline:true to review the outline first, then edit it with " +
      "vellum.set_outline and finish with vellum.generate_slides_from_outline; the outline " +
      "determines the final slide count, so reviewing it is the cheapest way to control the " +
      "result. Only one generation runs at a time across all of Vellum. " +
      "Without an idempotencyKey, calling this twice creates TWO documents.",
    inputSchema: {
      prompt: z.string().min(1).max(4000).describe("What the deck should be about."),
      templateId: templateIdSchema,
      ...genParamShape,
      // REQUIRED here, optional on the other generation tools. A duplicate key
      // keeps its position from the spread but takes this value, so nCards stays
      // second in the property order and becomes mandatory. Two required fields
      // and no enums is the smallest call the model can be asked to emit, which
      // is the point: multi-argument calls are where local models' tool output
      // frays, and this is the tool that has to survive it.
      nCards: nCardsSchema,
      useBrandTheme: z.boolean().optional().describe("Apply the saved brand kit instead of the template theme."),
      sourceText: z
        .string()
        .max(80_000)
        .optional()
        .describe("Ground generation on this text instead of web research."),
      stopAfterOutline: z.boolean().optional(),
      idempotencyKey: z.string().optional().describe("Reuse an in-flight or finished run instead of starting a second."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: (a, ctx, s) => startGeneration(a, ctx, s, "deck"),
  },

  {
    name: "vellum.generate_document",
    title: "Generate a long-form document",
    description:
      "Generate a written document (report, memo, whitepaper, case study) rather than a slide " +
      "deck. Same pipeline and same job-handle behaviour as vellum.generate_presentation — " +
      "poll vellum.get_generation_status. Documents export to PDF and DOCX.",
    inputSchema: {
      prompt: z.string().min(1).max(4000),
      templateId: templateIdSchema,
      ...genParamShape,
      sourceText: z.string().max(80_000).optional(),
      stopAfterOutline: z.boolean().optional(),
      idempotencyKey: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: (a, ctx, s) => startGeneration(a, ctx, s, "doc"),
  },

  {
    name: "vellum.get_generation_status",
    title: "Check a generation",
    description:
      "Poll a generation started by vellum.generate_presentation or vellum.generate_document. " +
      "Returns working / completed / failed / cancelled, the latest progress message, and the " +
      "full result once finished. Poll every few seconds; a full deck takes minutes. The " +
      "documentId is valid from the moment the job starts, so vellum.get_document works even " +
      "while this still says working.",
    inputSchema: { jobId: z.string().min(1) },
    annotations: READ_ONLY,
    handler: async (a, _ctx, s) => {
      const job = s.jobs.get(a.jobId as string);
      if (!job) {
        throw notFound(
          "Generation job",
          `${a.jobId as string}" — job records are kept in memory and expire; if the server ` +
            `restarted, use vellum.list_documents to find the document instead. "`,
        );
      }
      return {
        jobId: job.jobId,
        status: job.status,
        documentId: job.documentId,
        statusMessage: job.statusMessage,
        progress: job.progress,
        result: job.result,
        error: job.error,
        elapsedSeconds: Math.round((job.updatedAt - job.createdAt) / 1000),
      };
    },
  },

  {
    name: "vellum.cancel_generation",
    title: "Cancel a generation",
    description:
      "Cancel a running generation. This aborts the upstream request, which is also what " +
      "releases Vellum's single generation slot — so cancelling is the correct way to free it, " +
      "not simply abandoning the job. Note that Vellum PERSISTS whatever it had generated and " +
      "marks the document 'ready', so a cancelled deck may be silently incomplete; check " +
      "truncated in vellum.get_document.",
    inputSchema: { jobId: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (a, _ctx, s) => {
      const cancelled = s.jobs.cancel(a.jobId as string);
      const job = s.jobs.get(a.jobId as string);
      return {
        jobId: a.jobId,
        cancelled,
        status: job?.status ?? "unknown",
        documentId: job?.documentId,
        note: cancelled
          ? "Aborted. Vellum keeps partial output and marks it ready — verify with vellum.get_document."
          : "The job was already finished or unknown.",
      };
    },
  },

  /* ----------------------------------------------------------------- refine */
  {
    name: "vellum.generate_outline",
    title: "Generate an outline only",
    description:
      "Create a document and generate only its outline, stopping before slide content. " +
      "Equivalent to vellum.generate_presentation with stopAfterOutline:true. Use when you want " +
      "to review or edit the plan before spending minutes on content.",
    inputSchema: {
      prompt: z.string().min(1).max(4000),
      kind: z.enum(["deck", "doc"]).optional(),
      templateId: templateIdSchema,
      ...genParamShape,
      sourceText: z.string().max(80_000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: (a, ctx, s) => startGeneration({ ...a, stopAfterOutline: true }, ctx, s, (a.kind as never) ?? "deck"),
  },

  {
    name: "vellum.set_outline",
    title: "Replace an outline",
    description:
      "Replace a document's outline. The outline is the CONTRACT for content generation: the " +
      "number of '## ' sections determines exactly how many slides get generated, regardless of " +
      "any earlier slide-count setting. Prefer the `cards` array — it guarantees the exact " +
      "markdown shape Vellum's parser recognises, whereas hand-written markdown with the wrong " +
      "heading level silently yields zero sections. Call this between vellum.generate_outline " +
      "and vellum.generate_slides_from_outline.",
    inputSchema: {
      documentId,
      title: z.string().min(1).optional(),
      cards: z
        .array(z.object({ heading: z.string().min(1), bullets: z.array(z.string()).optional() }))
        .min(1)
        .max(30)
        .optional(),
      markdown: z.string().optional().describe("Raw markdown. Expert use; `cards` is safer."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.documents.setOutline(
        a.documentId as string,
        {
          title: a.title as string | undefined,
          cards: a.cards as { heading: string; bullets?: string[] }[] | undefined,
          markdown: a.markdown as string | undefined,
        },
        ctx.signal,
      ),
  },

  {
    name: "vellum.generate_slides_from_outline",
    title: "Generate content from the outline",
    description:
      "Generate slide content for a document that already has an outline. Use this to finish an " +
      "outline-reviewed document, or to RETRY after a failed or truncated generation — it " +
      "replaces the content in place, so no duplicate document is created. Returns a job handle; " +
      "poll vellum.get_generation_status. Destructive: existing slides are overwritten, so " +
      "duplicate the document first if you want to keep them.",
    inputSchema: {
      documentId,
      waitForImagesSeconds: z.number().int().min(0).max(900).optional(),
      waitForQualitySeconds: z.number().int().min(0).max(900).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    handler: async (a, ctx, s) => {
      const id = a.documentId as string;
      const doc = await s.documents.get(id, "summary", {}, ctx.signal);
      const cardCount = Number(doc.cardCount ?? 0);
      if (cardCount === 0) {
        throw invalidInput(
          "This document has no outline yet, so there is nothing to generate from. " +
            "Call vellum.generate_outline or vellum.set_outline first.",
        );
      }
      const job = s.jobs.start(
        "generate_slides",
        (record, signal) =>
          s.presentations.runContent(
            id,
            {
              cardCount,
              startedAt: Date.now(),
              warnings: [],
              waitForImagesMs: numOrUndef(a.waitForImagesSeconds, 1000),
              waitForQualityMs: numOrUndef(a.waitForQualitySeconds, 1000),
            },
            signal,
            sinkFor(record),
            s.logger.child({ documentId: id }),
          ),
        { documentId: id },
      );
      return handleOf(job, "Generating slide content.");
    },
  },

  {
    name: "vellum.regenerate_slide",
    title: "Regenerate one slide",
    description:
      "Regenerate a single slide in place, optionally with an instruction such as 'add concrete " +
      "figures' or 'cut this to three bullets'. Much faster than regenerating the whole deck and " +
      "leaves every other slide untouched. Takes Vellum's generation slot, so it queues behind " +
      "any running generation. Identify the slide by its 1-based number from " +
      "vellum.get_document view:'slides'.",
    inputSchema: {
      documentId,
      slideNumber: z.number().int().min(1).optional(),
      slideId: z.string().optional().describe("Alternative to slideNumber."),
      instruction: z.string().max(1000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    handler: async (a, ctx, s) => s.presentations.regenerateSlide(
      a.documentId as string,
      { slideNumber: a.slideNumber as number | undefined, slideId: a.slideId as string | undefined, instruction: a.instruction as string | undefined },
      ctx.signal,
    ),
  },

  {
    name: "vellum.set_theme",
    title: "Restyle a document",
    description:
      "Restyle a document without touching its content. 'builtin' selects a packaged theme by " +
      "name, 'brand' applies the saved brand kit, 'ai' designs a fresh palette and font pairing " +
      "from a style hint. Safe on a finished deck — content is never regenerated. Note that " +
      "'brand' and 'ai' create a new theme record on every call, so do not retry them in a loop.",
    inputSchema: {
      documentId,
      mode: z.enum(["builtin", "brand", "ai"]),
      themeName: z.string().optional().describe("Required when mode is 'builtin'."),
      hint: z.string().max(300).optional().describe("Style direction when mode is 'ai'."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.presentations.setTheme(
        a.documentId as string,
        { mode: a.mode as never, themeName: a.themeName as string | undefined, hint: a.hint as string | undefined },
        ctx.signal,
      ),
  },

  /* ---------------------------------------------------------------- deliver */
  {
    name: "vellum.export_document",
    title: "Export to PDF, PowerPoint or Word",
    description:
      "Export a finished document and return the file itself. Small files come back embedded; " +
      "larger ones as a downloadable link the client can fetch. The JSON summary alongside it " +
      "carries the document id, slide count and size. All three formats render through a headless " +
      "browser and can take up to five minutes for a large deck, so if one format fails with a " +
      "browser error the others will too. Fails immediately if the document has no slides yet.",
    inputSchema: {
      documentId,
      format: z.enum(["pdf", "pptx", "docx"]).optional().describe("Default 'pdf'."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (a, ctx, s) => {
      const artifact = await s.exports.export(
        a.documentId as string,
        assertFormat((a.format as string) ?? "pdf"),
        ctx.signal,
      );
      return exportContent(artifact, s.config);
    },
  },

  /* ----------------------------------------------------------------- recover */
  {
    name: "vellum.repair_document",
    title: "Diagnose and repair a document",
    description:
      "Diagnose, and optionally repair, a document stuck in a known bad state. Called without " +
      "`actions` it only reports. Vellum has several states nothing else clears: a failed outline " +
      "strands a document at 'outlining' forever; an interrupted generation persists a TRUNCATED " +
      "deck marked 'ready' with no warning; failed images never surface as errors. Run this " +
      "whenever a document looks finished but wrong.",
    inputSchema: {
      documentId,
      actions: z
        .array(z.enum(["retry_failed_images", "reset_stuck_status", "rerun_quality"]))
        .optional()
        .describe("Omit to diagnose without changing anything."),
      staleAfterSeconds: z.number().int().min(60).max(86400).optional().describe("Default 600."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.documents.repair(
        a.documentId as string,
        a.actions as never,
        (a.staleAfterSeconds as number | undefined) ?? 600,
        ctx.signal,
      ),
  },

  {
    name: "vellum.get_asset_status",
    title: "Check image generation",
    description:
      "Check image generation progress for a document. Images are produced by a background queue " +
      "AFTER slide text is written, so a deck can be readable while its illustrations are still " +
      "rendering. pending reaching 0 means all jobs finished. Failed images never fail a " +
      "generation — the deck stays usable with placeholder-free but image-less slides.",
    inputSchema: { documentId },
    annotations: READ_ONLY,
    handler: (a, ctx, s) => s.assets.status(a.documentId as string, ctx.signal),
  },

  {
    name: "vellum.retry_failed_images",
    title: "Retry failed images",
    description:
      "Re-queue every failed image job for a document. Safe to call repeatedly; it only affects " +
      "jobs already in the failed state. Check the outcome with vellum.get_asset_status.",
    inputSchema: { documentId },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) => s.assets.retryFailed(a.documentId as string, ctx.signal),
  },

  {
    name: "vellum.request_slide_image",
    title: "Queue an image for a slide",
    description:
      "Queue a new image generation for one slide, replacing whatever image it has. Requires the " +
      "slideId from vellum.get_document view:'slides'. Returns immediately; poll " +
      "vellum.get_asset_status.",
    inputSchema: {
      documentId,
      slideId: z.string().min(1),
      prompt: z.string().min(1).max(2000),
      nodeId: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.assets.requestSlideImage(
        a.documentId as string,
        { slideId: a.slideId as string, prompt: a.prompt as string, nodeId: a.nodeId as string | undefined },
        ctx.signal,
      ),
  },

  {
    name: "vellum.generate_image",
    title: "Generate a standalone image",
    description:
      "Generate a single image from a prompt, unattached to any document, and return its URL. " +
      "This runs synchronously on the GPU and can take up to a minute. It bypasses the document " +
      "image queue entirely, so it contends with any running generation.",
    inputSchema: {
      prompt: z.string().min(1).max(2000),
      shape: z.enum(["16x9", "square"]).optional(),
      model: z.enum(IMAGE_MODELS).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.assets.generateStandalone(
        { prompt: a.prompt as string, shape: a.shape as never, model: a.model as string | undefined },
        ctx.signal,
      ),
  },

  /* ------------------------------------------------------------------ manage */
  {
    name: "vellum.update_document",
    title: "Update document metadata",
    description:
      "Change a document's title or theme. Content is not touched. To change the outline use " +
      "vellum.set_outline; to change slides use vellum.regenerate_slide.",
    inputSchema: {
      documentId,
      title: z.string().min(1).optional(),
      themeName: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.documents.updateMeta(
        a.documentId as string,
        { title: a.title as string | undefined, themeName: a.themeName as string | undefined },
        ctx.signal,
      ),
  },

  {
    name: "vellum.duplicate_document",
    title: "Duplicate a document",
    description:
      "Copy a document including its outline, slides and theme. Use this before a destructive " +
      "regeneration to keep a version you can fall back to — Vellum has no undo. The copy does " +
      "not carry the quality report or image job records, though its slides keep their existing " +
      "image URLs.",
    inputSchema: { documentId },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (a, ctx, s) => s.documents.duplicate(a.documentId as string, ctx.signal),
  },

  {
    name: "vellum.delete_document",
    title: "Delete a document",
    description:
      "Permanently delete a document and its generated images. NOT reversible — Vellum has no " +
      "trash. Pass confirmTitle to assert you are deleting what you think you are. Deleting an " +
      "already-deleted document succeeds silently.",
    inputSchema: {
      documentId,
      confirmTitle: z.string().optional().describe("If given, must match the document's title exactly."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.documents.delete(a.documentId as string, a.confirmTitle as string | undefined, ctx.signal),
  },

  {
    name: "vellum.import_source",
    title: "Extract text from a document",
    description:
      "Extract plain text from pasted content so it can ground a generation. This does NOT create " +
      "a Vellum document — pass the returned text as `sourceText` to vellum.generate_presentation, " +
      "which grounds the outline on it and skips web research.",
    inputSchema: {
      text: z.string().min(1),
      filename: z.string().optional().describe("Helps title detection; defaults to pasted.md."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) =>
      s.system.importSource(
        { text: a.text as string, filename: a.filename as string | undefined },
        ctx.signal,
      ),
  },

  {
    name: "vellum.search_icons",
    title: "Search the icon library",
    description:
      "Semantic search over Vellum's icon set. Icons are normally resolved automatically during " +
      "generation; this is for inspecting what is available.",
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional().describe("Default 12."),
    },
    annotations: READ_ONLY,
    handler: (a, ctx, s) =>
      s.system.searchIcons(a.query as string, (a.limit as number | undefined) ?? 12, ctx.signal),
  },

  {
    name: "vellum.get_settings",
    title: "Read Vellum settings",
    description:
      "Read Vellum's global configuration: model, image provider, search settings and brand kit. " +
      "API keys are reported only as configured or not — never by value. These settings are " +
      "GLOBAL and affect every user of this Vellum instance.",
    inputSchema: {},
    annotations: READ_ONLY,
    handler: (_a, ctx, s) => s.system.settings(ctx.signal),
  },

  {
    name: "vellum.update_settings",
    title: "Update Vellum settings",
    description:
      "Update Vellum's GLOBAL settings. These apply to every user of this instance and take " +
      "effect on the next generation, including one already in progress. Changing service URLs " +
      "is blocked by default because repointing them would send every future prompt elsewhere; " +
      "set VELLUM_MCP_ALLOW_URL_SETTINGS=true on the server to permit it.",
    inputSchema: {
      llm: z.object({ model: z.string().optional(), think: z.boolean().optional(), ollamaUrl: z.string().optional() }).optional(),
      search: z.object({ enabled: z.boolean().optional(), maxResults: z.number().int().min(1).max(10).optional(), searxngUrl: z.string().optional() }).optional(),
      images: z.object({ provider: z.enum(["comfyui", "gemini", "pexels", "none"]).optional(), comfyModel: z.enum(IMAGE_MODELS).optional(), comfyuiUrl: z.string().optional() }).optional(),
      icons: z.object({ weight: z.enum(["bold", "duotone", "fill", "light", "regular", "thin"]).optional() }).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) => s.system.updateSettings(a as Record<string, unknown>, ctx.signal),
  },
];

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function numOrUndef(v: unknown, scale = 1): number | undefined {
  return typeof v === "number" ? v * scale : undefined;
}

function sinkFor(record: {
  statusMessage?: string;
  progress?: { current: number; total: number };
  documentId?: string;
  updatedAt: number;
}) {
  return {
    status(message: string) {
      record.statusMessage = message;
      record.updatedAt = Date.now();
    },
    progress(current: number, total: number) {
      record.progress = { current, total };
      record.updatedAt = Date.now();
    },
    /**
     * Publish the handle the instant the row exists. Without this the job
     * reports documentId:null for the whole run, and a caller whose generation
     * then fails has no way to find — or clean up — what was created.
     */
    documentCreated(documentId: string) {
      record.documentId = documentId;
      record.updatedAt = Date.now();
    },
  };
}

function handleOf(job: { jobId: string; documentId?: string; status: string }, note: string) {
  return {
    jobId: job.jobId,
    documentId: job.documentId ?? null,
    status: job.status,
    pollWith: "vellum.get_generation_status",
    cancelWith: "vellum.cancel_generation",
    note: `${note} This takes minutes — poll every few seconds.`,
  };
}

/**
 * Turn an export into MCP content the caller can actually use.
 *
 * A filesystem path is useless to a browser client on another machine, so the
 * bytes are returned as content instead:
 *
 *   - at or under `embedMaxBytes`, an embedded base64 `resource`
 *   - above it, a `resource_link` pointing at this server's own /exports route
 *
 * The link is built from `config.publicUrl`, which defaults to the HTTP
 * transport's own host and port — i.e. the same origin the consumer registered.
 * That matters: hosts refuse to follow off-origin URLs from a tool result,
 * because a server-supplied URL is an SSRF vector.
 *
 * Under stdio there is no HTTP listener, so no link can be honoured. In that
 * case a file too large to embed falls back to the path with an explicit note,
 * rather than handing back a URL that would 404.
 */
function exportContent(
  artifact: import("../../domain/exports.js").ArtifactResult,
  config: import("../../infra/config.js").Config,
) {
  const payload = {
    documentId: artifact.documentId,
    format: artifact.format,
    filename: artifact.suggestedFilename ?? artifact.filename,
    slideCount: artifact.slideCount,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
  };

  const displayName = artifact.suggestedFilename ?? artifact.filename;
  const summary =
    `Exported "${displayName}" — ${artifact.slideCount} slides, ` +
    `${(artifact.bytes / 1_000_000).toFixed(1)} MB ${artifact.format.toUpperCase()}.`;

  if (artifact.bytes <= config.embedMaxBytes) {
    const blob = readFileSync(artifact.path).toString("base64");
    return withContent(
      { ...payload, delivery: "embedded" },
      [
        {
          type: "resource",
          resource: { uri: `file://${artifact.path}`, mimeType: artifact.mimeType, blob },
        },
      ],
      summary,
    );
  }

  if (config.transport !== "http") {
    return {
      ...payload,
      delivery: "path",
      path: artifact.path,
      note:
        `The file is ${(artifact.bytes / 1_000_000).toFixed(1)} MB, too large to embed, and this ` +
        `server is running on stdio so it cannot serve a download link. Read it from the path, ` +
        `or run the server with --transport=http to get a fetchable link.`,
    };
  }

  const uri = `${config.publicUrl}/exports/${artifact.filename}`;
  return withContent(
    { ...payload, delivery: "link", uri },
    [
      {
        type: "resource_link",
        uri,
        name: displayName,
        mimeType: artifact.mimeType,
        description: `${artifact.slideCount}-slide ${artifact.format.toUpperCase()} export`,
      },
    ],
    summary,
  );
}

async function startGeneration(
  a: Record<string, unknown>,
  _ctx: unknown,
  s: import("../../domain/services.js").Services,
  kind: "deck" | "doc",
) {
  // templateId is a plain string in the schema (see templateIdSchema), so the
  // validation the enum used to do happens here instead — and gives a better
  // error than Vellum's bare "Unknown templateId", without a round trip.
  const templateId = a.templateId as string | undefined;
  if (templateId && !TEMPLATE_IDS.includes(templateId)) {
    throw invalidInput(
      `Unknown templateId "${templateId}". Valid ids: ${TEMPLATE_IDS.join(", ")}. ` +
        `Call vellum.list_templates to see what each one is for, or omit templateId.`,
    );
  }

  const input = {
    prompt: a.prompt as string,
    kind,
    templateId,
    useBrandTheme: a.useBrandTheme as boolean | undefined,
    genParams: collectGenParams(a),
    sourceText: a.sourceText as string | undefined,
    stopAfterOutline: a.stopAfterOutline as boolean | undefined,
  };

  const job = s.jobs.start(
    kind === "deck" ? "generate_presentation" : "generate_document",
    (record, signal) => s.presentations.generate(input, signal, sinkFor(record)),
    { ...(a.idempotencyKey ? { key: a.idempotencyKey as string } : {}) },
  );

  return handleOf(
    job,
    input.stopAfterOutline ? "Generating the outline." : `Generating a ${kind === "deck" ? "deck" : "document"}.`,
  );
}
