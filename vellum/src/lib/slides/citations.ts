/**
 * Citation plumbing: collect source="k" refs a slide carries, and build the
 * Sources appendix slide. URLs live only in the registry and the appendix —
 * the model never emits one (see research/searxng.ts).
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import { walkNodes } from "@/lib/slides/walk";
import type { DeckSource } from "@/lib/generation/research/searxng";

/** Sorted, de-duplicated refs found on a slide (1-based, registry-bounded). */
export function slideRefs(slide: PlateSlide, sourceCount: number): number[] {
  const refs = new Set<number>();
  const add = (raw: unknown) => {
    const n = parseInt(String(raw ?? ""), 10);
    if (Number.isInteger(n) && n >= 1 && n <= sourceCount) refs.add(n);
  };
  walkNodes(slide.content as Descendant[], (node: TElement) => {
    if (node.source !== undefined) add(node.source);
    if (node.ref !== undefined && String(node.type) === "cite") add(node.ref);
  });
  return [...refs].sort((a, b) => a - b);
}

const SUPERSCRIPT = ["", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

export function superscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUPERSCRIPT[Number(d)] ?? "")
    .join("");
}

/** Footnote band text: "¹ Reuters · ² Gartner". */
export function footnoteLine(
  refs: number[],
  sources: DeckSource[],
): string {
  return refs
    .map((ref) => {
      const source = sources.find((s) => s.ref === ref);
      return source ? `${superscript(ref)} ${source.publisher}` : "";
    })
    .filter(Boolean)
    .join("  ·  ");
}

let appendixCounter = 0;

/**
 * Synthesized "Sources" appendix slide — plain bullets so it renders and
 * exports with zero new component surface. The only place URLs appear.
 */
export function buildSourcesSlide(sources: DeckSource[]): PlateSlide {
  const stamp = `src${(appendixCounter++).toString(36)}`;
  const item = (source: DeckSource) => ({
    id: `${stamp}-i${source.ref}`,
    type: "div",
    children: [
      {
        id: `${stamp}-h${source.ref}`,
        type: "h4",
        children: [{ text: `${source.ref}. ${source.publisher}` }],
      },
      {
        id: `${stamp}-p${source.ref}`,
        type: "p",
        children: [{ text: `${source.title} — ${source.url}` }],
      },
    ],
  });
  return {
    id: `${stamp}-slide`,
    alignment: "center",
    layoutType: "vertical",
    archetype: "content",
    content: [
      {
        id: `${stamp}-label`,
        type: "label",
        children: [{ text: "Appendix" }],
      },
      {
        id: `${stamp}-title`,
        type: "h1",
        children: [{ text: "Sources" }],
      },
      {
        id: `${stamp}-list`,
        type: "bullets",
        bulletType: "numbered",
        children: sources.map(item),
      },
    ],
  } as unknown as PlateSlide;
}
