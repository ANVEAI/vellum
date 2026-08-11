import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { sseResponse } from "@/lib/sse";
import { streamChat } from "@/lib/generation/llm/ollama";
import { researchTopicWithSources } from "@/lib/generation/research/searxng";
import {
  buildOutlinePrompt,
  countOutlineCards,
  parseOutlineMarkdown,
} from "@/lib/generation/prompts/outline";
import { getTemplate } from "@/lib/templates/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenParams {
  nCards?: number;
  language?: string;
  tone?: string;
  audience?: string;
  webSearch?: boolean;
  importMode?: "verbatim" | "summarize";
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
  const settings = await getSettings();
  const genParams: GenParams = document.genParams
    ? (JSON.parse(document.genParams) as GenParams)
    : {};
  // The user's choice always wins. A template's blueprint supplies the
  // DEFAULT count (pre-filled in the create form) and the narrative arc; it is
  // not a cap. Reading template.sections.length here meant changing the slide
  // count on a template screen had no effect at all.
  const template = document.templateId
    ? getTemplate(document.templateId)
    : undefined;
  const nCards = genParams.nCards ?? template?.sections.length ?? 8;

  return sseResponse(
    async (sse) => {
      await db.document.update({
        where: { id: documentId },
        data: { status: "outlining", errorMessage: null },
      });

      // Imported source document (already framed on the row) takes priority
      // over live research; both can't sensibly ground the same outline.
      let researchContext = document.researchContext ?? "";
      if (!researchContext && genParams.webSearch !== false && settings.search.enabled) {
        sse.event("status", { status: "Researching your topic" });
        // Registry keeps URLs server-side; the model only ever sees the
        // numbered refs, preserving the injection-safe text stripping.
        const research = await researchTopicWithSources({
          searxngUrl: settings.search.searxngUrl,
          query: document.prompt ?? "",
          limit: settings.search.maxResults,
        });
        researchContext = research.context;
        if (researchContext) {
          await db.document.update({
            where: { id: documentId },
            data: {
              researchContext,
              sources: research.sources.length
                ? JSON.stringify(research.sources)
                : null,
            },
          });
        }
      }

      sse.event("status", { status: "Drafting the outline" });
      const { system, user } = buildOutlinePrompt({
        prompt: document.prompt ?? "",
        kind: document.kind === "doc" ? "doc" : "deck",
        nCards,
        language: genParams.language ?? "English",
        tone: genParams.tone,
        audience: genParams.audience,
        researchContext: researchContext || undefined,
        currentDate: new Date().toISOString().slice(0, 10),
        templateSections: template?.sections,
        templateGuidance: template?.globalGuidance,
        importMode: genParams.importMode,
      });

      let markdown = "";
      await streamChat({
        baseUrl: settings.llm.ollamaUrl,
        model: settings.llm.model,
        think: settings.llm.think,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal: request.signal,
        onDelta: (delta) => {
          markdown += delta;
          sse.event("chunk", { chunk: delta });
        },
      });

      // n-card enforcement. The requested count is a contract, so this both
      // tops up and trims — and it re-checks, because a single continuation
      // call can itself come back short.
      for (let attempt = 0; attempt < 2; attempt++) {
        const missing = nCards - countOutlineCards(markdown);
        if (missing <= 0) break;
        sse.event("status", {
          status: `Adding ${missing} more section${missing > 1 ? "s" : ""}`,
        });
        await streamChat({
          baseUrl: settings.llm.ollamaUrl,
          model: settings.llm.model,
          think: settings.llm.think,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
            { role: "assistant", content: markdown },
            {
              role: "user",
              content: `Continue the same outline by adding exactly ${missing} more "## " sections in the same format. Output only the new sections.`,
            },
          ],
          signal: request.signal,
          onDelta: (delta) => {
            markdown += delta;
            sse.event("chunk", { chunk: delta });
          },
        });
      }

      const parsed = parseOutlineMarkdown(markdown);
      const title = parsed.title;
      let cards = parsed.cards;
      // Over-delivery is just as wrong as under-delivery: the outline is what
      // the user reviews and what the content stage is held to.
      if (cards.length > nCards) {
        cards = cards.slice(0, nCards);
        markdown = [`# ${title}`, ...cards].join("\n\n");
      }
      await db.document.update({
        where: { id: documentId },
        data: {
          outline: markdown,
          title: title || document.title,
          status: "draft",
        },
      });
      sse.event("complete", { documentId, title, cardCount: cards.length });
    },
    { signal: request.signal },
  );
}
