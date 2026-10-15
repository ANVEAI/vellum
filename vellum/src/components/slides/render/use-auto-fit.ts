"use client";

/**
 * Bounded shrink-to-fit for slide text, the way PowerPoint's autofit works.
 *
 * `.v-content` is `justify-content: center` inside an `overflow: hidden`
 * slide, so content taller than the box used to be clipped at BOTH ends — a
 * long deck lost its heading and its last bullet with no visual cue, in the
 * editor and in every export.
 *
 * The factor multiplies the type scale only (never padding or the container),
 * so it is one-way: smaller text cannot make the container taller, and there
 * is no feedback loop. Below the floor the content switches to top-aligned so
 * the heading survives even when the tail is cut.
 *
 * The result is cached per slide so a hundred dashboard thumbnails do not each
 * run a measuring pass, and so a thumbnail and the full canvas always agree.
 */
import { useEffect, useState } from "react";

/**
 * Steps are coarse on purpose — a continuous factor reads as inconsistent.
 *
 * The ladder used to stop at 0.8, which was the whole reason a modest
 * overrun still clipped: 20% was all the shrink available, so anything past
 * that was cut off rather than fitted. PowerPoint's own autofit goes much
 * further — python-pptx documents a worked case landing at fontScale 55% —
 * so stopping at 0.8 was a self-imposed limit, not a legibility one. 0.65 on
 * a 1280x720 canvas still leaves body text at ~11px, and the slide is always
 * scaled up to the viewport from there.
 *
 * This only ever engages on a slide that would otherwise lose content, so a
 * deeper floor cannot make a well-sized slide look different.
 */
const STEPS = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65];
export const MIN_FIT = STEPS[STEPS.length - 1];

export interface FitResult {
  /** Type-scale multiplier to apply via `--v-fit`. */
  fit: number;
  /** True when the content still does not fit at the smallest step. */
  overflowing: boolean;
  /**
   * True once the search has finished. The print route publishes this so the
   * exporter can wait on the real thing instead of a sleep long enough to
   * cover the worst case.
   */
  settled: boolean;
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

const FITS: FitResult = { fit: 1, overflowing: false, settled: false };

/**
 * Step down the ladder until the content actually fits, verifying each step.
 *
 * The previous version estimated the answer in one shot: it took
 * `available / needed` and picked the first step below that ratio. That
 * assumes total height scales linearly with the type scale, and it does not —
 * padding, gaps, images and line-box rounding do not shrink with the font —
 * so the estimate routinely landed one or two steps short and the slide
 * clipped anyway while reporting a fit well above the floor.
 *
 * The search writes `--v-fit` straight onto the slide element and reads the
 * layout back synchronously, rather than going through React state and
 * waiting for frames. Under the concurrent scheduler a state write from a
 * rAF callback is not guaranteed to be committed by the next frame, so the
 * frame-based version re-measured stale layout, saw no improvement and gave
 * up at the first step — every overflowing slide settled at scale 1.
 *
 * It stays one-way, which is the property that matters: the container is a
 * fixed 1280x720 canvas, so shrinking text can never change the space
 * available and the loop cannot oscillate. It is bounded by the ladder.
 */
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

    /**
     * Height the content actually wants, independent of how it is aligned.
     *
     * `scrollHeight` cannot be used here. `.v-content` centres its children,
     * and an overflowing centred flex column spills equally off both ends —
     * but only the bottom half is reachable, so `scrollHeight` reports half
     * the real overrun. The search would then stop one or two steps early
     * and the slide would clip anyway. The span from the first child's top
     * to the last child's bottom is the same number whatever the alignment.
     */
    const measure = (el: HTMLElement) => {
      const first = el.firstElementChild;
      const last = el.lastElementChild;
      if (!first || !last) return null;
      const style = getComputedStyle(el);
      const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const available = el.clientHeight - padding;
      if (available <= 0) return null;
      const needed =
        last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
      return needed - available;
    };

    const attempt = () => {
      const el = contentRef.current;
      if (cancelled || !el) return;
      // `--v-fit` lives on the slide; the content box is its descendant.
      const host = (el.closest(".v-slide") as HTMLElement | null) ?? el;
      const inline = host.style.getPropertyValue("--v-fit");

      let chosen = 0;
      let overflowing = true;
      let previous = Number.POSITIVE_INFINITY;

      for (let i = 0; i < STEPS.length; i++) {
        host.style.setProperty("--v-fit", String(STEPS[i]));
        const overflow = measure(el);
        if (overflow === null) {
          // Nothing measurable yet; leave the scale alone and try next frame.
          if (inline) host.style.setProperty("--v-fit", inline);
          else host.style.removeProperty("--v-fit");
          requestAnimationFrame(attempt);
          return;
        }
        chosen = i;
        if (overflow <= 1) {
          overflowing = false;
          break;
        }
        // Shrinking the type bought nothing, so what overflows is not text —
        // a fixed-aspect image, a min-height block. Going smaller would only
        // shrink the words for no gain, so keep the larger step and let the
        // caller top-align instead.
        if (i > 0 && overflow > previous - 1) {
          chosen = i - 1;
          break;
        }
        previous = overflow;
      }

      // Hand the property back to React, which re-applies it on the render
      // this settle triggers.
      if (inline) host.style.setProperty("--v-fit", inline);
      else host.style.removeProperty("--v-fit");

      const done: FitResult = {
        fit: STEPS[chosen],
        overflowing,
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
