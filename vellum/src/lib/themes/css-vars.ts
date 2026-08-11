/**
 * Ported from allweonedev/presentation-ai (MIT License) — see THIRD_PARTY_LICENSES.md.
 *
 * Pure mapping from a resolved `ThemeProperties` object to the
 * `--presentation-*` CSS custom properties the slide renderer reads.
 *
 * The variable names and value sources mirror the upstream DOM setter
 * (`setThemeVariables` in `src/lib/presentation/themes.ts`) exactly; this
 * module returns the map instead of mutating an element so it stays free of
 * browser/React dependencies. `--presentation-muted` is the one addition:
 * upstream only ships it as a static default in `presentation.css`, so it is
 * derived here from the theme's text and background colors.
 */

import type { ThemeProperties } from "@/lib/themes/data";
import {
  resolveDesignTokens,
  surfaceOf,
  STATUS_COLORS,
  SERIES_FALLBACK,
} from "@/lib/design/tokens";
import { trackingFor } from "@/lib/design/type-scale";

/** Portion of the body text color kept when deriving the muted color. */
const MUTED_TEXT_WEIGHT = 0.5;

function parseHexColor(color: string): [number, number, number] | null {
  let hex = color.trim();
  if (!hex.startsWith("#")) return null;
  hex = hex.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((channel) => channel + channel)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Derives a muted foreground color by blending the body text color toward the
 * slide background. The 50/50 blend lands close to the static Mystique
 * defaults in `presentation.css` (#a3a3b7 light / #8b89a7 dark). Non-hex
 * colors fall back to a CSS `color-mix()` expression so the browser blends.
 */
function deriveMutedColor(text: string, background: string): string {
  const textRgb = parseHexColor(text);
  const backgroundRgb = parseHexColor(background);

  if (!textRgb || !backgroundRgb) {
    return `color-mix(in srgb, ${text} ${MUTED_TEXT_WEIGHT * 100}%, ${background})`;
  }

  const toHex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  const mix = (index: 0 | 1 | 2) =>
    toHex(
      textRgb[index] * MUTED_TEXT_WEIGHT +
        backgroundRgb[index] * (1 - MUTED_TEXT_WEIGHT),
    );

  return `#${mix(0)}${mix(1)}${mix(2)}`;
}

/**
 * Font families must be quoted inside a custom property: an unquoted name
 * with a numeric segment ("Source Serif 4") is an invalid CSS identifier,
 * so the whole `font-family` declaration is dropped and the element
 * silently inherits the body face.
 */
function quoteFamily(family: string): string {
  const name = family.trim().replace(/^["']|["']$/g, "");
  return `"${name.replace(/"/g, "")}"`;
}

/**
 * Maps a resolved theme to the `--presentation-*` CSS custom properties.
 * Spread the result into a `style` object or apply it with
 * `element.style.setProperty` — the keys match the upstream variable names.
 */
export function themeToCssVars(
  theme: ThemeProperties,
  themeName?: string,
): Record<string, string> {
  const { colors, fonts, borderRadius, transitions, shadows, mask } = theme;
  const tokens = resolveDesignTokens(theme, themeName);
  const { scale } = tokens.style;

  const vars: Record<string, string> = {
    // ---- design-engine tokens (Phase 3) ----
    "--presentation-surface": surfaceOf(theme),
    "--presentation-unit": "8px",
    // Family density. `whitespace` (0.2 swiss … 0.55 bold) finally does
    // something: it scales every gap and the vertical text inset. Corporate
    // (0.3) is the identity, so legacy decks stay pixel-stable.
    "--v-density": String(
      Math.round((1 + (tokens.structure.whitespace - 0.3) * 0.6) * 1000) / 1000,
    ),
    // Spacing scale on an 8px grid, density-modulated. Replaces ten
    // uncoordinated literals (8/10/12/14/16/18/20/22/26/30px, five of them off
    // any grid) — the mechanical source of the "slightly off" feel. Emitted
    // here rather than on .v-slide so the document reader inherits it too.
    "--v-gap-1": `calc(8px * var(--v-density, 1))`,
    "--v-gap-2": `calc(12px * var(--v-density, 1))`,
    "--v-gap-3": `calc(16px * var(--v-density, 1))`,
    "--v-gap-4": `calc(24px * var(--v-density, 1))`,
    "--v-gap-5": `calc(32px * var(--v-density, 1))`,
    "--presentation-heading-weight": String(tokens.style.headingWeight),
    "--presentation-body-weight": String(tokens.style.bodyWeight),
    // Raw scale. The --presentation-fs-* names consumers use are derived from
    // these in slides.css, multiplied by --v-fit so a slide can shrink its own
    // type to fit without every rule having to know about it.
    "--v-fs-numeral": `${scale.numeral}px`,
    "--v-fs-display": `${scale.display}px`,
    "--v-fs-title": `${scale.title}px`,
    "--v-fs-h1": `${scale.h1}px`,
    "--v-fs-h2": `${scale.h2}px`,
    "--v-fs-h3": `${scale.h3}px`,
    "--v-fs-h4": `${scale.h4}px`,
    "--v-fs-body": `${scale.body}px`,
    "--v-fs-small": `${scale.small}px`,
    "--v-fs-caption": `${scale.caption}px`,
    "--v-fs-micro": `${scale.micro}px`,
    "--presentation-track-display": `${trackingFor(scale.display)}em`,
    "--presentation-track-title": `${trackingFor(scale.title)}em`,
    "--presentation-track-h1": `${trackingFor(scale.h1)}em`,
    "--presentation-img-grade": tokens.style.imageGrade || "none",
    ...(tokens.style.headingFill
      ? { "--presentation-heading-fill": tokens.style.headingFill }
      : {}),
    "--presentation-positive": STATUS_COLORS.positive,
    "--presentation-negative": STATUS_COLORS.negative,
    "--presentation-info": STATUS_COLORS.info,
    "--presentation-warning": STATUS_COLORS.warning,
    "--presentation-series-3": theme.chartSeries?.[2] ?? SERIES_FALLBACK[0],
    "--presentation-series-4": theme.chartSeries?.[3] ?? SERIES_FALLBACK[1],
    "--presentation-series-5": theme.chartSeries?.[4] ?? SERIES_FALLBACK[2],
    "--presentation-series-6": theme.chartSeries?.[5] ?? SERIES_FALLBACK[3],
    "--presentation-numeric-font": quoteFamily(
      theme.fonts.numeric ?? theme.fonts.heading,
    ),
    // ---- upstream-mirrored variables ----
    "--presentation-primary": colors.primary,
    "--presentation-accent": colors.accent,
    // Upstream maps the secondary slot to the accent color (ThemeColors has
    // no dedicated secondary channel).
    "--presentation-secondary": colors.accent,
    "--presentation-background": colors.background,
    "--presentation-text": colors.text,
    "--presentation-heading": colors.heading,
    "--presentation-smart-layout": colors.smartLayout,
    "--presentation-card-background": colors.cardBackground,
    "--presentation-muted": deriveMutedColor(colors.text, colors.background),
    "--presentation-heading-font": quoteFamily(fonts.heading),
    "--presentation-body-font": quoteFamily(fonts.body),
    "--presentation-card-border-radius": borderRadius.card,
    "--presentation-slide-border-radius": borderRadius.slide,
    "--presentation-button-border-radius": borderRadius.button,
    "--presentation-transition": transitions.default,
    "--presentation-card-shadow": shadows.card,
    "--presentation-button-shadow": shadows.button,
    "--presentation-slide-shadow": shadows.slide,
  };

  if (mask) {
    if (mask.clipPath) vars["--presentation-mask-clip-path"] = mask.clipPath;
    if (mask.maskImage) vars["--presentation-mask-image"] = mask.maskImage;
    if (mask.maskSize) vars["--presentation-mask-size"] = mask.maskSize;
    if (mask.maskPosition)
      vars["--presentation-mask-position"] = mask.maskPosition;
    if (mask.maskRepeat) vars["--presentation-mask-repeat"] = mask.maskRepeat;
  }

  return vars;
}
