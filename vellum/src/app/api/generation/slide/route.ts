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
import { promptInputFor } from "@/lib/generation/prompts/input";
import { replanSlide } from "@/lib/design/planner";
import { resolveDesignTokens } from "@/lib/design/tokens";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import { planPictures } from "@/lib/images/visual-plan";
import { keepAccentOf } from "@/lib/slides/emoji-accents";
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
    const { title, cards } = parseOutlineMarkdown(document.outline ?? "");
    const mode = document.kind === "doc" ? "document" : "deck";
    // The same budget, density, audience and template rule the whole deck
    // was written to, so a regenerated slide matches the slides around it.
    const tokens = resolveDesignTokens(
      resolveThemeOrDefault(document.themeName, null),
      document.themeName ?? undefined,
    );
    const promptInput = promptInputFor(
      document,
      { title, cards: cards.length ? cards : ["(no outline available)"] },
      tokens.content.maxWordsPerSlide,
    );
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

    const previous = slides[index];
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
      // persisted archetypes stay frozen as context. It also drops an image
      // prompt that asks for furniture, only a look, or a repeat.
      slides[index] = replanSlide(slides, index);
      // The same picture decision a whole deck gets, for this slide.
      if (settings.images.provider !== "none") {
        const pictures = await planPictures(slides, {
          capacity: tokens.content.maxWordsPerSlide,
          title: promptInput.title ?? document.title,
          request: document.prompt ?? "",
          llm: { baseUrl: settings.llm.ollamaUrl, model: settings.llm.model },
          only: [index],
          signal: request.signal,
        });
        if (pictures.changed.length > 0) {
          slides[index] = replanSlide(pictures.slides, index);
        }
      }
    }

    // The slide keeps its emoji accent, if it had one; the model's proposal
    // for the rewrite is not saved.
    slides[index] = keepAccentOf(previous, slides[index]);

    const imageRequests = collectImageRequests([slides[index]]);
    // The previous content's images are no longer wanted. Pending ones are
    // dropped so the GPU does not render them; one already running loses to
    // the jobs queued below, since only the newest job for a slot may write.
    await db.generatedImage
      .deleteMany({ where: { documentId, slideId, status: "pending" } })
      .catch(() => undefined);
    // Saved before the jobs exist: a job reads its slot's shape from the
    // saved slide, and the queue can pick a new row up the moment it lands.
    await db.document.update({
      where: { id: documentId },
      data: { slides: JSON.stringify(slides) },
    });
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
      kickImageQueue();
    }

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
