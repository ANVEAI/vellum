"use client";

/**
 * Fixed 1280×720 slide canvas, scaled to fit its container, arranged by
 * slide.layoutType with the root image. Shared by generation view, editor
 * surface, present mode, and the print route (print uses scale=1).
 */
import React, { useEffect, useRef, useState } from "react";
import { MIN_FIT, fitCacheKey, useAutoFit } from "./use-auto-fit";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import { useDesignTokens, useSlideTheme } from "@/components/slides/theme-scope";
import { surfaceForSlide } from "@/lib/design/planner";
import { footnoteLine, slideRefs } from "@/lib/slides/citations";
import { objectPosition, readPlacement } from "@/lib/slides/image-fit";
import { useSlideMeta } from "./slide-meta";
import { SlideContent } from "./renderer";

/** Citation band: "¹ Reuters · ² Gartner" under the content, when cited. */
function Footnotes({ slide }: { slide: PlateSlide }) {
  const meta = useSlideMeta();
  const sources = meta.sources ?? [];
  if (sources.length === 0) return null;
  const refs = slideRefs(slide, sources.length);
  if (refs.length === 0) return null;
  return <div className="v-footnotes">{footnoteLine(refs, sources)}</div>;
}

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

function RootImage({ slide }: { slide: PlateSlide }) {
  const root = slide.rootImage as
    | { url?: string; query?: string }
    | undefined;
  if (!root?.query && !root?.url) return null;
  if (root.url) {
    const { fit, focus } = readPlacement(slide.rootImage);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="v-rootimg"
        src={root.url}
        alt={root.query ?? ""}
        // The same fit/focus the PPTX exporter reads, so the crop the user
        // sets in the editor is the crop that ships.
        style={{ objectFit: fit, objectPosition: objectPosition(focus) }}
      />
    );
  }
  return (
    <div className="v-rootimg v-img-pending" title={root.query}>
      <span>Generating image…</span>
    </div>
  );
}

export function SlideSurface({
  slide,
  index,
}: {
  slide: PlateSlide;
  index?: number;
}) {
  const layout = slide.layoutType ?? "left";
  const hasImage = Boolean(slide.rootImage);
  const theme = useSlideTheme();
  const tokens = useDesignTokens();
  const rhythmSurface = surfaceForSlide(tokens.structure, slide, index);
  const contentRef = useRef<HTMLDivElement>(null);
  const fit = useAutoFit(
    contentRef,
    fitCacheKey(slide.id, JSON.stringify(slide.content).length),
  );

  return (
    <div
      className={`v-slide v-layout-${layout} ${hasImage ? "v-has-img" : ""}`}
      data-archetype={slide.archetype || undefined}
      // Read back by the PPTX exporter so its point sizes match what the
      // browser actually rendered.
      data-fit={fit === 1 ? undefined : String(fit)}
      data-num={
        index !== undefined ? String(index + 1).padStart(2, "0") : undefined
      }
      style={{
        ["--v-fit" as string]: String(fit),
        width: SLIDE_W,
        height: SLIDE_H,
        // Per-slide override wins; then the theme's surface rhythm; else
        // the designed surface (gradient) with flat-color fallback.
        background:
          slide.bgColor ??
          rhythmSurface ??
          `var(--presentation-surface, ${theme.colors.background})`,
        color: theme.colors.text,
        fontFamily: `${theme.fonts.body}, system-ui, sans-serif`,
      }}
    >
      {hasImage && layout !== "background" && <RootImage slide={slide} />}
      {hasImage && layout === "background" && (
        <div className="v-bg-img">
          <RootImage slide={slide} />
        </div>
      )}
      <SlideContent nodes={slide.content} contentRef={contentRef} atFloor={fit <= MIN_FIT} />
      <Footnotes slide={slide} />
      {theme.brandLogo &&
        (slide.archetype === "hero" || slide.archetype === "closing") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="v-brand-logo" src={theme.brandLogo} alt="" />
        )}
    </div>
  );
}

/**
 * Scales the fixed canvas to the container width.
 *
 * The container's height comes from CSS `aspect-ratio`, never from the
 * measured width. Writing a JS height here made height a function of width —
 * and inside a scroll container width is a function of the scrollbar, so the
 * two chased each other: scrollbar appears → thumbnails narrow → shorter →
 * content fits → scrollbar goes → wider → taller → overflows → repeat. With a
 * CSS ratio the box is correct before the first measurement and a dropped
 * ResizeObserver frame can no longer desynchronise layout from paint.
 */
export function ScaledSlide({
  slide,
  index,
  className,
}: {
  slide: PlateSlide;
  index?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Quantise to ~device pixels so sub-pixel jitter never re-renders.
    const apply = (width: number) => {
      const next = Math.round((width / SLIDE_W) * 4096) / 4096;
      setScale((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) apply(width);
    });
    observer.observe(el);
    apply(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: "100%",
        aspectRatio: `${SLIDE_W} / ${SLIDE_H}`,
        overflow: "hidden",
      }}
    >
      {scale > 0 && (
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: SLIDE_W,
            height: SLIDE_H,
          }}
        >
          <SlideSurface slide={slide} index={index} />
        </div>
      )}
    </div>
  );
}
