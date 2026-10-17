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

Write this slide again as ONE <SECTION>, in at most ${budget} words in total, heading included. The request above may give this slide far more text than that; do not reproduce it word for word — a slide longer than ${budget} words is cut off at the bottom edge of the canvas. Keep the claim the heading makes and the two or three points that matter most, and move the rest into <NOTES>. Use one component. Close every tag. No style, colour or size attributes. Never invent a number: use only figures that appear in the request, the outline or the reference material — a slide with no real figure stays without one.

Output the slide itself and nothing about it. Never describe what you changed — no "Removed…", "Reordered…", "Here is the revised slide" — and never write "Slide ${index + 1}" anywhere in it: the audience sees every word you write.`;
}

/**
 * The user turn for rewriting a thin slide (`sparse-slide`).
 *
 * The request above asks for less and moves the rest into the notes — the
 * opposite of what a thin slide needs, since a minimal deck's thin slides
 * already keep their substance there: "Autocomplete / Copilot / Agent" on
 * the slide, "from text completion, to a partner that writes code, to an
 * agent that executes tasks" in the notes. This asks for that substance back
 * on the slide, set in a component that carries it, and for nothing the
 * notes, the outline or the request do not already say.
 */
export function enrichRequest(
  user: string,
  index: number,
  total: number,
  issue: Pick<QaIssue, "issue">,
  current: PlateSlide,
  floor: number,
  budget: number,
): string {
  const words = signatureOf(current).wordCount;
  const notes = current.speakerNote?.trim();
  return `${user}

# Rewrite slide ${index + 1} of ${total}

It failed a quality check: ${issue.issue}

The slide as it stands (${words} words):
"""
${slidePlainText(current) || "(empty)"}
"""
${notes ? `\nIts speaker notes:\n"""\n${notes}\n"""\n` : ""}
Write this slide again as ONE <SECTION>, in ${floor} to ${budget} words in total, heading included. Keep its subject, and make the heading the slide's claim as a full sentence. Take the substance from the speaker notes above and from this slide's entry in the outline: each point is a short phrase with a few words that explain it or give an example, never a bare label. Choose the component that fits the content: STEPS or ARROWS for a sequence or an evolution, BOXES or ICONS for two to four parallel ideas, COMPARE for two sides, BULLETS for points that each need a sentence. Write new <NOTES> for what stays spoken. Close every tag. No style, colour or size attributes. Never invent a number, a name, a date or a fact: use only what the notes, the outline, the request or the reference material say.

Output the slide itself and nothing about it. Never describe what you changed — no "Added…", "Expanded…", "Here is the revised slide" — and never write "Slide ${index + 1}" anywhere in it: the audience sees every word you write.`;
}

type HardIssues = (slide: PlateSlide) => QaIssue[];

/** Words that carry no topic of their own. */
const FUNCTION_WORDS = new Set(
  "the and but for with from into onto over under about after before than then that this these those there their they them your you our ours its his her who whom what when where which while why how all any each every some such only just not nor are was were been being has have had does did can could will would should may might must also very more most less least out off per via".split(
    " ",
  ),
);

function topicWords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’&-]*/gu) ?? []).filter(
      (w) => w.length > 2 && !FUNCTION_WORDS.has(w),
    ),
  );
}

/**
 * Whether the rewrite is still this slide: at least half of what it talks
 * about comes from the slide it replaces, its speaker notes, or the outline
 * entry it was written from. A condensed slide draws on those and little
 * else; an answer about the edit ("Removed duplicate entries. Reordered list
 * for clarity.") or another slide's content does not.
 */
function staysOnTopic(
  original: PlateSlide,
  candidate: PlateSlide,
  reference: string,
): boolean {
  const said = topicWords(slidePlainText(candidate));
  if (said.size === 0) return false;
  const source = topicWords(
    `${slidePlainText(original)}\n${original.speakerNote ?? ""}\n${reference}`,
  );
  let shared = 0;
  for (const word of said) if (source.has(word)) shared += 1;
  return shared * 2 >= said.size;
}

/** Share of topic words two headings have in common (Jaccard). */
function headingOverlap(a: string, b: string): number {
  const left = topicWords(a);
  const right = topicWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Two headings are the same heading when most of their topic words are
 * shared: "AI Today: Trends, Voice AI & Your Future" and "AI Today: Voice AI
 * & Your Future" are; "What we'll cover in the next hour" and either are not.
 */
const SAME_HEADING = 0.6;

function hasTitleElement(slide: PlateSlide): boolean {
  return slide.content.some(
    (node) => (node as { type?: string }).type === "presentation-title",
  );
}

export interface RewriteContext {
  /** The outline entry the slide was written from. */
  reference?: string;
  /** The deck title and every other slide's heading. */
  elsewhere?: string[];
}

/**
 * Whether a rewrite is worth keeping. Fewer hard issues wins outright; with
 * the same number, the rewrite must be shorter, since length is what the
 * overflow check measures. Anything else keeps the original — a rewrite that
 * trades one fault for another, or comes back empty, is not an improvement.
 *
 * Fewer issues is necessary, not sufficient. Asked to fix a slide, the model
 * once answered with a single callout — "Slide 9: Removed duplicate
 * 'Accounting & audit' entries. Reordered list for clarity." No heading and
 * twelve words meant no overflow, no topic heading and no repeats, so it won
 * and became the slide. Asked to shorten an agenda, it wrote the deck's
 * title slide again; the six parts of the agenda were gone and the deck had
 * two covers. A rewrite must keep the heading the original had, stay on the
 * original's topic, and still be this slide rather than another one: no title
 * element the original did not have, and no heading that is the deck's title
 * or another slide's.
 */
export function isImprovement(
  original: PlateSlide,
  candidate: PlateSlide,
  hardIssuesOf: HardIssues,
  context: RewriteContext = {},
): boolean {
  const candidateWords = signatureOf(candidate).wordCount;
  if (candidateWords === 0) return false;
  const originalHeading = signatureOf(original).headingText;
  const candidateHeading = signatureOf(candidate).headingText;
  if (originalHeading && !candidateHeading) return false;
  if (hasTitleElement(candidate) && !hasTitleElement(original)) return false;
  const own = headingOverlap(candidateHeading, originalHeading);
  for (const heading of context.elsewhere ?? []) {
    const other = headingOverlap(candidateHeading, heading);
    if (other >= SAME_HEADING && other > own) return false;
  }
  if (!staysOnTopic(original, candidate, context.reference ?? "")) return false;
  const before = hardIssuesOf(original).length;
  const after = hardIssuesOf(candidate).length;
  if (after !== before) return after < before;
  return candidateWords < signatureOf(original).wordCount;
}
