"use client";

/**
 * Shrink-to-fit for slide content, the way PowerPoint's autofit works, in
 * two stages.
 *
 * 1. The type scale (`--v-fit`) steps down a ladder. Text gets smaller while
 *    spacing, icons and padding keep their size — the closest analogue to
 *    PowerPoint's fontScale, and the stage that keeps a slide looking most
 *    like itself.
 * 2. If the ladder bottoms out and the content still overruns, every block
 *    inside the content box is zoomed (`--v-zoom`) by a continuous factor.
 *    Zoom scales text, spacing, line height and icons together and, unlike
 *    `transform: scale`, it changes layout: the box measures and flows at the
 *    smaller size, and nothing is clipped by an `overflow: hidden` ancestor
 *    before a transform could shrink it. Chrome's engineers make exactly that
 *    case for zoom when standardising it (Chrome 128). Padding is untouched,
 *    because only the blocks are zoomed, never the box that owns the inset.
 *
 * Both stages are one-way: the container is a fixed 1280x720 canvas, so
 * shrinking content cannot change the space available, and neither loop can
 * oscillate. Results are cached per slide so a hundred thumbnails do not each
 * measure, and so a thumbnail, the canvas, present mode and the print route
 * always agree.
 *
 * Below the zoom floor a slide is too dense to be legible at any size; it is
 * top-aligned so the heading survives, and the generation gate is what must
 * stop such a slide being produced in the first place.
 */
import { useEffect, useState } from "react";

/**
 * Stage 1. Coarse on purpose — a continuous type scale reads as inconsistent
 * from slide to slide. 0.65 on a 1280x720 canvas leaves body text near 11px
 * before the slide is scaled up to the viewport.
 */
const STEPS = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65];
export const MIN_FIT = STEPS[STEPS.length - 1];

/**
 * Stage 2 floor. With the type scale already at 0.65, a zoom of 0.75 puts
 * text at ~49% of the theme size — about where PowerPoint's own documented
 * autofit case lands (fontScale 55%). Further than that is not "fitted", it
 * is unreadable, and Chromium's minimum rendered font size stops honouring
 * the zoom soon after anyway: a 4.6x overrun was measured stalling there.
 */
export const MIN_ZOOM = 0.75;

/** Zoom iterations: the factor is re-estimated from each measurement. */
const ZOOM_PASSES = 6;

/**
 * Frames to wait for late content before measuring anyway, about two seconds
 * at 60Hz. The wait ends as soon as the content is ready; this only bounds a
 * chart that never draws.
 */
const LATE_CONTENT_FRAMES = 120;

/**
 * Content that takes its real size only after the first paint. Charts load
 * through a lazy import and draw their SVG after hydration, and an image's
 * height is unknown until it decodes. Measuring before either is in place
 * sizes the slide around an empty box: a line chart drew itself 50px past
 * the bottom of a slide that autofit had already settled — and cached — at
 * full size.
 */
function lateContentPending(el: HTMLElement): boolean {
  if (el.querySelector(".v-chart-pending")) return true;
  for (const chart of el.querySelectorAll(".v-chart")) {
    if (!chart.querySelector("svg")) return true;
  }
  for (const img of el.querySelectorAll("img")) {
    if (!img.complete) return true;
  }
  return false;
}

export interface FitResult {
  /** Type-scale multiplier to apply via `--v-fit`. */
  fit: number;
  /** Block zoom to apply via `--v-zoom`; 1 when the ladder sufficed. */
  zoom: number;
  /** True when the content still does not fit at both floors. */
  overflowing: boolean;
  /**
   * True once the search has finished. The print route publishes this so the
   * exporter can wait on the real thing instead of a sleep long enough to
   * cover the worst case.
   */
  settled: boolean;
}

/** The text scale a slide actually renders at; what the PPTX exporter needs. */
export function effectiveScale(result: FitResult): number {
  return Math.round(result.fit * result.zoom * 1000) / 1000;
}

const cache = new Map<string, FitResult>();
const CACHE_LIMIT = 600;

function remember(key: string, value: FitResult) {
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, value);
}

/** Cheap content fingerprint: identical text ⇒ identical overflow. */
export function fitCacheKey(slideId: string, contentLength: number): string {
  return `${slideId}:${contentLength}`;
}

const FITS: FitResult = { fit: 1, zoom: 1, overflowing: false, settled: false };

/**
 * How far the content overruns its box, in the box's own layout pixels.
 *
 * Measured as the span from the first block's top to the last block's
 * bottom. `scrollHeight` cannot be used: the box centres its blocks, and an
 * overflowing centred column spills off both ends with only the bottom half
 * reachable, so `scrollHeight` reports half the overrun.
 *
 * The span comes from `getBoundingClientRect`, which reports VISUAL pixels —
 * it includes the zoom on the blocks, which is wanted, but also any
 * `transform: scale` on an ancestor, which is not. The editor and present
 * mode draw every slide inside such a transform (0.11 in the navigator, 1.5
 * full-screen), so the visual span is divided by the box's own visual/layout
 * ratio. Without that, a navigator thumbnail at 0.11 saw its content as a
 * ninth of its real height, decided it fitted at full size, and cached that
 * answer for the canvas: a slide 2,691px over its box rendered at scale 1.
 */
function overrun(el: HTMLElement): { over: number; available: number } | null {
  const first = el.firstElementChild;
  const last = el.lastElementChild;
  if (!first || !last || !el.offsetHeight) return null;
  const style = getComputedStyle(el);
  const available =
    el.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  if (available <= 0) return null;
  const ancestorScale = el.getBoundingClientRect().height / el.offsetHeight;
  if (!(ancestorScale > 0)) return null;
  const visualSpan =
    last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
  return { over: visualSpan / ancestorScale - available, available };
}

export function useAutoFit(
  contentRef: React.RefObject<HTMLElement | null>,
  key: string,
): FitResult {
  const [result, setResult] = useState<FitResult>(
    () => cache.get(key) ?? FITS,
  );

  useEffect(() => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      setResult(cached);
      return;
    }
    setResult(FITS);

    let cancelled = false;
    let waited = 0;

    /**
     * Both stages write their variable straight onto the slide and read the
     * layout back synchronously, rather than going through React state and
     * waiting for frames. Under the concurrent scheduler a state write from a
     * rAF callback is not guaranteed to be committed by the next frame; the
     * frame-based version re-measured stale layout, saw no improvement and
     * gave up at the first step.
     */
    const attempt = () => {
      const el = contentRef.current;
      if (cancelled || !el) return;
      if (lateContentPending(el) && waited < LATE_CONTENT_FRAMES) {
        waited += 1;
        requestAnimationFrame(attempt);
        return;
      }
      // The variables live on the slide; the content box is its descendant.
      const host = (el.closest(".v-slide") as HTMLElement | null) ?? el;
      const inlineFit = host.style.getPropertyValue("--v-fit");
      const inlineZoom = host.style.getPropertyValue("--v-zoom");
      const restore = () => {
        if (inlineFit) host.style.setProperty("--v-fit", inlineFit);
        else host.style.removeProperty("--v-fit");
        if (inlineZoom) host.style.setProperty("--v-zoom", inlineZoom);
        else host.style.removeProperty("--v-zoom");
      };
      host.style.setProperty("--v-zoom", "1");

      // ---- Stage 1: the type ladder ----
      let available = 0;
      let step = 0;
      let over = Number.POSITIVE_INFINITY;
      let previous = Number.POSITIVE_INFINITY;
      for (let i = 0; i < STEPS.length; i++) {
        host.style.setProperty("--v-fit", String(STEPS[i]));
        const m = overrun(el);
        if (m === null) {
          // Nothing measurable yet; leave the slide alone and try next frame.
          restore();
          requestAnimationFrame(attempt);
          return;
        }
        const measured = m.over;
        available = m.available;
        // Shrinking the type bought nothing: what overruns is not text. Keep
        // the larger step and let the zoom stage deal with it.
        if (i > 0 && measured > previous - 1) {
          host.style.setProperty("--v-fit", String(STEPS[step]));
          break;
        }
        step = i;
        over = measured;
        previous = measured;
        if (measured <= 1) break;
      }

      // ---- Stage 2: zoom the blocks, if the ladder was not enough ----
      let zoom = 1;
      if (over > 1) {
        for (let pass = 0; pass < ZOOM_PASSES && over > 1; pass++) {
          // Re-estimate from the measured span rather than assuming the
          // overrun shrinks linearly: the gaps between blocks belong to the
          // box and do not zoom, so the first estimate always lands short.
          const needed = over + available;
          const next = Math.max(MIN_ZOOM, zoom * (available / needed) * 0.995);
          if (next >= zoom) break;
          zoom = next;
          host.style.setProperty("--v-zoom", String(zoom));
          const m = overrun(el);
          if (m === null) break;
          over = m.over;
          if (zoom <= MIN_ZOOM) break;
        }
        // Down, never up: the zoom just verified is the largest known to fit.
        zoom = Math.floor(zoom * 1000) / 1000;
      }

      restore();
      const done: FitResult = {
        fit: STEPS[step],
        zoom,
        overflowing: over > 1,
        settled: true,
      };
      remember(key, done);
      setResult(done);
    };

    // Fonts change metrics, so measuring before they load is meaningless.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.status === "loaded") {
      requestAnimationFrame(attempt);
    } else {
      void fonts?.ready.then(() => requestAnimationFrame(attempt));
    }
    return () => {
      cancelled = true;
    };
  }, [key, contentRef]);

  return result;
}
