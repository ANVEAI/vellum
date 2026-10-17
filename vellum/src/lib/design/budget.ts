/**
 * The per-slide word budget — one function, used by every layer that judges
 * how much a slide may hold.
 *
 * Four layers used to carry four numbers: the prompt (a hardcoded 60, ceiling
 * 90), the generation gate (a default 90), the post-run QA (the family token
 * times 1.15) and, after that was first unified, a prompt figure scaled by
 * density that the QA still did not scale. Each layer then measured something
 * different, so the model was told one limit and judged against another.
 */
import type { DesignTokens } from "./tokens";

export type TextDensity = "minimal" | "concise" | "detailed" | "extensive";

/**
 * Density scales the family's budget rather than replacing it: the wording
 * alone ("use short labels") carried no number, and a request for minimal
 * density on a 28-word family still produced 70-word slides.
 */
const DENSITY_FACTOR: Record<TextDensity, number> = {
  minimal: 0.6,
  concise: 1,
  detailed: 1.25,
  extensive: 1.5,
};

/** A slide title: the prompt asks for 6 to 15 words, and most run about eight. */
const HEADING_WORDS = 8;
/** A short point — a phrase with a few words of support, minimal density's unit. */
const POINT_WORDS = 5;

/**
 * The least a content slide carries, heading included: its title and two
 * points. Below it a slide is a heading and a line on a canvas built for
 * more — the 5-15 word slides of a minimal keynote, which filled 11-21% of
 * the canvas. Display layouts (cover, statement, divider, closing, quote)
 * are exempt: few words at display size is their design. So is a slide whose
 * chart, table, figures, diagram or picture carries it.
 */
export const CONTENT_FLOOR = HEADING_WORDS + 2 * POINT_WORDS;

/**
 * The least a budget may be: a title and four points. It used to be 18 — the
 * floor itself — so minimal density on the sparest family (28 x 0.6 = 17)
 * left the writer a ceiling equal to the bare minimum, and the model wrote
 * one-word bullets to stay under it. Density now shortens points without
 * squeezing a slide below what fills it.
 */
const MIN_BUDGET = HEADING_WORDS + 4 * POINT_WORDS;

function isDensity(value: unknown): value is TextDensity {
  return typeof value === "string" && value in DENSITY_FACTOR;
}

/** Words a standard content slide may carry, heading included. */
export function slideWordBudget(
  familyBase: number | undefined,
  density: TextDensity | string | undefined,
): number {
  const factor = DENSITY_FACTOR[isDensity(density) ? density : "concise"];
  return Math.max(MIN_BUDGET, Math.round((familyBase ?? 60) * factor));
}

/** The budget for a document, from its theme's tokens and its genParams. */
export function budgetFor(
  tokens: DesignTokens,
  genParamsJson: string | null | undefined,
): number {
  let density: unknown;
  try {
    density = genParamsJson
      ? (JSON.parse(genParamsJson) as { textDensity?: unknown }).textDensity
      : undefined;
  } catch {
    density = undefined;
  }
  return slideWordBudget(
    tokens.content.maxWordsPerSlide,
    isDensity(density) ? density : undefined,
  );
}
