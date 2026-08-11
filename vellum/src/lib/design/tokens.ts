/**
 * Design tokens — the three-layer contract between themes and the design
 * engine. Style (how it looks), structure (how slides are composed), and
 * content (how much goes on a slide, how charts behave).
 *
 * Resolution order: global defaults → family preset → derivations from the
 * theme object (radius tier, elevation, weights) → optional explicit
 * `theme.tokens` partial. Pure and side-effect free — safe for the client
 * streaming preview, server routes, and exporters alike.
 */
import type { ThemeProperties } from "@/lib/themes/data";
import { resolveFamily, type DesignFamily } from "./families";
import { scaleForFamily, type TypeScale } from "./type-scale";

export type CardPolicy = "cards" | "hairline" | "open";

export interface DesignTokens {
  family: DesignFamily;
  style: {
    scale: TypeScale;
    radiusTier: 0 | 1 | 2 | 3; // 0px | 4px | 12px | 20px
    elevation: "flat" | "soft" | "lifted";
    headingWeight: number;
    bodyWeight: number;
    /** CSS filter applied to all slide images — unifies mismatched
     *  generations into one graded set. */
    imageGrade: string;
    /** Gradient text fill for display headings (background-clip: text). */
    headingFill?: string;
  };
  structure: {
    cardPolicy: CardPolicy;
    /** Content/image split ratios the planner may use (content share in %). */
    allowedSplits: number[];
    /** Target share of empty canvas on standard content slides (0..1). */
    whitespace: number;
    /** Full-bleed overlay scrim strength (0..1). */
    scrim: number;
    maxItemsPerRow: number;
    /** Rotate slide surfaces so no two consecutive slides share one
     *  (Foolscap's signature). Consumed by the planner. */
    surfaceRhythm?: boolean;
    /** Surface rotation palette for surfaceRhythm; entry undefined = the
     *  theme's own canvas/gradient. */
    surfaces?: Array<string | undefined>;
  };
  content: {
    maxWordsPerSlide: number;
    maxItems: number;
    chart: {
      titles: boolean;
      valueLabels: boolean;
      numberFormat: "compact" | "plain";
    };
  };
}

export interface FamilyStatusColors {
  positive: string;
  negative: string;
  info: string;
  warning: string;
}

/** Semantic status colors (pros/cons, callouts, deltas) — themeable later. */
export const STATUS_COLORS: FamilyStatusColors = {
  positive: "#34c98e",
  negative: "#e2596f",
  info: "#4f8ef7",
  warning: "#f7b84f",
};

/**
 * Chart series fallback palette (slots 3+; slots 1-2 are accent/primary).
 * Single source of truth for build-option.ts and the PPTX exporter.
 */
export const SERIES_FALLBACK = ["#5EC9A9", "#E8B04E", "#D96C8A", "#6C9BD9"];

const FAMILY_PRESETS: Record<
  DesignFamily,
  { structure: DesignTokens["structure"]; content: DesignTokens["content"] }
> = {
  swiss: {
    structure: {
      cardPolicy: "hairline",
      allowedSplits: [66, 58],
      whitespace: 0.2,
      scrim: 0.6,
      maxItemsPerRow: 4,
    },
    content: {
      maxWordsPerSlide: 70,
      maxItems: 6,
      chart: { titles: true, valueLabels: true, numberFormat: "plain" },
    },
  },
  editorial: {
    structure: {
      cardPolicy: "open",
      allowedSplits: [58, 62],
      whitespace: 0.4,
      scrim: 0.65,
      maxItemsPerRow: 3,
    },
    content: {
      maxWordsPerSlide: 45,
      maxItems: 4,
      chart: { titles: true, valueLabels: true, numberFormat: "compact" },
    },
  },
  corporate: {
    structure: {
      cardPolicy: "cards",
      allowedSplits: [60, 58],
      whitespace: 0.3,
      scrim: 0.6,
      maxItemsPerRow: 4,
    },
    content: {
      maxWordsPerSlide: 60,
      maxItems: 5,
      chart: { titles: true, valueLabels: true, numberFormat: "compact" },
    },
  },
  bold: {
    structure: {
      cardPolicy: "open",
      allowedSplits: [58],
      whitespace: 0.55,
      scrim: 0.7,
      maxItemsPerRow: 3,
    },
    content: {
      maxWordsPerSlide: 28,
      maxItems: 3,
      chart: { titles: false, valueLabels: true, numberFormat: "compact" },
    },
  },
  organic: {
    structure: {
      cardPolicy: "cards",
      allowedSplits: [60, 55],
      whitespace: 0.35,
      scrim: 0.6,
      maxItemsPerRow: 3,
    },
    content: {
      maxWordsPerSlide: 55,
      maxItems: 5,
      chart: { titles: true, valueLabels: true, numberFormat: "compact" },
    },
  },
  tech: {
    structure: {
      cardPolicy: "cards",
      allowedSplits: [62, 58],
      whitespace: 0.25,
      scrim: 0.65,
      maxItemsPerRow: 4,
    },
    content: {
      maxWordsPerSlide: 50,
      maxItems: 6,
      chart: { titles: true, valueLabels: true, numberFormat: "compact" },
    },
  },
  /** Block-craft register (Meridian): hairline tiles on a near-black
   *  canvas, one elevated focus tier, medium density. */
  studio: {
    structure: {
      cardPolicy: "hairline",
      allowedSplits: [62, 58],
      whitespace: 0.3,
      scrim: 0.7,
      maxItemsPerRow: 4,
    },
    content: {
      maxWordsPerSlide: 48,
      maxItems: 5,
      chart: { titles: true, valueLabels: true, numberFormat: "compact" },
    },
  },
};

const RADIUS_BY_TIER: Record<DesignTokens["style"]["radiusTier"], number> = {
  0: 0,
  1: 4,
  2: 12,
  3: 20,
};

function radiusTierOf(cardRadius: string): DesignTokens["style"]["radiusTier"] {
  const n = parseFloat(cardRadius);
  const px = cardRadius.includes("rem") ? n * 16 : n;
  if (Number.isNaN(px) || px <= 2) return 0;
  if (px <= 8) return 1;
  if (px <= 16) return 2;
  return 3;
}

const FAMILY_WEIGHTS: Record<DesignFamily, { heading: number; body: number }> = {
  swiss: { heading: 700, body: 400 },
  editorial: { heading: 600, body: 400 },
  corporate: { heading: 700, body: 400 },
  bold: { heading: 800, body: 400 },
  organic: { heading: 700, body: 400 },
  tech: { heading: 700, body: 400 },
  studio: { heading: 700, body: 400 },
};

/** Deterministic per-family image grade — the CSS half of image cohesion. */
const FAMILY_GRADES: Record<DesignFamily, string> = {
  swiss: "saturate(0.55) contrast(1.06)",
  editorial: "saturate(0.78) contrast(1.05)",
  corporate: "saturate(0.94)",
  bold: "saturate(0.9) contrast(1.08) brightness(0.97)",
  organic: "saturate(0.96)",
  tech: "saturate(0.92) contrast(1.03)",
  studio: "saturate(0.85) contrast(1.08)",
};

export function resolveDesignTokens(
  theme: ThemeProperties,
  themeName?: string,
): DesignTokens {
  const family = resolveFamily(themeName, theme);
  const preset = FAMILY_PRESETS[family];
  const explicit = theme.tokens as Partial<DesignTokens> | undefined;

  const tokens: DesignTokens = {
    family,
    style: {
      scale: scaleForFamily(family),
      radiusTier: radiusTierOf(theme.borderRadius.card),
      elevation: theme.shadows.card ? "soft" : "flat",
      headingWeight:
        theme.fonts.headingWeight ?? FAMILY_WEIGHTS[family].heading,
      bodyWeight: theme.fonts.bodyWeight ?? FAMILY_WEIGHTS[family].body,
      imageGrade: FAMILY_GRADES[family],
    },
    structure: { ...preset.structure },
    content: {
      ...preset.content,
      chart: { ...preset.content.chart },
    },
  };

  if (explicit) {
    if (explicit.style) tokens.style = { ...tokens.style, ...explicit.style };
    if (explicit.structure)
      tokens.structure = { ...tokens.structure, ...explicit.structure };
    if (explicit.content) {
      tokens.content = {
        ...tokens.content,
        ...explicit.content,
        chart: { ...tokens.content.chart, ...(explicit.content.chart ?? {}) },
      };
    }
  }
  return tokens;
}

export function radiusPxForTier(
  tier: DesignTokens["style"]["radiusTier"],
): number {
  return RADIUS_BY_TIER[tier];
}

/**
 * The theme's designed slide surface: multi-layer gradient override when the
 * theme ships one, else the flat background color. Emitted as
 * `--presentation-surface`; SlideSurface/PrintSlide paint it inline.
 */
export function surfaceOf(theme: ThemeProperties): string {
  const bg = theme.background;
  if (bg?.override && bg.override.trim()) return bg.override.trim();
  if (bg?.gradient?.stops?.length) {
    const stops = bg.gradient.stops
      .map((s) => `${s.color} ${s.position}%`)
      .join(", ");
    if (bg.gradient.type === "radial") {
      const at = bg.gradient.at
        ? ` at ${bg.gradient.at.x}% ${bg.gradient.at.y}%`
        : "";
      return `radial-gradient(${bg.gradient.shape ?? "ellipse"}${at}, ${stops})`;
    }
    return `linear-gradient(${bg.gradient.angle ?? 135}deg, ${stops})`;
  }
  return theme.colors.background;
}
