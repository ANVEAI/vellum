/**
 * Modular type scale per design family, in slide-canvas pixels (1280×720).
 *
 * Explicit tuned values (not calc chains) so the scale is deterministic,
 * snapshot-testable, and convertible to PPTX points from the same numbers
 * (px ÷ 2 ≈ pt on the 13.33in×7.5in PowerPoint canvas at 96px/in).
 *
 * LEGACY_SCALE reproduces the pre-token hardcoded px values exactly — the
 * corporate family (and any slide without a resolved family) must render
 * pixel-identical to Phase 2 output.
 */

export interface TypeScale {
  numeral: number; // oversized stat / ghost section number
  display: number; // statement & hero moments
  title: number; // presentation title (.v-title)
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  body: number; // .v-p
  small: number; // .v-li, dense item text
  caption: number;
  micro: number; // eyebrow/kicker, tracked uppercase
}

/** Phase-2 hardcoded values — the compatibility baseline. */
export const LEGACY_SCALE: TypeScale = {
  numeral: 160,
  display: 84,
  title: 64,
  h1: 44,
  h2: 32,
  h3: 22,
  h4: 18,
  body: 17,
  small: 16,
  caption: 13,
  micro: 11,
};

export const SCALES: Record<string, TypeScale> = {
  /** Dense, analytical (ratio ≈1.2) — consulting/data decks. */
  swiss: {
    numeral: 140,
    display: 72,
    title: 56,
    h1: 40,
    h2: 30,
    h3: 21,
    h4: 18,
    body: 16,
    small: 15,
    caption: 13,
    micro: 11,
  },
  /** Editorial serif register (ratio ≈1.333). */
  editorial: {
    numeral: 170,
    display: 92,
    title: 68,
    h1: 46,
    h2: 33,
    h3: 23,
    h4: 18,
    body: 17,
    small: 16,
    caption: 13,
    micro: 11,
  },
  /** Default corporate — the legacy baseline. */
  corporate: LEGACY_SCALE,
  /** Keynote / big-type (ratio ≈1.5). */
  bold: {
    numeral: 220,
    display: 110,
    title: 80,
    h1: 52,
    h2: 36,
    h3: 24,
    h4: 19,
    body: 18,
    small: 16,
    caption: 13,
    micro: 11,
  },
  /** Friendly, rounded (ratio ≈1.25) — education/health. */
  organic: {
    numeral: 150,
    display: 80,
    title: 60,
    h1: 42,
    h2: 31,
    h3: 22,
    h4: 18,
    body: 17,
    small: 16,
    caption: 13,
    micro: 11,
  },
  /** Bento/product (ratio ≈1.25, slightly tighter body). */
  tech: {
    numeral: 150,
    display: 78,
    title: 58,
    h1: 42,
    h2: 30,
    h3: 21,
    h4: 17,
    body: 16,
    small: 15,
    caption: 12,
    micro: 11,
  },
  /** Block-craft (ratio ≈1.3, tight tracking, confident but not shouty). */
  studio: {
    numeral: 165,
    display: 88,
    title: 62,
    h1: 44,
    h2: 31,
    h3: 22,
    h4: 18,
    body: 16,
    small: 15,
    caption: 13,
    micro: 11,
  },
};

export function scaleForFamily(family: string | undefined): TypeScale {
  return SCALES[family ?? "corporate"] ?? LEGACY_SCALE;
}

/** Optical tracking (em) by size — bigger type gets tighter tracking. */
export function trackingFor(px: number): number {
  if (px >= 120) return -0.03;
  if (px >= 72) return -0.022;
  if (px >= 48) return -0.015;
  if (px >= 28) return -0.008;
  return 0;
}
