/**
 * Background image job queue. FIFO per process; concurrency 1 for ComfyUI
 * (its own internal queue serializes anyway), 4 for network providers.
 * Jobs are DB rows (GeneratedImage) → idempotent and resumable at boot.
 *
 * Late-patch pattern derived from Presenton's slide_assets events
 * (Apache-2.0) — here the patch lands in Document.slides JSON and clients
 * reconcile by polling /api/documents/[id]/assets.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  generateImage,
  type ComfyModel,
  type ImageShape,
} from "@/lib/images/provider";
import { applyImageToSlides } from "@/lib/images/patch-slides";
import {
  FAMILY_DEFAULT_STYLE,
  getImageStyle,
  paletteWords,
} from "@/lib/images/styles";
import { getTemplate } from "@/lib/templates/library";
import { resolveDesignTokens } from "@/lib/design/tokens";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const COMFY_MODELS = new Set(["flux-schnell", "qwen-image", "hidream"]);

interface ImageJobContext {
  model?: ComfyModel;
  /** Full prompt with the deck's locked style block + palette words. */
  decorate: (subject: string) => string;
  negative?: string;
  shapeFor: (slideId: string | null, nodeId: string | null) => ImageShape;
}

/**
 * Per-deck image contract: model override, deck-level style blocks, and
 * slot-correct shapes — all derived from one document read.
 */
async function imageJobContext(
  documentId: string | null,
): Promise<ImageJobContext> {
  const fallback: ImageJobContext = {
    decorate: (s) => s,
    shapeFor: (_slideId, nodeId) =>
      nodeId === "__root__" ? "16x9" : "square",
  };
  if (!documentId) return fallback;
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      genParams: true,
      themeName: true,
      slides: true,
      kind: true,
      templateId: true,
    },
  });
  if (!doc) return fallback;

  let params: { imageModel?: string; imageStyle?: string } = {};
  try {
    params = doc.genParams ? JSON.parse(doc.genParams) : {};
  } catch {
    params = {};
  }
  const model =
    params.imageModel && COMFY_MODELS.has(params.imageModel)
      ? (params.imageModel as ComfyModel)
      : undefined;

  const theme = resolveThemeOrDefault(doc.themeName, null);
  const tokens = resolveDesignTokens(theme, doc.themeName ?? undefined);
  // Resolution chain: explicit user pick > template blueprint > family default.
  const blueprint = doc.templateId ? getTemplate(doc.templateId) : undefined;
  const preset =
    getImageStyle(params.imageStyle) ??
    getImageStyle(blueprint?.imageStyle) ??
    getImageStyle(FAMILY_DEFAULT_STYLE[tokens.family]);
  const palette = paletteWords(theme.colors.accent);

  let slides: PlateSlide[] = [];
  try {
    slides = doc.slides ? (JSON.parse(doc.slides) as PlateSlide[]) : [];
  } catch {
    slides = [];
  }

  return {
    model,
    decorate: (subject) =>
      preset
        ? `${subject}. ${preset.styleBlock}${palette ? `. Color mood: ${palette}` : ""}`
        : subject,
    negative: preset?.negativeBlock,
    shapeFor: (slideId, nodeId) => {
      if (nodeId !== "__root__") return "square";
      if (doc.kind === "doc") return "16x9";
      const slide = slides.find((s) => s.id === slideId);
      if (!slide) return "16x9";
      // Only a genuine full-slide image wants 16:9 — a "full-bleed" archetype
      // on a side-rail layout still renders into a ~40% column, where a 16:9
      // shot loses 60% of its width.
      if (slide.layoutType === "background") return "16x9";
      if (slide.archetype === "full-bleed" && slide.layoutType !== "vertical") {
        return "16x9";
      }
      // The vertical strip is ~4.2:1, far wider than the 2.4:1 `wide` shape.
      if (slide.layoutType === "vertical") return "band";
      // Side-rail slot is a tall portrait (~0.7 aspect on screen).
      return "portrait";
    },
  };
}

let running = 0;
let started = false;

function imagesDir(): string {
  const dir = path.resolve(process.cwd(), "data/images");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function processJob(jobId: string): Promise<void> {
  const job = await db.generatedImage.findUnique({ where: { id: jobId } });
  if (!job || job.status === "done") return;
  const settings = await getSettings();

  await db.generatedImage.update({
    where: { id: jobId },
    data: { status: "running", provider: settings.images.provider, error: null },
  });

  try {
    const context = await imageJobContext(job.documentId);
    const result = await generateImage(
      settings,
      context.decorate(job.prompt),
      context.shapeFor(job.slideId, job.nodeId),
      context.model,
      context.negative,
    );
    const filename = `${job.id}.${result.ext}`;
    writeFileSync(path.join(imagesDir(), filename), result.bytes);

    await db.generatedImage.update({
      where: { id: jobId },
      data: { status: "done", path: filename },
    });

    // Patch the document's slides JSON so every future read has the URL.
    if (job.documentId && job.slideId) {
      const doc = await db.document.findUnique({
        where: { id: job.documentId },
        select: { slides: true },
      });
      if (doc) {
        const slides = JSON.parse(doc.slides) as PlateSlide[];
        const applied = applyImageToSlides(
          slides,
          job.slideId,
          job.nodeId,
          job.prompt,
          `/api/images/file/${filename}`,
        );
        if (applied) {
          await db.document.update({
            where: { id: job.documentId },
            data: { slides: JSON.stringify(slides) },
          });
        }
      }
      // Queue drained for this document → clear stale "image-pending" lint.
      const remaining = await db.generatedImage.count({
        where: {
          documentId: job.documentId,
          status: { in: ["pending", "running"] },
        },
      });
      if (remaining === 0) {
        void import("@/lib/qa/run").then((m) =>
          m.refreshLintReport(job.documentId as string).catch(() => undefined),
        );
      }
    }
  } catch (error) {
    await db.generatedImage.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function pump(): Promise<void> {
  const settings = await getSettings();
  const limit = settings.images.provider === "comfyui" ? 1 : 4;
  if (running >= limit) return;

  const next = await db.generatedImage.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return;

  running += 1;
  void processJob(next.id)
    .catch(() => undefined)
    .finally(() => {
      running -= 1;
      void pump();
    });
  // Fill remaining slots.
  void pump();
}

/** Kick the queue (fire-and-forget). Safe to call any time. */
export function kickImageQueue(): void {
  void resumeAtBoot().then(() => pump());
}

let bootResumed = false;
async function resumeAtBoot(): Promise<void> {
  if (bootResumed) return;
  bootResumed = true;
  started = true;
  // Jobs stuck "running" from a previous process are re-queued.
  await db.generatedImage
    .updateMany({
      where: { status: "running" },
      data: { status: "pending" },
    })
    .catch(() => undefined);
}

export function queueStarted(): boolean {
  return started;
}
