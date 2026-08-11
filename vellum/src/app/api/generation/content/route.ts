import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { sseResponse } from "@/lib/sse";
import { chatOnce, streamChat } from "@/lib/generation/llm/ollama";
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
import { applyImageToSlides } from "@/lib/images/patch-slides";
import { resolveIconQueries } from "@/lib/icons/search";
import { kickImageQueue } from "@/lib/generation/pipeline/asset-queue";
import { formatTemplateGuidance, getTemplate } from "@/lib/templates/library";
import { planDeck, replanSlide } from "@/lib/design/planner";
import { lintSlides } from "@/lib/qa/lint";
import { buildSourcesSlide, slideRefs } from "@/lib/slides/citations";
import type { DeckSource } from "@/lib/generation/research/searxng";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenParams {
  language?: string;
  tone?: string;
  audience?: string;
  textDensity?: "minimal" | "concise" | "detailed" | "extensive";
}

export async function POST(request: NextRequest) {
  await ensureWal();
  const { documentId } = (await request.json().catch(() => ({}))) as {
    documentId?: string;
  };
  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (!document.outline) {
    return NextResponse.json(
      { error: "Generate an outline first" },
      { status: 400 },
    );
  }

  const lockOwner = `content:${documentId}:${Date.now()}`;
  if (!acquireGenerationLock(lockOwner)) {
    return NextResponse.json(
      {
        error:
          "Another generation is already running. The local model handles one at a time — retry when it finishes.",
      },
      { status: 409 },
    );
  }

  const settings = await getSettings();
  const genParams: GenParams = document.genParams
    ? (JSON.parse(document.genParams) as GenParams)
    : {};
  const { title, cards } = parseOutlineMarkdown(document.outline);
  const mode = document.kind === "doc" ? "document" : "deck";
  const template = document.templateId
    ? getTemplate(document.templateId)
    : undefined;

  return sseResponse(
    async (sse) => {
      // Parser contract (matches upstream usage): reset + full re-parse +
      // finalize produces a complete snapshot; deterministic ids keep slide
      // identity stable across re-parses. getAllSlides() without reset
      // accumulates duplicates and must never be used incrementally.
      let cumulative = "";
      const snapshotSlides = () => {
        const parser = new SlideParser({ mode });
        parser.parseChunk(cumulative);
        parser.finalize();
        parser.clearAllGeneratingMarks();
        // Decks get archetypes stamped by the layout planner (deterministic,
        // backward-looking — matches the client streaming preview exactly).
        const slides = parser.getAllSlides();
        return mode === "deck" ? planDeck(slides) : slides;
      };
      try {
        await db.document.update({
          where: { id: documentId },
          data: { status: "generating", errorMessage: null },
        });

        const promptInput = {
          prompt: document.prompt ?? "",
          title: document.title !== "Untitled" ? document.title : title,
          outline: cards,
          language: genParams.language ?? "English",
          tone: genParams.tone,
          audience: genParams.audience,
          textDensity: genParams.textDensity,
          researchContext: document.researchContext ?? undefined,
          sourceCount: (() => {
            try {
              return document.sources
                ? (JSON.parse(document.sources) as unknown[]).length
                : 0;
            } catch {
              return 0;
            }
          })(),
          currentDate: new Date().toISOString().slice(0, 10),
          templateGuidance: template
            ? formatTemplateGuidance(template)
            : undefined,
        };
        const { system, user } =
          mode === "document"
            ? buildDocumentPrompt(promptInput)
            : buildDeckPrompt(promptInput);

        sse.event("status", {
          status:
            mode === "document"
              ? "Writing your document"
              : "Designing your slides",
        });

        let sectionsSeen = 0;

        // Per-section image kickoff: enqueue a section's image jobs the
        // moment its </SECTION> closes so GPU work overlaps the text stream
        // instead of serializing after it. The Set both dedupes across ticks
        // and guards the final post-stream enqueue.
        const enqueuedImages = new Set<string>();
        const enqueueNewImages = async (source?: ReturnType<typeof snapshotSlides>) => {
          const requests = collectImageRequests(source ?? snapshotSlides()).filter(
            (req) => {
              const key = `${req.slideId}|${req.nodeId}`;
              if (enqueuedImages.has(key)) return false;
              enqueuedImages.add(key);
              return true;
            },
          );
          if (requests.length === 0) return;
          await db.generatedImage.createMany({
            data: requests.map((req) => ({
              documentId,
              slideId: req.slideId,
              nodeId: req.nodeId,
              prompt: req.query,
              provider: settings.images.provider,
            })),
          });
          kickImageQueue();
        };

        let raw = await streamChat({
          baseUrl: settings.llm.ollamaUrl,
          model: settings.llm.model,
          think: settings.llm.think,
          stop: ["</PRESENTATION>", "</DOCUMENT>"],
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          signal: request.signal,
          onDelta: (delta) => {
            cumulative += delta;
            sse.event("chunk", { chunk: delta });
            // Cheap progress signal; the client runs the real parser.
            const closed = (cumulative.match(/<\/SECTION>/g) ?? []).length;
            if (closed > sectionsSeen) {
              sectionsSeen = closed;
              sse.event("progress", {
                sections: sectionsSeen,
                total: cards.length,
              });
              void enqueueNewImages().catch(() => undefined);
            }
          },
        });

        let slides = snapshotSlides();

        // Envelope-level retry: occasionally the model skips the SECTION
        // wrappers (content directly under the root) or stops early — the
        // parse then yields zero/few slides. One corrective re-ask fixes it;
        // otherwise fail loudly instead of persisting a near-empty document.
        const minAcceptable = Math.max(1, Math.ceil(cards.length / 3));
        if (slides.length < minAcceptable) {
          sse.event("status", {
            status: "Output was incomplete — regenerating",
          });
          const envelope = mode === "document" ? "DOCUMENT" : "PRESENTATION";
          const correction = `Your previous output was invalid: the parser found ${slides.length} <SECTION> element${slides.length === 1 ? "" : "s"}. Every piece of content MUST be inside its own <SECTION>...</SECTION> element (${
            mode === "document"
              ? "one per chapter; the first starts with <TITLE>, later ones with <H1>"
              : "one per slide"
          }) — never directly under the root. Regenerate the complete ${
            mode === "document" ? "document" : "presentation"
          } now: exactly ${cards.length} SECTIONs inside one <${envelope}> root, valid XML only, no commentary.`;
          const retryRaw = await chatOnce({
            baseUrl: settings.llm.ollamaUrl,
            model: settings.llm.model,
            think: settings.llm.think,
            stop: [`</${envelope}>`],
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
              { role: "assistant", content: raw },
              { role: "user", content: correction },
            ],
            signal: request.signal,
          });
          cumulative = retryRaw;
          raw = retryRaw;
          // Attempt-1 image jobs reference slide ids that no longer exist.
          await db.generatedImage
            .deleteMany({ where: { documentId, status: "pending" } })
            .catch(() => undefined);
          enqueuedImages.clear();
          slides = snapshotSlides();
          if (slides.length < minAcceptable) {
            throw new Error(
              `Generation produced ${slides.length} of ${cards.length} sections even after a retry — try again.`,
            );
          }
        }

        // Ceiling: the outline is the contract the user approved, so an
        // over-eager model does not get to add slides they did not ask for.
        // Only a floor was enforced before, which is how asking for 6 slides
        // could still yield 7. Sections are emitted in outline order, so the
        // surplus is always at the tail.
        if (slides.length > cards.length) {
          const dropped = slides.length - cards.length;
          slides = slides.slice(0, cards.length);
          for (const slide of snapshotSlides().slice(cards.length)) {
            enqueuedImages.delete(slide.id);
          }
          await db.generatedImage
            .deleteMany({
              where: {
                documentId,
                slideId: { notIn: slides.map((s) => s.id) },
                status: "pending",
              },
            })
            .catch(() => undefined);
          sse.event("status", {
            status: `Trimmed ${dropped} extra ${mode === "document" ? "section" : "slide"}${dropped === 1 ? "" : "s"}`,
          });
        }

        // Hybrid QA gate: hard per-slide failures regenerate in-loop before
        // the user ever sees them — empty slides, broken chart data, lazy
        // topic-label headings, and evidence-free slides. Bounded: at most
        // 3 slides, one attempt each; failures keep the original.
        const HARD_CODES = new Set([
          "empty",
          "bad-chart-data",
          "topic-heading",
          "no-quantification",
        ]);
        const hardIssues = lintSlides(
          slides,
          document.outline,
          mode === "document" ? "doc" : "deck",
        ).filter((issue) => issue.slideId && HARD_CODES.has(issue.code));
        const gateTargets = [
          ...new Map(hardIssues.map((i) => [i.slideId as string, i])).entries(),
        ].slice(0, 3);
        if (gateTargets.length > 0) {
          sse.event("status", {
            status: `Refining ${gateTargets.length} weak slide${gateTargets.length > 1 ? "s" : ""}`,
          });
          const envelope = mode === "document" ? "DOCUMENT" : "PRESENTATION";
          for (const [slideId, issue] of gateTargets) {
            const index = slides.findIndex((s) => s.id === slideId);
            if (index === -1) continue;
            try {
              const regenRaw = await chatOnce({
                baseUrl: settings.llm.ollamaUrl,
                model: settings.llm.model,
                think: settings.llm.think,
                stop: [`</${envelope}>`],
                messages: [
                  {
                    role: "system",
                    content: `${system}\n\n# SINGLE-SECTION OVERRIDE\nYou are regenerating ONE ${mode === "document" ? "section" : "slide"} of an existing ${mode}. Output exactly ONE <SECTION>...</SECTION> element inside a single <${envelope}> root — no other sections, no commentary.`,
                  },
                  {
                    role: "user",
                    content: `${user}\n\n# Regenerate ${mode === "document" ? "section" : "slide"} ${index + 1} of ${slides.length}.\nIt failed a quality check: ${issue.issue}\n${issue.suggestion}`,
                  },
                ],
                signal: request.signal,
              });
              const gateParser = new SlideParser({ mode });
              gateParser.parseChunk(regenRaw);
              gateParser.finalize();
              gateParser.clearAllGeneratingMarks();
              const fresh = gateParser.getAllSlides();
              if (fresh.length > 0) {
                const fixed = fresh[0];
                fixed.id = slideId;
                slides[index] = fixed;
                if (mode === "deck") slides[index] = replanSlide(slides, index);
              }
            } catch {
              // Keep the original slide; the Quality panel will surface it.
            }
          }
          await enqueueNewImages(slides).catch(() => undefined);
        }

        // Icons resolve synchronously — semantic search is milliseconds and
        // makes the first render complete.
        sse.event("status", { status: "Matching icons" });
        const iconQueries = collectIconQueries(slides);
        if (iconQueries.length > 0) {
          const iconUrls = await resolveIconQueries(iconQueries, {
            ollamaUrl: settings.llm.ollamaUrl,
            weight: settings.icons.weight,
          });
          applyIconUrls(slides, iconUrls);
        }

        // Any images the per-section kickoff missed (Set-guarded).
        await enqueueNewImages().catch(() => undefined);

        // Sources appendix: only when the deck actually cited something.
        if (mode === "deck" && document.sources) {
          try {
            const registry = JSON.parse(document.sources) as DeckSource[];
            const cited = new Set<number>();
            for (const slide of slides) {
              for (const ref of slideRefs(slide, registry.length)) {
                cited.add(ref);
              }
            }
            if (cited.size > 0) {
              slides.push(
                buildSourcesSlide(
                  registry.filter((source) => cited.has(source.ref)),
                ),
              );
            }
          } catch {
            // Malformed registry — skip the appendix, never fail generation.
          }
        }

        // Jobs that finished DURING the stream patched a stale document —
        // reconcile their urls into the final slide snapshot before persist.
        const doneJobs = await db.generatedImage.findMany({
          where: { documentId, status: "done", path: { not: null } },
          select: { slideId: true, nodeId: true, prompt: true, path: true },
        });
        for (const job of doneJobs) {
          if (!job.slideId || !job.path) continue;
          applyImageToSlides(
            slides,
            job.slideId,
            job.nodeId,
            job.prompt,
            `/api/images/file/${job.path}`,
          );
        }

        await db.document.update({
          where: { id: documentId },
          data: {
            slides: JSON.stringify(slides),
            rawXml: raw,
            status: "ready",
          },
        });
        if (enqueuedImages.size > 0) kickImageQueue();

        sse.event("complete", {
          documentId,
          slideCount: slides.length,
          imageCount: enqueuedImages.size,
        });
        // Post-generation QA/QC runs after the lock releases (finally below);
        // defer to the next tick so the critique's LLM call doesn't contend.
        setTimeout(() => {
          void import("@/lib/qa/run").then((m) =>
            m.runQualityCheck(documentId).catch(() => undefined),
          );
        }, 500);
      } catch (error) {
        const aborted =
          error instanceof Error &&
          (error.name === "AbortError" || request.signal.aborted);
        // Client went away mid-stream: keep whatever sections completed
        // rather than flagging the document as failed.
        const partial = snapshotSlides();
        if (aborted && partial.length > 0) {
          await db.document
            .update({
              where: { id: documentId },
              data: {
                slides: JSON.stringify(partial),
                rawXml: cumulative,
                status: "ready",
              },
            })
            .catch(() => undefined);
          return;
        }
        await db.document
          .update({
            where: { id: documentId },
            data: {
              status: "error",
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
          })
          .catch(() => undefined);
        throw error;
      } finally {
        releaseGenerationLock(lockOwner);
      }
    },
    { signal: request.signal },
  );
}
