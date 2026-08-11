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
import { useEffect, useRef, useState } from "react";

/** Steps are coarse on purpose — a continuous factor reads as inconsistent. */
const STEPS = [1, 0.95, 0.9, 0.85, 0.8];
export const MIN_FIT = STEPS[STEPS.length - 1];

const cache = new Map<string, number>();
const CACHE_LIMIT = 600;

function remember(key: string, value: number) {
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, value);
}

/** Cheap content fingerprint: identical text ⇒ identical overflow. */
export function fitCacheKey(slideId: string, contentLength: number): string {
  return `${slideId}:${contentLength}`;
}

export function useAutoFit(
  contentRef: React.RefObject<HTMLElement | null>,
  key: string,
): number {
  const [fit, setFit] = useState(() => cache.get(key) ?? 1);
  const settled = useRef(false);

  useEffect(() => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      settled.current = true;
      setFit(cached);
      return;
    }
    settled.current = false;
    setFit(1);

    let cancelled = false;
    const measure = () => {
      const el = contentRef.current;
      if (cancelled || !el || settled.current) return;
      // clientHeight excludes the scrollbar-free content box; both are the
      // padded box, so the comparison already accounts for the inset.
      const available = el.clientHeight;
      const needed = el.scrollHeight;
      if (!available) return;
      let next = 1;
      if (needed > available + 1) {
        const ratio = available / needed;
        next = STEPS.find((step) => step <= ratio) ?? MIN_FIT;
      }
      settled.current = true;
      remember(key, next);
      setFit(next);
    };

    // Fonts change metrics, so measuring before they load is meaningless.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.status === "loaded") {
      requestAnimationFrame(measure);
    } else {
      void fonts?.ready.then(() => requestAnimationFrame(measure));
    }
    return () => {
      cancelled = true;
    };
  }, [key, contentRef]);

  return fit;
}
