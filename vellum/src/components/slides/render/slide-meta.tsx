"use client";
// (SlideMetaContext also carries the deck's citation registry.)

/**
 * Presentation-level metadata shared with the slide renderer via context.
 * The `contributor` node consumes it; pages provide it (wired separately).
 */
import React, { createContext, useContext } from "react";

export interface SlideMeta {
  title?: string;
  date?: string;
  author?: string;
  /** Deck citation registry — drives per-slide footnote bands. */
  sources?: Array<{ ref: number; publisher: string; title: string; url: string }>;
}

export const SlideMetaContext = createContext<SlideMeta>({});

export function useSlideMeta(): SlideMeta {
  return useContext(SlideMetaContext);
}

/**
 * Renders the `contributor` node as a meta row (author · date). Falls back
 * to the deck title when author/date are absent; renders nothing only when
 * every field is empty — graceful in unwired contexts.
 */
export function Contributor() {
  const meta = useSlideMeta();
  const author = meta.author?.trim();
  const date = meta.date?.trim();
  const title = meta.title?.trim();
  const line = [author, date].filter(Boolean).join(" · ");
  const text = line || title || "";
  if (!text) return null;
  return <div className="v-contributor">{text}</div>;
}
