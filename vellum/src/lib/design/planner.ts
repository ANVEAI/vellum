/**
 * Layout planner — assigns one archetype per slide.
 *
 * BACKWARD-LOOKING ONLY: archetype(slide i) depends on slides 0..i and never
 * on later slides or the total count. This makes the client streaming
 * preview prefix-stable (a finished slide's archetype never flips as later
 * slides arrive) and guarantees the preview converges to the server's
 * persisted plan — both run this same pure function over the same
 * deterministic parse.
 *
 * Single-slide regeneration replans only that slide, with its neighbors'
 * persisted archetypes passed in as frozen context.
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import {
  accepts,
  ARCHETYPE_WEIGHT,
  ROLE_TO_ARCHETYPE,
  signatureOf,
  type ArchetypeId,
  type ContentSignature,
} from "./archetypes";

export interface PlanContext {
  index: number;
  intent?: string;
  prevArchetype?: ArchetypeId;
  /** Consecutive dense slides immediately before this one. */
  denseRun: number;
}

const AGENDA_HEADING = /\b(agenda|contents|overview|outline|roadmap of|today)\b/i;

/** Pick the archetype for one slide. Pure. */
export function planSlide(
  sig: ContentSignature,
  ctx: PlanContext,
): ArchetypeId {
  const pick = (id: ArchetypeId): ArchetypeId | null =>
    accepts(id, sig) && id !== "content" && id === ctx.prevArchetype
      ? null // no immediate repeats for special archetypes
      : accepts(id, sig)
        ? id
        : null;

  // 1. First slide is the hero when its content allows it.
  if (ctx.index === 0) {
    if (accepts("hero", sig)) return "hero";
    return "content";
  }

  // 2. Honor the LLM's advisory role when content backs it up.
  if (ctx.intent) {
    const proposed = ROLE_TO_ARCHETYPE[ctx.intent];
    if (proposed && proposed !== "hero") {
      const validated = pick(proposed);
      if (validated) return validated;
    }
  }

  // 3. Content-driven inference, most specific first.
  if (ctx.index === 1 && AGENDA_HEADING.test(sig.headingText)) {
    const agenda = pick("agenda");
    if (agenda) return agenda;
  }
  const inferred =
    (sig.hasRootImage ? pick("testimonial") : null) ??
    pick("quote-full") ??
    (sig.isBackgroundLayout ? pick("full-bleed") : null) ??
    pick("kpi") ??
    pick("chart-focus") ??
    pick("statement") ??
    null;
  if (inferred) return inferred;

  // 4. Density relief: after 2+ dense slides, prefer a calmer treatment.
  if (ctx.denseRun >= 2) {
    const relief = pick("full-bleed") ?? pick("statement") ?? pick("divider");
    if (relief) return relief;
  }

  // 5. Workhorses.
  const workhorse =
    (sig.hasRootImage && !sig.isBackgroundLayout ? pick("split") : null) ??
    pick("three-up") ??
    null;
  if (workhorse) return workhorse;

  return "content";
}

/** Stamp archetypes across a deck (mutates copies, returns new array). */
export function planDeck(slides: PlateSlide[]): PlateSlide[] {
  let prev: ArchetypeId | undefined;
  let denseRun = 0;
  return slides.map((slide, index) => {
    const sig = signatureOf(slide);
    const archetype = planSlide(sig, {
      index,
      intent: slide.intent,
      prevArchetype: prev,
      denseRun,
    });
    denseRun = ARCHETYPE_WEIGHT[archetype] === "dense" ? denseRun + 1 : 0;
    prev = archetype;
    return { ...slide, archetype };
  });
}

/**
 * Surface rhythm (render-time, never persisted — theme-switch safe): when
 * the theme requests it, rotate slide surfaces by index so no two
 * consecutive slides share one. Full-bleed slides and explicit per-slide
 * bgColor are left alone.
 */
export function surfaceForSlide(
  structure: {
    surfaceRhythm?: boolean;
    surfaces?: Array<string | undefined>;
  },
  slide: PlateSlide,
  index: number | undefined,
): string | undefined {
  if (!structure.surfaceRhythm || !structure.surfaces?.length) return undefined;
  if (index === undefined || slide.bgColor) return undefined;
  if (slide.archetype === "full-bleed" || slide.layoutType === "background") {
    return undefined;
  }
  return structure.surfaces[index % structure.surfaces.length];
}

/** Replan exactly one slide in place; neighbors stay frozen. */
export function replanSlide(
  slides: PlateSlide[],
  index: number,
): PlateSlide {
  const slide = slides[index];
  const prev = slides[index - 1]?.archetype as ArchetypeId | undefined;
  const prevPrev = slides[index - 2]?.archetype as ArchetypeId | undefined;
  const denseRun =
    (prev && ARCHETYPE_WEIGHT[prev] === "dense" ? 1 : 0) +
    (prev &&
    prevPrev &&
    ARCHETYPE_WEIGHT[prev] === "dense" &&
    ARCHETYPE_WEIGHT[prevPrev] === "dense"
      ? 1
      : 0);
  const archetype = planSlide(signatureOf(slide), {
    index,
    intent: slide.intent,
    prevArchetype: prev,
    denseRun,
  });
  return { ...slide, archetype };
}

/**
 * Editor "try another layout": next valid archetype after the current one,
 * cycling through everything the content accepts.
 */
export function rerollArchetype(
  slide: PlateSlide,
  current: string | undefined,
): ArchetypeId {
  const sig = signatureOf(slide);
  const candidates: ArchetypeId[] = [
    "split",
    "three-up",
    "team-grid",
    "phase-cards",
    "kpi",
    "metric-bubbles",
    "chart-focus",
    "full-bleed",
    "statement",
    "testimonial",
    "divider",
    "quote-full",
    "agenda",
    "content",
  ].filter((id) => accepts(id as ArchetypeId, sig)) as ArchetypeId[];
  if (candidates.length === 0) return "content";
  const at = candidates.indexOf((current as ArchetypeId) ?? "content");
  return candidates[(at + 1) % candidates.length];
}
