/**
 * Post-generation QA/QC: instant lint + LLM rubric critique (reuses the
 * schema-retry structured pipeline). Fire-and-forget after the generation
 * lock releases; status "reviewing" → "ready" with qualityReport JSON.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { generateStructuredWithRetries } from "@/lib/generation/llm/schema-retry";
import { lintSlides, type LintOptions, type QaIssue } from "./lint";
import { resolveDesignTokens } from "@/lib/design/tokens";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";

/** Token-driven lint budget: the family's word target with 50% headroom. */
export function lintOptionsFor(
  themeName: string | null,
  sourcesJson?: string | null,
): LintOptions {
  const theme = resolveThemeOrDefault(themeName, null);
  const tokens = resolveDesignTokens(theme, themeName ?? undefined);
  let sourceCount = 0;
  if (sourcesJson) {
    try {
      sourceCount = (JSON.parse(sourcesJson) as unknown[]).length;
    } catch {
      sourceCount = 0;
    }
  }
  return {
    // The 1.5x headroom existed because nothing could recover from overflow —
    // it was clip or nothing. Autofit now absorbs a modest overrun, so the
    // advisory can fire nearer the real budget.
    maxWordsPerSlide: Math.round(tokens.content.maxWordsPerSlide * 1.15),
    sourceCount,
  };
}

export interface QualityReport {
  score: number | null;
  lint: QaIssue[];
  critique: QaIssue[];
  strengths: string[];
  checkedAt: string;
}

const critiqueSchema = z.object({
  overallScore: z.number().min(1).max(10),
  strengths: z.array(z.string().min(4)).min(1).max(4),
  issues: z
    .array(
      z.object({
        slideNumber: z.number().int().min(1),
        severity: z.enum(["minor", "major"]),
        issue: z.string().min(8),
        suggestion: z.string().min(8),
      }),
    )
    .max(8),
});

function isText(n: Descendant): n is TText {
  return typeof (n as TText).text === "string" && !(n as TElement).type;
}
function textOf(nodes: Descendant[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => (isText(n) ? n.text : textOf((n as TElement).children)))
    .join(" ");
}

export async function runQualityCheck(documentId: string): Promise<void> {
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return;
  const slides = JSON.parse(document.slides) as PlateSlide[];
  const kind = document.kind === "doc" ? "doc" : "deck";

  const lint = lintSlides(
    slides,
    document.outline,
    kind,
    lintOptionsFor(document.themeName, document.sources),
  );
  const partial: QualityReport = {
    score: null,
    lint,
    critique: [],
    strengths: [],
    checkedAt: new Date().toISOString(),
  };
  await db.document.update({
    where: { id: documentId },
    data: { status: "reviewing", qualityReport: JSON.stringify(partial) },
  });

  try {
    const settings = await getSettings();
    const digest = slides
      .map((s, i) => `Slide ${i + 1}: ${textOf(s.content).slice(0, 320)}`)
      .join("\n");
    const result = await generateStructuredWithRetries({
      baseUrl: settings.llm.ollamaUrl,
      model: settings.llm.model,
      schema: critiqueSchema,
      messages: [
        {
          role: "system",
          content: `You are a ruthless presentation quality reviewer. Score the ${kind === "doc" ? "document" : "deck"} 1-10 and list concrete issues.
Rubric: clarity of narrative arc; substance (specific facts/numbers over platitudes); coverage of the outline; consistency of tone; slide-level focus (one idea each). Only report real, actionable issues (max 8). severity "major" = misleads or badly weakens the piece.`,
        },
        {
          role: "user",
          content: `Outline:\n${document.outline ?? "(none)"}\n\nContent digest:\n${digest}\n\nReview now.`,
        },
      ],
    });

    const critique: QaIssue[] = result.issues.map((issue) => ({
      slideId: slides[issue.slideNumber - 1]?.id ?? null,
      severity: issue.severity,
      code: "critique",
      issue: issue.issue,
      suggestion: issue.suggestion,
    }));
    const report: QualityReport = {
      score: result.overallScore,
      // Recompute on fresh slides: the image queue patches urls in while the
      // critique runs, so the opening lint snapshot goes stale.
      lint: await freshLint(documentId, kind, lint),
      critique,
      strengths: result.strengths,
      checkedAt: new Date().toISOString(),
    };
    await db.document.update({
      where: { id: documentId },
      data: { status: "ready", qualityReport: JSON.stringify(report) },
    });
  } catch {
    // Critique is best-effort; lint results stand alone.
    const report: QualityReport = {
      ...partial,
      lint: await freshLint(documentId, kind, lint),
      checkedAt: new Date().toISOString(),
    };
    await db.document.update({
      where: { id: documentId },
      data: { status: "ready", qualityReport: JSON.stringify(report) },
    });
  }
}

async function freshLint(
  documentId: string,
  kind: "deck" | "doc",
  fallback: QaIssue[],
): Promise<QaIssue[]> {
  try {
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { slides: true, outline: true, themeName: true, sources: true },
    });
    if (!doc) return fallback;
    return lintSlides(
      JSON.parse(doc.slides) as PlateSlide[],
      doc.outline,
      kind,
      lintOptionsFor(doc.themeName, doc.sources),
    );
  } catch {
    return fallback;
  }
}

/**
 * Recompute only the lint portion of an existing report — called when the
 * image queue drains for a document, so "image-pending" issues clear (or
 * stick, correctly, for failed jobs). Keeps score/critique/strengths.
 */
export async function refreshLintReport(documentId: string): Promise<void> {
  try {
    const document = await db.document.findUnique({ where: { id: documentId } });
    if (!document?.qualityReport) return;
    const report = JSON.parse(document.qualityReport) as QualityReport;
    report.lint = lintSlides(
      JSON.parse(document.slides) as PlateSlide[],
      document.outline,
      document.kind === "doc" ? "doc" : "deck",
      lintOptionsFor(document.themeName, document.sources),
    );
    report.checkedAt = new Date().toISOString();
    await db.document.update({
      where: { id: documentId },
      data: { qualityReport: JSON.stringify(report) },
    });
  } catch {
    // Best-effort refresh; the original report stands.
  }
}
