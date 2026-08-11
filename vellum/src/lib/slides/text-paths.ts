/**
 * Lossless text editing over the slide model: enumerate every text leaf with
 * a structural path, edit by path. Structure is never touched — only TText
 * values change — so parser ids, layouts, exports, and images all survive.
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";

export interface TextRun {
  /** Child indices from slide.content down to the text leaf. */
  path: number[];
  text: string;
  /** Rough role for input styling. */
  kind: "heading" | "body" | "label";
  /** Type of the nearest element ancestor (h1, p, quote…). */
  parentType: string;
}

const HEADING_TYPES = new Set([
  "presentation-title",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function isText(node: Descendant): node is TText {
  return typeof (node as TText).text === "string" && !(node as TElement).type;
}

export function collectTextRuns(slide: PlateSlide): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (nodes: Descendant[], path: number[], parentType: string) => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (isText(node)) {
        if (node.text.trim().length > 0) {
          runs.push({
            path: here,
            text: node.text,
            kind: HEADING_TYPES.has(parentType)
              ? "heading"
              : parentType === "label"
                ? "label"
                : "body",
            parentType,
          });
        }
        return;
      }
      const el = node as TElement;
      walk(el.children ?? [], here, String(el.type ?? parentType));
    });
  };
  walk(slide.content as Descendant[], [], "p");
  return runs;
}

/** Returns a new slide with the text at `path` replaced (deep-copied spine). */
export function setTextAtPath(
  slide: PlateSlide,
  path: number[],
  text: string,
): PlateSlide {
  const next: PlateSlide = { ...slide, content: [...slide.content] };
  let nodes: Descendant[] = next.content as Descendant[];
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth];
    const node = nodes[index];
    if (node === undefined) return slide;
    if (depth === path.length - 1) {
      if (!isText(node)) return slide;
      nodes[index] = { ...node, text };
      return next;
    }
    const el = node as TElement;
    const copied: TElement = { ...el, children: [...(el.children ?? [])] };
    nodes[index] = copied;
    nodes = copied.children;
  }
  return slide;
}
