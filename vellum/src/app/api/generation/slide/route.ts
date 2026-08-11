import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { chatOnce } from "@/lib/generation/llm/ollama";
import { SlideParser } from "@/lib/generation/parser/slide-parser";
import { buildDeckPrompt } from "@/lib/generation/prompts/deck";
import { buildDocumentPrompt } from "@/lib/generation/prompts/document";
import { parseOutlineMarkdown } from "@/lib/generation/prompts/outline";
import {
  acquireGenerationLock,
  releaseGenerationLock,
} from "@/lib/generation/pipeline/lock";
import {
  applyIconUrls,
  collectIconQueries,
  collectImageRequests,
} from "@/lib/slides/walk";
import { resolveIconQueries } from "@/lib/icons/search";
import { kickImageQueue } from "@/lib/generation/pipeline/asset-queue";
import { formatTemplateGuidance, getTemplate } from "@/lib/templates/library";
import { replanSlide } from "@/lib/design/planner";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Regenerate exactly one slide/section in place. */
export async function POST(request: NextRequest) {
  await ensureWal();
  const { documentId, slideId, instruction } = (await request
    .json()
    .catch(() => ({}))) as {
    documentId?: string;
    slideId?: string;
    instruction?: string;
  };
  if (!documentId || !slideId) {
    return NextResponse.json(
      { error: "documentId and slideId required" },
      { status: 400 },
    );
  }
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const slides = JSON.parse(document.slides) as PlateSlide[];
  const index = slides.findIndex((s) => s.id === slideId);
  if (index === -1) {
    return NextResponse.json({ error: "Slide not found" }, { status: 404 });
  }

  const lockOwner = `slide:${documentId}:${Date.now()}`;
  if (!acquireGenerationLock(lockOwner)) {
    return NextResponse.json(
      { error: "Another generation is running — try again shortly." },
      { status: 409 },
    );
  }

  try {
    const settings = await getSettings();
    const { cards } = parseOutlineMarkdown(document.outline ?? "");
    const mode = document.kind === "doc" ? "document" : "deck";
    const genParams = document.genParams
      ? (JSON.parse(document.genParams) as Record<string, unknown>)
      : {};

    const template = document.templateId
      ? getTemplate(document.templateId)
      : undefined;
    const promptInput = {
      prompt: document.prompt ?? "",
      title: document.title,
      outline: cards.length ? cards : ["(no outline available)"],
      language: (genParams.language as string) ?? "English",
      tone: genParams.tone as string | undefined,
      researchContext: document.researchContext ?? undefined,
      currentDate: new Date().toISOString().slice(0, 10),
      templateGuidance: template ? formatTemplateGuidance(template) : undefined,
    };
    const base =
      mode === "document"
        ? buildDocumentPrompt(promptInput)
        : buildDeckPrompt(promptInput);

    const envelope = mode === "document" ? "DOCUMENT" : "PRESENTATION";
    const cardForSlide =
      cards[Math.min(index, Math.max(0, cards.length - 1))] ?? "";
    const regenSystem = `${base.system}

# SINGLE-SECTION OVERRIDE
You are regenerating ONE ${mode === "document" ? "section" : "slide"} of an existing ${mode}. Output exactly ONE <SECTION>...</SECTION> element inside a single <${envelope}> root — no other sections, no commentary.`;
    const regenUser = `${base.user}

# Regenerate ${mode === "document" ? "section" : "slide"} ${index + 1} of ${slides.length}.
Its outline entry:
${cardForSlide}
${instruction ? `\nAdditional instruction: ${instruction}` : ""}`;

    const raw = await chatOnce({
      baseUrl: settings.llm.ollamaUrl,
      model: settings.llm.model,
      think: settings.llm.think,
      stop: [`</${envelope}>`],
      messages: [
        { role: "system", content: regenSystem },
        { role: "user", content: regenUser },
      ],
      signal: request.signal,
    });

    const parser = new SlideParser({ mode });
    parser.parseChunk(raw);
    parser.finalize();
    parser.clearAllGeneratingMarks();
    const fresh = parser.getAllSlides();
    if (fresh.length === 0) {
      return NextResponse.json(
        { error: "Model produced no section — try again." },
        { status: 502 },
      );
    }

    const replacement = fresh[0];
    // Preserve the original slide's identity: the parser seeds ids by
    // section index, so a single-section reparse collides with slide 1's id
    // (breaking image patching, React keys, and anchors).
    replacement.id = slideId;
    const iconQueries = collectIconQueries([replacement]);
    if (iconQueries.length > 0) {
      applyIconUrls(
        [replacement],
        await resolveIconQueries(iconQueries, {
          ollamaUrl: settings.llm.ollamaUrl,
          weight: settings.icons.weight,
        }),
      );
    }
    slides[index] = replacement;
    if (document.kind !== "doc") {
      // Scoped replan: only this slide gets a fresh archetype; neighbors'
      // persisted archetypes stay frozen as context.
      slides[index] = replanSlide(slides, index);
    }

    const imageRequests = collectImageRequests([replacement]);
    if (imageRequests.length > 0) {
      await db.generatedImage.createMany({
        data: imageRequests.map((req) => ({
          documentId,
          slideId: req.slideId,
          nodeId: req.nodeId,
          prompt: req.query,
          provider: settings.images.provider,
        })),
      });
    }
    await db.document.update({
      where: { id: documentId },
      data: { slides: JSON.stringify(slides) },
    });
    if (imageRequests.length > 0) kickImageQueue();

    setTimeout(() => {
      void import("@/lib/qa/run").then((m) =>
        m.runQualityCheck(documentId).catch(() => undefined),
      );
    }, 500);

    return NextResponse.json({
      slide: slides[index],
      imageCount: imageRequests.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  } finally {
    releaseGenerationLock(lockOwner);
  }
}
