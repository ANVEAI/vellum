/**
 * The quality gate's rewrite of one slide: what it asks for, and whether the
 * answer is kept.
 *
 * The gate used to resend the whole request with "regenerate slide N" and
 * the failing check appended. When the request is a detailed brief that
 * dictates every slide's text, the model regenerated exactly that text — a
 * 176-word slide came back as a 176-word slide — and the result replaced the
 * original unconditionally, so a rewrite that was no better, or worse, still
 * won. This asks for an edit of the slide as it stands, with a number, and
 * keeps the rewrite only when it measurably improves.
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { QaIssue } from "@/lib/qa/lint";
import { signatureOf } from "@/lib/design/archetypes";

function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; children?: unknown[] };
  if (typeof n.text === "string") return n.text;
  return (n.children ?? []).map(textOf).join(" ");
}

/** The slide as plain text, one top-level block per line. */
export function slidePlainText(slide: PlateSlide): string {
  return slide.content
    .map((node) => textOf(node).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** The user turn for a single-slide rewrite. */
export function condenseRequest(
  user: string,
  index: number,
  total: number,
  issue: Pick<QaIssue, "issue" | "suggestion">,
  current: PlateSlide,
  budget: number,
): string {
  const words = signatureOf(current).wordCount;
  return `${user}

# Rewrite slide ${index + 1} of ${total}

It failed a quality check: ${issue.issue}
${issue.suggestion}

The slide as it stands (${words} words):
"""
${slidePlainText(current) || "(empty)"}
"""

Write this slide again as ONE <SECTION>, in at most ${budget} words in total, heading included. The request above may give this slide far more text than that; do not reproduce it word for word — a slide longer than ${budget} words is cut off at the bottom edge of the canvas. Keep the claim the heading makes and the two or three points that matter most, and move the rest into <NOTES>. Use one component. Close every tag. No style, colour or size attributes.`;
}

type HardIssues = (slide: PlateSlide) => QaIssue[];

/**
 * Whether a rewrite is worth keeping. Fewer hard issues wins outright; with
 * the same number, the rewrite must be shorter, since length is what the
 * overflow check measures. Anything else keeps the original — a rewrite that
 * trades one fault for another, or comes back empty, is not an improvement.
 */
export function isImprovement(
  original: PlateSlide,
  candidate: PlateSlide,
  hardIssuesOf: HardIssues,
): boolean {
  const candidateWords = signatureOf(candidate).wordCount;
  if (candidateWords === 0) return false;
  const before = hardIssuesOf(original).length;
  const after = hardIssuesOf(candidate).length;
  if (after !== before) return after < before;
  return candidateWords < signatureOf(original).wordCount;
}
