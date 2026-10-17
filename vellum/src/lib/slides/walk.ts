import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

export function isElement(node: Descendant): node is TElement {
  return typeof (node as TElement).type === "string";
}

/** Depth-first walk over every element node in a node tree. */
export function walkNodes(
  nodes: Descendant[],
  visit: (node: TElement) => void,
): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    visit(node);
    if (Array.isArray(node.children)) {
      walkNodes(node.children as Descendant[], visit);
    }
  }
}

/**
 * Elements that are content whatever text they hold: their substance lives
 * in attributes (a chart's rows, an infographic's spec, an image's url) or
 * they are drawn from elsewhere (the contributor line). Tables count as a
 * whole — an empty cell is part of a grid, not a missing item.
 */
const SELF_EVIDENT = new Set([
  "table",
  "contributor",
  "code_block",
  "antv-infographic",
  "funnel-flow",
  "kpi-row",
  "progress-rings",
  "pictogram",
  "harvey-table",
  "matrix",
  "org-chart",
  "journey",
  "venn",
  "iceberg",
  "flow-diagram",
]);

/**
 * Whether a node shows the reader anything: words, a picture, a chart or a
 * figure. An icon on its own does not — it decorates an item, it is not one.
 */
export function hasContent(node: Descendant): boolean {
  if (!isElement(node)) {
    // Letters, digits or symbols (✓, →, €). Punctuation alone — the " · "
    // the model puts between blocks, a lone "." or "-" — reads as nothing.
    const text = (node as { text?: unknown }).text;
    return typeof text === "string" && /[\p{L}\p{N}\p{S}]/u.test(text);
  }
  const type = String(node.type);
  if (SELF_EVIDENT.has(type) || type.startsWith("chart-")) return true;
  if (type === "img") return Boolean(node.url || node.query);
  // A STATS item carries its figure in an attribute, a circular grid its
  // hub label.
  const stat = node.stat;
  if ((typeof stat === "string" && stat.trim()) || typeof stat === "number") {
    return true;
  }
  if (typeof node.centerText === "string" && node.centerText.trim()) return true;
  return (node.children ?? []).some((child) => hasContent(child as Descendant));
}

/**
 * The items of a group (bullets, boxes, steps, a timeline…) that have
 * something in them.
 *
 * An item with no content still drew its marker, number badge or card: a
 * slide showed five bullet dots with nothing beside them. The renderer and
 * the PowerPoint exporter both take a group's items from here, so they agree
 * on what is there — the exporter matches the boxes it measures on the page
 * to the model's items one for one.
 */
export function contentItems(node: TElement): TElement[] {
  return (node.children ?? []).filter(
    (child): child is TElement => isElement(child) && hasContent(child),
  );
}

/**
 * The lanes of a <COLUMNS> group that actually carry something.
 *
 * The model routinely emits empty <DIV>s inside a column group. They are
 * invisible but they were not free: `--v-cols` was the raw child count, so
 * each one still claimed an equal `1fr` grid track and squeezed the lanes
 * that did have content. One generated slide reached thirteen lanes on a
 * 1280px canvas — about 90px each — at which point text wraps a word per
 * line and runs off the bottom of the slide.
 *
 * A lane whose only child is itself empty (a bullet list of empty items, a
 * paragraph of whitespace) is empty too: it used to count as a lane because
 * it held an element at all.
 *
 * The planner and the renderer both count lanes, and they must agree, so the
 * definition lives here rather than in either of them.
 */
export function columnLanes(node: TElement): TElement[] {
  return contentItems(node);
}

/** Heading types by rank: the presentation title outranks H1, H1 outranks H2… */
const HEADING_RANK: Record<string, number> = {
  "presentation-title": 0,
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/**
 * Which top-level block is the slide's title: the heading of the highest
 * rank, the first of them when several share it, or -1 when the slide has no
 * heading of its own (one inside a card or a step is that item's heading).
 *
 * A slide's title is one role, and it used to be rendered as whatever tag
 * the model happened to type. Across 55 decks the model opened content
 * slides with TITLE 715 times, H1 578, H2 58 and H3 6, and each tag has its
 * own size — 64, 44, 32 and 22px on the corporate scale — so one deck could
 * carry four title sizes, and slides with identical content looked
 * unrelated. The renderer, the PowerPoint and Word exporters, the planner's
 * signature and the lint all ask this one function which block is the
 * title, so every view gives it the same size and every check reads the
 * same heading.
 *
 * Highest rank rather than first: a short H3 kicker above an H1 claim is a
 * kicker, and the claim is the title. A heading with no text shows nothing,
 * so it is never the title.
 */
export function leadHeadingIndex(nodes: Descendant[]): number {
  let lead = -1;
  let leadRank = Infinity;
  nodes.forEach((node, index) => {
    if (!isElement(node)) return;
    const rank = HEADING_RANK[String(node.type)];
    if (rank === undefined || rank >= leadRank || !hasContent(node)) return;
    lead = index;
    leadRank = rank;
  });
  return lead;
}

export interface ImageRequest {
  slideId: string;
  nodeId?: string;
  query: string;
}

/** Collect every icon search query in a slides array (icon nodes + item icon attrs). */
export function collectIconQueries(slides: PlateSlide[]): string[] {
  const queries = new Set<string>();
  for (const slide of slides) {
    walkNodes(slide.content, (node) => {
      if (node.type === "icon" && typeof node.query === "string" && !node.url) {
        queries.add(node.query);
      }
      if (typeof node.icon === "string" && node.icon && !node.iconUrl) {
        queries.add(node.icon);
      }
    });
  }
  return [...queries];
}

/** Apply resolved icon URLs in place. */
export function applyIconUrls(
  slides: PlateSlide[],
  urls: Map<string, string | null>,
): void {
  for (const slide of slides) {
    walkNodes(slide.content, (node) => {
      if (node.type === "icon" && typeof node.query === "string" && !node.url) {
        const url = urls.get(node.query);
        if (url) node.url = url;
      }
      if (typeof node.icon === "string" && node.icon && !node.iconUrl) {
        const url = urls.get(node.icon);
        if (url) node.iconUrl = url;
      }
    });
  }
}

/** Collect generated-image requests (img nodes with a query and no url). */
export function collectImageRequests(slides: PlateSlide[]): ImageRequest[] {
  const requests: ImageRequest[] = [];
  for (const slide of slides) {
    // Root image rides on the slide object itself.
    const root = slide.rootImage as
      | { query?: string; url?: string }
      | undefined;
    if (root?.query && !root.url) {
      requests.push({ slideId: slide.id, nodeId: "__root__", query: root.query });
    }
    walkNodes(slide.content, (node) => {
      if (node.type !== "img") return;
      const query = typeof node.query === "string" ? node.query : "";
      const url = typeof node.url === "string" ? node.url : "";
      if (query && !url) {
        requests.push({
          slideId: slide.id,
          nodeId: typeof node.id === "string" ? node.id : undefined,
          query,
        });
      }
    });
  }
  return requests;
}
