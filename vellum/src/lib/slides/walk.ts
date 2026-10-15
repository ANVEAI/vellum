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
 * The lanes of a <COLUMNS> group that actually carry something.
 *
 * The model routinely emits empty <DIV>s inside a column group. They are
 * invisible but they were not free: `--v-cols` was the raw child count, so
 * each one still claimed an equal `1fr` grid track and squeezed the lanes
 * that did have content. One generated slide reached thirteen lanes on a
 * 1280px canvas — about 90px each — at which point text wraps a word per
 * line and runs off the bottom of the slide.
 *
 * The planner and the renderer both count lanes, and they must agree, so the
 * definition lives here rather than in either of them.
 */
export function columnLanes(node: TElement): TElement[] {
  return (node.children ?? []).filter(
    (child): child is TElement =>
      isElement(child) &&
      (child.children ?? []).some((grandchild) =>
        isElement(grandchild)
          ? true
          : typeof (grandchild as { text?: string }).text === "string" &&
            (grandchild as { text: string }).text.trim().length > 0,
      ),
  );
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
