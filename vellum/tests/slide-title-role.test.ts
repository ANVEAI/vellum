/**
 * The slide-title role: one definition of which block is a slide's title,
 * and every consumer reading it.
 *
 * The model writes a slide's title as TITLE, H1, H2 or H3, and each tag had
 * its own size, so one deck carried up to four title sizes. The renderer now
 * marks the title (`v-lead`) and sizes the role, not the tag.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlideContent } from "@/components/slides/render/renderer";
import { leadHeadingIndex } from "@/lib/slides/walk";
import { signatureOf } from "@/lib/design/archetypes";
import { lintSlides } from "@/lib/qa/lint";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const el = (type: string, text: string): TElement => ({ type, children: [{ text }] });
const bullets = (...items: string[]): TElement => ({
  type: "bullets",
  children: items.map((text) => ({ type: "bullet", children: [el("h4", text)] })),
});

describe("leadHeadingIndex", () => {
  it("picks the slide's own heading whatever its level", () => {
    expect(leadHeadingIndex([el("h3", "The three-step evolution"), bullets("a", "b")])).toBe(0);
    expect(leadHeadingIndex([el("label", "Kicker"), el("h2", "A claim")])).toBe(1);
    expect(leadHeadingIndex([el("p", "Intro line."), el("h2", "The claim"), el("p", "More.")])).toBe(1);
  });

  it("prefers the higher rank, so a small kicker heading is not the title", () => {
    expect(leadHeadingIndex([el("h3", "Chapter two"), el("h1", "The real claim")])).toBe(1);
    expect(leadHeadingIndex([el("presentation-title", "Deck"), el("h1", "Subtitle")])).toBe(0);
    expect(leadHeadingIndex([el("h2", "First"), el("h2", "Second")])).toBe(0);
  });

  it("ignores an empty heading and headings inside items", () => {
    expect(leadHeadingIndex([el("h1", "  "), el("h2", "Visible")])).toBe(1);
    expect(leadHeadingIndex([bullets("Only items have headings")])).toBe(-1);
  });
});

describe("rendered title role", () => {
  const html = (nodes: Descendant[]) =>
    renderToStaticMarkup(React.createElement(SlideContent, { nodes }));

  it("marks exactly the title, keeping its tag", () => {
    const out = html([el("h3", "The three-step evolution"), bullets("Autocomplete", "Copilot")]);
    expect(out.match(/v-lead/g)).toHaveLength(1);
    expect(out).toMatch(/<h3 class="v-h3 v-lead">(<span[^>]*>)?The three-step evolution/);
  });

  it("leaves a second heading at its own level", () => {
    const out = html([el("h2", "The claim"), el("h2", "A subheading"), el("p", "Body.")]);
    expect(out).toMatch(/<h2 class="v-h2 v-lead">(<span[^>]*>)?The claim/);
    expect(out).toMatch(/<h2 class="v-h2">(<span[^>]*>)?A subheading/);
  });

  it("marks the title in focus mode too", () => {
    const out = renderToStaticMarkup(
      React.createElement(SlideContent, {
        nodes: [el("p", "Lead-in."), el("h1", "Title")],
        focusIndex: 0,
      }),
    );
    expect(out).toMatch(/<h1 class="v-h1 v-lead">(<span[^>]*>)?Title/);
  });
});

describe("consumers read the same title", () => {
  const slide = (content: unknown[]): PlateSlide =>
    ({ id: "s", content, alignment: "center" }) as unknown as PlateSlide;

  it("gives the planner signature an H3 title", () => {
    expect(signatureOf(slide([el("h3", "Agenda for today"), bullets("a", "b", "c")])).headingText).toBe(
      "Agenda for today",
    );
  });

  it("lets the lint see an H3 title instead of reporting none", () => {
    const issues = lintSlides(
      [slide([el("h3", "The Strategic Gap"), el("p", "Value moves from writing syntax to directing systems.")])],
      null,
      "deck",
    );
    expect(issues.some((i) => i.code === "no-heading")).toBe(false);
    expect(issues.some((i) => i.code === "topic-heading")).toBe(true);
  });
});
