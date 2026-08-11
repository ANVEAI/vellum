/**
 * Slide archetypes: named compositions applied via [data-archetype] CSS.
 * An archetype changes the slide FRAME (where the content column sits, how
 * large the lead heading renders, decoration, image treatment) — it never
 * reorders content blocks, so the DOM-measuring PPTX exporter keeps working.
 *
 * Slides without an archetype render exactly as Phase 2 (legacy path).
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";

export type ArchetypeId =
  | "hero"
  | "agenda"
  | "divider"
  | "statement"
  | "quote-full"
  | "full-bleed"
  | "split"
  | "three-up"
  | "kpi"
  | "chart-focus"
  | "closing"
  | "team-grid"
  | "testimonial"
  | "phase-cards"
  | "metric-bubbles"
  | "content";

/** Cadence class: breath slides reset density fatigue. */
export type ArchetypeWeight = "breath" | "standard" | "dense";

export const ARCHETYPE_WEIGHT: Record<ArchetypeId, ArchetypeWeight> = {
  hero: "breath",
  agenda: "standard",
  divider: "breath",
  statement: "breath",
  "quote-full": "breath",
  "full-bleed": "breath",
  split: "standard",
  "three-up": "standard",
  kpi: "dense",
  "chart-focus": "dense",
  closing: "breath",
  "team-grid": "standard",
  testimonial: "breath",
  "phase-cards": "standard",
  "metric-bubbles": "dense",
  content: "standard",
};

/** Roles the LLM may propose; anything else is ignored. */
export const ROLE_TO_ARCHETYPE: Record<string, ArchetypeId> = {
  hero: "hero",
  cover: "hero",
  agenda: "agenda",
  divider: "divider",
  section: "divider",
  statement: "statement",
  "big-number": "statement",
  quote: "quote-full",
  "full-bleed": "full-bleed",
  kpi: "kpi",
  metrics: "metric-bubbles",
  comparison: "content",
  roadmap: "phase-cards",
  phases: "phase-cards",
  team: "team-grid",
  testimonial: "testimonial",
  closing: "closing",
  cta: "closing",
  "thank-you": "closing",
};

/** Structural summary of one slide, derivable in O(nodes), no DOM. */
export interface ContentSignature {
  wordCount: number;
  types: string[];
  groupItemCount: number;
  hasRootImage: boolean;
  isBackgroundLayout: boolean;
  statCount: number;
  hasChart: boolean;
  hasQuoteOnly: boolean;
  hasTable: boolean;
  headingText: string;
}

function isText(n: Descendant): n is TText {
  return typeof (n as TText).text === "string" && !(n as TElement).type;
}
function textOf(nodes: Descendant[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => (isText(n) ? n.text : textOf((n as TElement).children)))
    .join(" ");
}

const GROUPS = new Set([
  "bullets",
  "icons",
  "boxes",
  "steps",
  "timeline",
  "cycle",
  "pyramid",
  "staircase",
  "compare",
  "before-after",
  "pros-cons",
  "stats",
  "arrow-vertical",
  "arrows",
  "snake",
  "circular-grid",
  "connected-circles",
  "slope",
]);

export function signatureOf(slide: PlateSlide): ContentSignature {
  const els = slide.content.filter(
    (n): n is TElement => typeof (n as TElement).type === "string",
  );
  const types = els.map((e) => String(e.type));
  const words = textOf(slide.content as Descendant[])
    .split(/\s+/)
    .filter(Boolean).length;
  let groupItems = 0;
  let statCount = 0;
  for (const el of els) {
    const type = String(el.type);
    if (GROUPS.has(type)) {
      const items = (el.children ?? []).filter((c) => !isText(c)).length;
      groupItems = Math.max(groupItems, items);
      if (type === "stats") statCount = items;
    }
  }
  const contentTypes = types.filter(
    (t) => !["label", "contributor", "img"].includes(t),
  );
  const heading = els.find((e) =>
    ["presentation-title", "h1", "h2"].includes(String(e.type)),
  );
  return {
    wordCount: words,
    types,
    groupItemCount: groupItems,
    hasRootImage: Boolean(
      (slide.rootImage as { query?: string; url?: string } | undefined)
        ?.query ||
        (slide.rootImage as { url?: string } | undefined)?.url,
    ),
    isBackgroundLayout: slide.layoutType === "background",
    statCount,
    hasChart: types.some((t) => t.startsWith("chart-")),
    hasQuoteOnly:
      contentTypes.length > 0 &&
      contentTypes.every((t) =>
        ["quote", "blockquote", "h2", "h3", "p"].includes(t),
      ) &&
      types.includes("quote"),
    hasTable: types.includes("table"),
    headingText: heading ? textOf(heading.children).trim() : "",
  };
}

/** Content validity: can this slide actually wear this archetype? */
export function accepts(id: ArchetypeId, sig: ContentSignature): boolean {
  switch (id) {
    case "hero":
    case "closing":
      return sig.wordCount <= 70 && !sig.hasChart && !sig.hasTable;
    case "agenda":
      return (
        sig.types.includes("bullets") &&
        sig.groupItemCount >= 3 &&
        sig.groupItemCount <= 8 &&
        !sig.hasChart
      );
    case "divider":
      return sig.wordCount <= 45 && sig.groupItemCount === 0 && !sig.hasChart;
    case "statement":
      return (
        (sig.wordCount <= 30 && sig.groupItemCount === 0) ||
        (sig.statCount === 1 && sig.wordCount <= 45)
      );
    case "quote-full":
      return sig.hasQuoteOnly;
    case "full-bleed":
      // Requires the background layout: on a side-rail layout the "full
      // bleed" image is really a 40% column, so a 16:9 shot gets 60% of its
      // width cropped away and the export scrim covers the text instead.
      return sig.hasRootImage && sig.isBackgroundLayout && sig.wordCount <= 60;
    case "split":
      return sig.hasRootImage && !sig.isBackgroundLayout;
    case "three-up":
      return sig.groupItemCount >= 3 && sig.groupItemCount <= 4 && !sig.hasChart;
    case "kpi":
      return sig.statCount >= 3;
    case "chart-focus":
      return sig.hasChart;
    case "team-grid":
      return (
        sig.groupItemCount >= 2 &&
        sig.groupItemCount <= 8 &&
        !sig.hasChart &&
        !sig.hasTable
      );
    case "testimonial":
      return sig.types.includes("quote") && sig.wordCount <= 90;
    case "phase-cards":
      return (
        sig.groupItemCount >= 3 &&
        sig.groupItemCount <= 5 &&
        sig.types.some((t) =>
          ["steps", "arrow-vertical", "arrows", "timeline"].includes(t),
        )
      );
    case "metric-bubbles":
      // Beside a rail image the column only fits three bubbles.
      return (
        sig.statCount >= 2 && sig.statCount <= (sig.hasRootImage ? 3 : 5)
      );
    case "content":
      return true;
  }
}
