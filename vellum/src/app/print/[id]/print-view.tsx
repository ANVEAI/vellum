"use client";

import React from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import { Node } from "@/components/slides/render/renderer";
import { SLIDE_W, SLIDE_H } from "@/components/slides/render/slide-frame";
import {
  MIN_FIT,
  fitCacheKey,
  useAutoFit,
} from "@/components/slides/render/use-auto-fit";
import {
  ThemeScope,
  useDesignTokens,
  useSlideTheme,
} from "@/components/slides/theme-scope";
import { surfaceForSlide } from "@/lib/design/planner";
import { SlideMetaContext, useSlideMeta } from "@/components/slides/render/slide-meta";
import { footnoteLine, slideRefs } from "@/lib/slides/citations";
import { objectPosition, readPlacement } from "@/lib/slides/image-fit";
import {
  DocumentView,
  computeDocToc,
} from "@/components/slides/render/document-view";
import "@/styles/slides.css";
import "./print.css";

/** Stable long-form date for the printed cover (en-US keeps SSR/hydration in sync). */
function coverDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Print-only document furniture: a full-page cover and a Contents page.
 * Hidden on screen via print.css; visible only in print media (page.pdf).
 */
function PrintDocFurniture({
  title,
  slides,
}: {
  title: string;
  slides: PlateSlide[];
}) {
  const toc = computeDocToc(slides);
  const date = coverDate();
  return (
    <>
      <div className="print-cover">
        <p className="print-cover-eyebrow" suppressHydrationWarning>
          Document — {date}
        </p>
        <div className="print-cover-push" aria-hidden="true" />
        <h1 className="print-cover-title">{title}</h1>
        <div className="print-cover-rule" aria-hidden="true" />
        <div className="print-cover-push-lower" aria-hidden="true" />
        <p className="print-cover-meta" suppressHydrationWarning>
          {date}
        </p>
      </div>
      <nav className="print-toc" aria-label="Table of contents">
        <p className="print-toc-heading">Contents</p>
        <ol className="print-toc-list">
          {toc.map((item, i) => (
            <li key={item.id} className="print-toc-row">
              <span className="print-toc-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="print-toc-label">{item.label}</span>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}

function isElement(node: Descendant): node is TElement {
  return typeof (node as TElement).type === "string";
}

function PrintRootImage({ slide }: { slide: PlateSlide }) {
  const root = slide.rootImage as { url?: string; query?: string } | undefined;
  if (!root?.url) return null;
  const { fit, focus } = readPlacement(slide.rootImage);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="v-rootimg"
      src={root.url}
      alt={root.query ?? ""}
      style={{ objectFit: fit, objectPosition: objectPosition(focus) }}
      data-root-img
    />
  );
}

/** Mirrors the on-screen citation band so PDF and PPTX carry sources too. */
function PrintFootnotes({ slide }: { slide: PlateSlide }) {
  const meta = useSlideMeta();
  const sources = meta.sources ?? [];
  if (sources.length === 0) return null;
  const refs = slideRefs(slide, sources.length);
  if (refs.length === 0) return null;
  return <div className="v-footnotes">{footnoteLine(refs, sources)}</div>;
}

function PrintSlide({ slide, index }: { slide: PlateSlide; index: number }) {
  const theme = useSlideTheme();
  const tokens = useDesignTokens();
  const rhythmSurface = surfaceForSlide(tokens.structure, slide, index);
  const layout = slide.layoutType ?? "left";
  const hasImage = Boolean(
    (slide.rootImage as { url?: string } | undefined)?.url,
  );
  // Identical autofit path to the editor, so PDF and PPTX shrink exactly the
  // same slides by exactly the same amount.
  const contentRef = React.useRef<HTMLDivElement>(null);
  const fit = useAutoFit(
    contentRef,
    fitCacheKey(slide.id, JSON.stringify(slide.content).length),
  );
  return (
    <div
      className={`v-slide v-layout-${layout} ${hasImage ? "v-has-img" : ""} print-slide`}
      data-slide-idx={index}
      data-archetype={slide.archetype || undefined}
      data-fit={fit === 1 ? undefined : String(fit)}
      data-num={String(index + 1).padStart(2, "0")}
      style={{
        ["--v-fit" as string]: String(fit),
        width: SLIDE_W,
        height: SLIDE_H,
        background:
          slide.bgColor ??
          rhythmSurface ??
          `var(--presentation-surface, ${theme.colors.background})`,
        color: theme.colors.text,
        fontFamily: `${theme.fonts.body}, system-ui, sans-serif`,
      }}
    >
      {hasImage && layout !== "background" && <PrintRootImage slide={slide} />}
      {hasImage && layout === "background" && (
        <div className="v-bg-img" data-slide-bg>
          <PrintRootImage slide={slide} />
        </div>
      )}
      {theme.brandLogo &&
        (slide.archetype === "hero" || slide.archetype === "closing") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="v-brand-logo" src={theme.brandLogo} alt="" data-brand-logo />
        )}
      {/* Citations render on screen but were missing here, so every export
          silently dropped its sources. */}
      <PrintFootnotes slide={slide} />
      <div
        ref={contentRef}
        className={`v-content${fit <= MIN_FIT ? " v-content--overflow" : ""}`}
        data-slide-content="true"
      >
        {slide.content.map((node, blockIdx) =>
          isElement(node) ? (
            <div
              key={blockIdx}
              data-block
              data-block-type={node.type}
              data-block-idx={blockIdx}
            >
              <Node node={node} />
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function PrintView({
  kind,
  title,
  themeName,
  customThemeData,
  slides,
  sources,
}: {
  kind: "deck" | "doc";
  title: string;
  themeName: string;
  customThemeData: unknown;
  slides: PlateSlide[];
  sources?: Array<{ ref: number; publisher: string; title: string; url: string }>;
}) {
  return (
    <ThemeScope themeName={themeName} customThemeData={customThemeData}>
      {kind === "deck" ? (
        <SlideMetaContext.Provider value={{ title, sources }}>
          <main className="print-deck" data-print-ready-target>
            {slides.map((slide, i) => (
              <PrintSlide key={slide.id} slide={slide} index={i} />
            ))}
          </main>
        </SlideMetaContext.Provider>
      ) : (
        <main className="print-doc" data-print-ready-target>
          <h1 className="print-doc-title" style={{ display: "none" }}>
            {title}
          </h1>
          <PrintDocFurniture title={title} slides={slides} />
          <DocumentView slides={slides} />
        </main>
      )}
    </ThemeScope>
  );
}
