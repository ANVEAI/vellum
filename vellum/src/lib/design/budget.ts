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

/** Below this a content slide cannot hold a heading and two points. */
const MIN_BUDGET = 18;

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
