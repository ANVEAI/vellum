import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import { walkNodes } from "@/lib/slides/walk";

/**
 * Set a generated image URL on its target node inside a slides array
 * (mutates in place). nodeId "__root__" targets slide.rootImage; otherwise
 * matches an img node by id, falling back to first query match.
 */
export function applyImageToSlides(
  slides: PlateSlide[],
  slideId: string,
  nodeId: string | null | undefined,
  query: string,
  url: string,
): boolean {
  const slide = slides.find((s) => s.id === slideId);
  if (!slide) return false;

  if (nodeId === "__root__") {
    const root = (slide.rootImage ?? {}) as { query?: string; url?: string };
    slide.rootImage = { ...root, url } as PlateSlide["rootImage"];
    return true;
  }

  let applied = false;
  walkNodes(slide.content as Descendant[], (node: TElement) => {
    if (applied || node.type !== "img") return;
    const matchesId = nodeId && node.id === nodeId;
    const matchesQuery =
      !nodeId && typeof node.query === "string" && node.query === query;
    if (matchesId || matchesQuery) {
      node.url = url;
      applied = true;
    }
  });
  return applied;
}
