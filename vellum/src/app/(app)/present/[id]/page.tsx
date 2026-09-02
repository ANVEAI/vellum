"use client";

/**
 * Present mode. The stage is sized from the *available* area, so turning on
 * the presenter view resizes the slide instead of covering the bottom third
 * of it. Mouse, touch and keyboard can all drive it.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import {
  SlideSurface,
  ScaledSlide,
  SLIDE_W,
  SLIDE_H,
} from "@/components/slides/render/slide-frame";
import { SlideMetaContext } from "@/components/slides/render/slide-meta";
import { ThemeScope } from "@/components/slides/theme-scope";
import { IconButton, cx } from "@/components/ui/primitives";
import "@/styles/slides.css";
import { apiFetch } from "@/lib/client/base-path";

const SHORTCUTS: Array<[string, string]> = [
  ["→ / Space / Page Down", "Next slide"],
  ["← / Page Up", "Previous slide"],
  ["Home / End", "First / last slide"],
  ["F", "Toggle full screen"],
  ["B", "Blackout the screen"],
  ["G", "Slide overview"],
  ["N", "Presenter view"],
  ["?", "This list"],
  ["Esc", "Back to the editor"],
];

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function PresentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [slides, setSlides] = useState<PlateSlide[]>([]);
  const [title, setTitle] = useState("");
  const [sources, setSources] = useState<
    Array<{ ref: number; publisher: string; title: string; url: string }> | undefined
  >(undefined);
  const [themeName, setThemeName] = useState("mystique");
  const [customThemeData, setCustomThemeData] = useState<unknown>(null);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "gone">("loading");
  const [presenter, setPresenter] = useState(false);
  const [overview, setOverview] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<number>(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchX = useRef<number | null>(null);

  /* ------------------------------- data -------------------------------- */

  useEffect(() => {
    void (async () => {
      const res = await apiFetch(`/api/documents/${params.id}`).catch(() => null);
      if (!res || !res.ok) {
        setLoadState("gone");
        return;
      }
      const doc = (await res.json()) as {
        slides: string;
        title: string;
        themeName: string;
        sources?: string | null;
        customTheme?: { data: string } | null;
      };
      setThemeName(doc.themeName);
      setTitle(doc.title);
      try {
        if (doc.sources) setSources(JSON.parse(doc.sources));
      } catch {
        setSources(undefined);
      }
      if (doc.customTheme?.data) {
        try {
          setCustomThemeData(JSON.parse(doc.customTheme.data));
        } catch {
          setCustomThemeData(null);
        }
      }
      try {
        setSlides(JSON.parse(doc.slides) as PlateSlide[]);
      } catch {
        setSlides([]);
      }
      setLoadState("ready");
    })();
  }, [params.id]);

  /* ------------------------------ sizing ------------------------------- */

  // Measure the stage box rather than the window, so the presenter panel
  // shrinks the slide instead of overlapping it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const compute = () =>
      setScale(Math.min(el.clientWidth / SLIDE_W, el.clientHeight / SLIDE_H));
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    compute();
    return () => observer.disconnect();
  }, [slides.length]);

  /* ------------------------------- timer ------------------------------- */

  // Owned by the page so toggling the presenter view never resets it.
  useEffect(() => {
    startRef.current = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  /* ----------------------------- navigation ---------------------------- */

  const advance = useCallback(
    (delta: number) =>
      setIndex((i) => Math.max(0, Math.min(slides.length - 1, i + delta))),
    [slides.length],
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Denied (or unsupported) — the rest of present mode still works.
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      if (key === "Escape") {
        if (sheet) setSheet(false);
        else if (overview) setOverview(false);
        else if (blackout) setBlackout(false);
        else router.push(`/editor/${params.id}`);
        return;
      }
      if (blackout) {
        e.preventDefault();
        setBlackout(false);
        return;
      }
      if (key === "ArrowRight" || key === " " || key === "PageDown") {
        e.preventDefault();
        advance(1);
      } else if (key === "ArrowLeft" || key === "PageUp") {
        e.preventDefault();
        advance(-1);
      } else if (key === "Home") {
        e.preventDefault();
        setIndex(0);
      } else if (key === "End") {
        e.preventDefault();
        setIndex(Math.max(0, slides.length - 1));
      } else if (key === "?") {
        setSheet((v) => !v);
      } else if (key.toLowerCase() === "n") {
        setPresenter((v) => !v);
      } else if (key.toLowerCase() === "g") {
        setOverview((v) => !v);
      } else if (key.toLowerCase() === "b") {
        setBlackout(true);
      } else if (key.toLowerCase() === "f") {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, blackout, overview, sheet, params.id, router, slides.length, toggleFullscreen]);

  /** Controls fade out while presenting, and come back on any movement. */
  const wake = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wake]);

  const slide = slides[index];
  const nextSlide = slides[index + 1];
  const atStart = index === 0;
  const atEnd = index >= slides.length - 1;

  if (blackout) {
    return (
      <main
        className="h-screen w-screen cursor-none bg-black"
        onClick={() => setBlackout(false)}
        role="presentation"
      />
    );
  }

  return (
    <SlideMetaContext.Provider value={{ title, sources }}>
      <main
        className="flex h-screen w-screen flex-col overflow-hidden bg-black"
        onMouseMove={wake}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
          wake();
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          const end = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (start === null || end === undefined) return;
          if (Math.abs(end - start) > 45) advance(end < start ? 1 : -1);
        }}
      >
        {/* live region: announces the slide for screen readers */}
        <p className="sr-only" aria-live="polite">
          {slides.length ? `Slide ${index + 1} of ${slides.length}` : ""}
        </p>

        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onClick={(e) => {
            // Click the left third to go back, anywhere else to advance.
            const box = e.currentTarget.getBoundingClientRect();
            advance(e.clientX - box.left < box.width / 3 ? -1 : 1);
          }}
        >
          {slide && scale > 0 ? (
            <div
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "center center",
                width: SLIDE_W,
                height: SLIDE_H,
              }}
            >
              <ThemeScope themeName={themeName} customThemeData={customThemeData}>
                <SlideSurface slide={slide} index={index} />
              </ThemeScope>
            </div>
          ) : loadState === "loading" ? (
            <p className="text-neutral-500">Loading…</p>
          ) : (
            // Deleted, or a document with no slides — both used to sit on
            // "Loading…" forever.
            <div className="max-w-sm text-center">
              <p className="t-emph font-semibold text-white">
                {loadState === "gone"
                  ? "This presentation is no longer available"
                  : "There is nothing to present"}
              </p>
              <p className="t-body mt-1.5 text-white/60">
                {loadState === "gone"
                  ? "It may have been deleted from the library."
                  : "This document has no slides yet."}
              </p>
              <Link href="/dashboard" className="btn btn-secondary mt-5">
                Back to library
              </Link>
            </div>
          )}
        </div>

        {/* ----------------------------- controls ---------------------------- */}
        <div
          className={cx(
            "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 px-5 pb-4 pt-10 transition-opacity duration-300",
            "bg-gradient-to-t from-black/70 to-transparent",
            controlsVisible ? "opacity-100" : "opacity-0 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
          onFocus={wake}
        >
          <div className="pointer-events-auto flex items-center gap-1 [&_.btn]:text-white/80 [&_.btn:hover]:bg-white/15 [&_.btn:hover]:text-white">
            <IconButton
              icon="back"
              label="Previous slide"
              disabled={atStart}
              onClick={() => advance(-1)}
            />
            <IconButton
              icon="forward"
              label="Next slide"
              disabled={atEnd}
              onClick={() => advance(1)}
            />
            <span className="t-caption ml-1 tabular-nums text-white/60">
              {slides.length ? `${index + 1} / ${slides.length}` : ""}
            </span>
          </div>

          <div className="flex-1" />

          <div className="pointer-events-auto flex items-center gap-1 [&_.btn]:text-white/80 [&_.btn:hover]:bg-white/15 [&_.btn:hover]:text-white">
            <IconButton
              icon="grid"
              label="Slide overview (G)"
              aria-pressed={overview}
              onClick={() => setOverview((v) => !v)}
            />
            <IconButton
              icon="notes"
              label="Presenter view (N)"
              aria-pressed={presenter}
              onClick={() => setPresenter((v) => !v)}
            />
            <IconButton
              icon="eye"
              label="Blackout (B)"
              onClick={() => setBlackout(true)}
            />
            <IconButton
              icon={fullscreen ? "close" : "present"}
              label={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
              onClick={() => void toggleFullscreen()}
            />
            <IconButton
              icon="keyboard"
              label="Keyboard shortcuts (?)"
              aria-expanded={sheet}
              onClick={() => setSheet((v) => !v)}
            />
            <IconButton
              icon="close"
              label="Exit to the editor (Esc)"
              onClick={() => router.push(`/editor/${params.id}`)}
            />
          </div>
        </div>

        {/* -------------------------- presenter view ------------------------- */}
        {presenter && slide && (
          <aside
            className="flex max-h-[34vh] shrink-0 gap-5 border-t border-white/15 bg-neutral-950 px-6 py-4"
            aria-label="Presenter view"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="t-eyebrow mb-1.5 flex items-center gap-3 text-white/45">
                Notes · slide {index + 1}
                <span className="tabular-nums text-white/70">{formatElapsed(elapsed)}</span>
              </p>
              <p className="scroll-thin overflow-y-auto whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">
                {slide.speakerNote?.trim() || "No speaker notes for this slide."}
              </p>
            </div>
            {nextSlide && (
              <div className="w-60 shrink-0">
                <p className="t-eyebrow mb-1.5 text-white/45">Next</p>
                <div className="overflow-hidden rounded-[6px] border border-white/15">
                  <ThemeScope themeName={themeName} customThemeData={customThemeData}>
                    <ScaledSlide slide={nextSlide} index={index + 1} />
                  </ThemeScope>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ---------------------------- overview ---------------------------- */}
        {overview && (
          <div
            className="scroll-thin scroll-stable fixed inset-0 z-40 overflow-y-auto bg-black/95 p-8"
            role="dialog"
            aria-modal="true"
            aria-label="Slide overview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="t-emph font-semibold text-white">{title || "Overview"}</h2>
              <IconButton
                icon="close"
                label="Close the overview"
                className="text-white/70 hover:bg-white/15 hover:text-white"
                onClick={() => setOverview(false)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Go to slide ${i + 1}`}
                  aria-current={i === index}
                  className={cx(
                    "overflow-hidden rounded-[6px] text-left",
                    i === index
                      ? "ring-2 ring-white"
                      : "ring-1 ring-white/20 hover:ring-white/50",
                  )}
                  onClick={() => {
                    setIndex(i);
                    setOverview(false);
                  }}
                >
                  <span aria-hidden className="pointer-events-none block">
                    <ThemeScope themeName={themeName} customThemeData={customThemeData}>
                      <ScaledSlide slide={s} index={i} />
                    </ThemeScope>
                  </span>
                  <span className="t-caption block bg-black px-2 py-1 text-white/60">
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* -------------------------- shortcut sheet ------------------------- */}
        {sheet && (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={() => setSheet(false)}
          >
            <div
              className="w-full max-w-sm rounded-[10px] bg-neutral-900 p-5 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="t-emph font-semibold">Keyboard shortcuts</h2>
                <IconButton
                  icon="close"
                  label="Close"
                  className="text-white/70 hover:bg-white/15 hover:text-white"
                  onClick={() => setSheet(false)}
                />
              </div>
              <dl className="space-y-1.5">
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-4">
                    <dt className="t-caption text-white/50">{what}</dt>
                    <dd className="t-caption font-medium tabular-nums text-white/90">{keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </main>
    </SlideMetaContext.Provider>
  );
}
