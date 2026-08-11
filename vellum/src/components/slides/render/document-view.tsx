"use client";

/**
 * Flowing reader view for document-kind content: sections render as one
 * continuous themed page with a TOC sidebar derived from headings.
 *
 * Images are wrapped in a `.v-doc-figure` with a `.v-doc-figcaption` so the
 * print stylesheet can number them ("Figure N — alt"); on screen the caption
 * is hidden and the wrapper is inert, keeping the reader's look unchanged.
 */
import React, { useMemo } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import { Node, textOf } from "./renderer";

function isElement(node: Descendant): node is TElement {
  return typeof (node as TElement).type === "string";
}

function sectionHeading(slide: PlateSlide): string {
  for (const node of slide.content) {
    const el = node as TElement;
    if (el.type === "presentation-title" || el.type === "h1") {
      return textOf(el.children as Descendant[]);
    }
  }
  return "Section";
}

/** H1-derived section list; shared by the sidebar TOC and the printed TOC page. */
export function computeDocToc(
  slides: PlateSlide[],
): { id: string; label: string }[] {
  return slides.map((slide, i) => ({
    id: slide.id,
    label: sectionHeading(slide) || `Section ${i + 1}`,
  }));
}

function DocBlocks({ nodes }: { nodes: Descendant[] }) {
  return (
    <div className="v-content" data-slide-content="true">
      {nodes.map((node, i) => {
        if (!isElement(node)) return null;
        if (node.type === "img" && (node.url as string | undefined)) {
          const alt = String((node.query as string | undefined) ?? "").trim();
          return (
            <figure key={i} className="v-doc-figure">
              <Node node={node} />
              <figcaption className="v-doc-figcaption">
                {alt ? ` — ${alt}` : null}
              </figcaption>
            </figure>
          );
        }
        return <Node key={i} node={node} />;
      })}
    </div>
  );
}

export function DocumentView({ slides }: { slides: PlateSlide[] }) {
  const toc = useMemo(() => computeDocToc(slides), [slides]);

  return (
    <div className="v-doc-wrap">
      <nav className="v-doc-toc">
        <p className="v-doc-toc-title">Contents</p>
        {toc.map((item) => (
          <a key={item.id} href={`#sec-${item.id}`} className="v-doc-toc-item">
            {item.label}
          </a>
        ))}
      </nav>
      <article className="v-doc" data-slide-content="true">
        {slides.map((slide) => (
          <section key={slide.id} id={`sec-${slide.id}`} className="v-doc-section">
            <DocBlocks nodes={slide.content} />
          </section>
        ))}
      </article>
    </div>
  );
}
