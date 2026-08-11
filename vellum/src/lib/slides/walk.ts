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
