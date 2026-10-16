import { describe, expect, it } from "vitest";
import { cleanSlideContent, isMetaCommentary } from "@/lib/slides/clean";
import { SlideParser } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";

const p = (text: string): TElement => ({ type: "p", children: [{ text }] });
const bullet = (text: string): TElement => ({ type: "bullet", children: [p(text)] });

function textOf(node: Descendant): string {
  return typeof (node as TElement).type === "string"
    ? ((node as TElement).children ?? []).map(textOf).join(" ")
    : (node as { text: string }).text;
}

describe("isMetaCommentary", () => {
  it.each([
    `Slide 9: Removed duplicate "Accounting & audit" entries. Reordered list for clarity.`,
    `Removed duplicate "Accounting & audit" entries. Reordered list for clarity.`,
    "Here is the revised slide:",
    "I've condensed the slide to 21 words.",
    "I removed the duplicate bullets.",
    "Changes: merged the two lists into one.",
    "(Moved the timeline details to the notes for brevity.)",
    "Word count: 21",
    "Section 4 — Shortened the heading to fit.",
  ])("flags %j", (text) => {
    expect(isMetaCommentary(text)).toBe(true);
  });

  it.each([
    "Removed import duties on solar panels",
    "Removed duplicate entries from the CRM, cutting errors by 40%",
    "Cut onboarding time in half",
    "Moved operations to the cloud for consistency",
    "Kept costs flat for three years",
    "Added 40 new stores in 2024",
    "Updated pricing takes effect in May",
    "Here is what changed for our customers",
    "Section 3: Market sizing",
    "Slide rules were the first pocket calculators",
  ])("keeps %j", (text) => {
    expect(isMetaCommentary(text)).toBe(false);
  });
});

describe("cleanSlideContent", () => {
  it("drops empty items, and the group they leave empty", () => {
    const content = [
      { type: "h1", children: [{ text: "Stay safe" }] },
      {
        type: "bullets",
        children: [
          { type: "bullet", icon: "pause", children: [] },
          { type: "bullet", icon: "key", children: [p("  ")] },
        ],
      },
    ] as TElement[];
    expect(cleanSlideContent(content).map((n) => n.type)).toEqual(["h1"]);
  });

  it("keeps the items that have content, icons included", () => {
    const content = [
      {
        type: "bullets",
        children: [
          { type: "bullet", children: [] },
          { type: "bullet", icon: "key", children: [{ type: "icon", query: "key", children: [{ text: "" }] }, p("Agree a code word")] },
        ],
      },
    ] as TElement[];
    const [group] = cleanSlideContent(content);
    expect(group!.children).toHaveLength(1);
    expect(((group!.children[0] as TElement).children[0] as TElement).type).toBe("icon");
  });

  it("drops a callout that only holds a note about the edit", () => {
    const content = [
      { type: "h1", children: [{ text: "AI is reshaping every industry" }] },
      {
        type: "callout",
        children: [p(`Slide 9: Removed duplicate "Accounting & audit" entries. Reordered list for clarity.`)],
      },
    ] as TElement[];
    expect(cleanSlideContent(content).map((n) => n.type)).toEqual(["h1"]);
  });

  it("drops a repeated item, but not repeats inside one item", () => {
    const content = [
      { type: "bullets", children: [bullet("Banking"), bullet("Audit"), bullet("Banking")] },
      {
        type: "compare",
        children: [
          { type: "compare-side", children: [p("Yes"), p("Yes"), p("No")] },
          { type: "compare-side", children: [p("No"), p("Yes"), p("Yes")] },
        ],
      },
    ] as TElement[];
    const [bullets, compare] = cleanSlideContent(content);
    expect(bullets!.children.map(textOf)).toEqual(["Banking", "Audit"]);
    expect((compare!.children[0] as TElement).children).toHaveLength(3);
  });

  it("takes the outline's 'Slide N:' off a heading", () => {
    const [h1] = cleanSlideContent([
      { type: "h1", children: [{ text: "Slide 3: Voice is the next interface" }] },
    ] as TElement[]);
    expect(textOf(h1!)).toBe("Voice is the next interface");
  });

  it("takes a slot name the prompt uses off, and makes a kicker of a kicker", () => {
    const [kicker, h1, keeps] = cleanSlideContent([
      p("KICKER: LET'S BEGIN"),
      { type: "h1", children: [{ text: "Eyebrow: Raise your hand if" }] },
      p("Title: The Great Gatsby, first edition"),
    ] as TElement[]);
    expect(kicker!.type).toBe("label");
    expect(textOf(kicker!)).toBe("LET'S BEGIN");
    expect(textOf(h1!)).toBe("Raise your hand if");
    expect(textOf(keeps!)).toBe("Title: The Great Gatsby, first edition");
  });

  it("drops separators between blocks and blocks of punctuation, and keeps symbols", () => {
    const h3 = (text: string): TElement => ({ type: "h3", children: [{ text }] });
    const out = cleanSlideContent([
      { type: "p", children: [h3("<0.5s reply time"), { text: " · " }, h3("50 languages"), { text: " · " }, h3("1 line of code")] },
      p("."),
      p("✓"),
    ] as TElement[]);
    // The lone "." is gone; the check mark stays.
    expect(out).toHaveLength(2);
    expect(out[0]!.children.map((c) => (c as TElement).type)).toEqual(["h3", "h3", "h3"]);
    expect(textOf(out[1]!)).toBe("✓");
  });

  it("leaves data alone: empty table cells, charts, stats carried by attributes", () => {
    const table = {
      type: "table",
      children: [{ type: "tr", children: [{ type: "td", children: [p("")] }, { type: "td", children: [p("x")] }] }],
    };
    const chart = { type: "chart-bar", data: [{ a: 1 }], children: [{ text: "" }] };
    const stats = { type: "stats", children: [{ type: "stats-item", stat: "₹10,372 Cr", children: [{ text: "" }] }] };
    const out = cleanSlideContent([table, chart, stats] as TElement[]);
    expect(out).toEqual([table, chart, stats]);
  });

  it("returns well-formed content unchanged", () => {
    const content = [
      { type: "label", children: [{ text: "01 · BASICS" }] },
      { type: "h1", children: [{ text: "What exactly is AI?" }] },
      { type: "bullets", children: [bullet("Machines that learn"), bullet("From data")] },
    ] as TElement[];
    expect(cleanSlideContent(content)).toEqual(content);
  });
});

describe("in the parser", () => {
  it("never puts the model's edit note on a slide", () => {
    const parser = new SlideParser({ mode: "deck" });
    parser.parseChunk(
      `<PRESENTATION><SECTION><H1>AI is reshaping every industry</H1><CALLOUT><P>Slide 9: Removed duplicate "Accounting &amp; audit" entries. Reordered list for clarity.</P></CALLOUT><BOXES><DIV><H3>Banking</H3><P>Fraud detection</P></DIV></BOXES></SECTION></PRESENTATION>`,
    );
    parser.finalize();
    const slide = parser.getAllSlides()[0]!;
    expect(slide.content.map((n) => (n as TElement).type)).toEqual(["h1", "boxes"]);
  });
});
