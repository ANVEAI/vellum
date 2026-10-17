/**
 * Modular type scale per design family, in slide-canvas pixels (1280×720).
 *
 * Explicit tuned values (not calc chains) so the scale is deterministic,
 * snapshot-testable, and convertible to PPTX points from the same numbers.
 *
 * Roles, as the stylesheet uses them: `display` for cover, closing, divider
 * and statement titles; `h1` for every other slide's title (the `.v-lead`
 * role); `h2`-`h4` for subheadings and the headings of cards, steps and
 * bullets; `body` for paragraphs; `small` for the text of items — bullets,
 * cards, steps, callouts, table cells; `caption` and `micro` for labels,
 * chart text and footnotes.
 *
 * The reading sizes — h3, h4, body and small — are about a sixth larger than
 * the Phase-2 values in LEGACY_SCALE (corporate body 17 to 20px, 12.5 to
 * 15pt in the PowerPoint export), and caption and micro a pixel larger.
 * Items were set at a fixed 15px on a 1280px canvas — web-page text on a
 * projected slide — so a 40-word slide filled a band across its middle and
 * read as empty however well it was written. Titles, display type and
 * numerals are unchanged. Measured over 169 slides in 16 decks: no slide
 * newly overflowed, and 17 autofit about one step smaller — 15 of them
 * carrying 50-92 words, the other two already shrunk before.
 */

export interface TypeScale {
  numeral: number; // oversized stat / ghost section number
  display: number; // statement & hero moments
  title: number; // presentation title (.v-title)
  h1: number; // slide titles (.v-lead on content layouts)
  h2: number;
  h3: number; // card, step and box headings
  h4: number; // bullet headings
  body: number; // .v-p
  small: number; // item text: bullets, cards, steps, callouts, tables
  caption: number;
  micro: number; // eyebrow/kicker, tracked uppercase
}

/**
 * The Phase-2 hardcoded values. No family renders them any more; the
 * PowerPoint exporter's point sizes were hand-tuned against them, so it
 * scales each tuned size by the ratio of a family's step to the step here.
 */
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
    h3: 25,
    h4: 21,
    body: 19,
    small: 18,
    caption: 14,
    micro: 12,
  },
  /** Editorial serif register (ratio ≈1.333). */
  editorial: {
    numeral: 170,
    display: 92,
    title: 68,
    h1: 46,
    h2: 33,
    h3: 27,
    h4: 21,
    body: 20,
    small: 19,
    caption: 14,
    micro: 12,
  },
  /** Default corporate: Phase-2 titles and display, reading sizes raised. */
  corporate: {
    numeral: 160,
    display: 84,
    title: 64,
    h1: 44,
    h2: 32,
    h3: 26,
    h4: 21,
    body: 20,
    small: 19,
    caption: 14,
    micro: 12,
  },
  /** Keynote / big-type (ratio ≈1.5). */
  bold: {
    numeral: 220,
    display: 110,
    title: 80,
    h1: 52,
    h2: 36,
    h3: 28,
    h4: 22,
    body: 21,
    small: 19,
    caption: 14,
    micro: 12,
  },
  /** Friendly, rounded (ratio ≈1.25) — education/health. */
  organic: {
    numeral: 150,
    display: 80,
    title: 60,
    h1: 42,
    h2: 31,
    h3: 26,
    h4: 21,
    body: 20,
    small: 19,
    caption: 14,
    micro: 12,
  },
  /** Bento/product (ratio ≈1.25, slightly tighter body). */
  tech: {
    numeral: 150,
    display: 78,
    title: 58,
    h1: 42,
    h2: 30,
    h3: 25,
    h4: 20,
    body: 19,
    small: 18,
    caption: 13,
    micro: 12,
  },
  /** Block-craft (ratio ≈1.3, tight tracking, confident but not shouty). */
  studio: {
    numeral: 165,
    display: 88,
    title: 62,
    h1: 44,
    h2: 31,
    h3: 26,
    h4: 21,
    body: 19,
    small: 18,
    caption: 14,
    micro: 12,
  },
};

export function scaleForFamily(family: string | undefined): TypeScale {
  return SCALES[family ?? "corporate"] ?? SCALES.corporate;
}

/** Optical tracking (em) by size — bigger type gets tighter tracking. */
export function trackingFor(px: number): number {
  if (px >= 120) return -0.03;
  if (px >= 72) return -0.022;
  if (px >= 48) return -0.015;
  if (px >= 28) return -0.008;
  return 0;
}
