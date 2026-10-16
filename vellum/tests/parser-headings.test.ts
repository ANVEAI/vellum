import { describe, expect, it } from "vitest";
import { SlideParser, type PlateSlide } from "@/lib/generation/parser/slide-parser";

function parse(xml: string): PlateSlide[] {
  const p = new SlideParser({ mode: "deck" });
  p.reset();
  p.parseChunk(xml);
  p.finalize();
  p.clearAllGeneratingMarks();
  return p.getAllSlides();
}

function text(n: unknown): string {
  if (!n || typeof n !== "object") return "";
  const o = n as { text?: string; children?: unknown[] };
  if (typeof o.text === "string") return o.text;
  return (o.children ?? []).map(text).join(" ");
}

const shape = (slide: PlateSlide) =>
  slide.content.map((n) => {
    const t = text(n).replace(/\s+/g, " ").trim();
    return `${String((n as { type?: string }).type)}:${t}`;
  });

const BODY =
  "<COLUMNS><DIV><H3>Artificial Intelligence</H3><P>The umbrella.</P></DIV><DIV><H3>Machine Learning</H3><P>Learns from data.</P></DIV></COLUMNS><CALLOUT>Analogy: AI is the car category.</CALLOUT>";

const wrap = (inner: string) =>
  `<PRESENTATION><SECTION>${inner}</SECTION></PRESENTATION>`;

/**
 * Regression: a heading the model left unclosed (or wrapped around the rest
 * of the slide) swallowed every following element. The heading builders
 * flatten all text descendants, so the whole slide became one display-size
 * title — a real deck carried a 90-word title roughly 3,000px tall.
 */
describe("headings are inline-only", () => {
  const expected = shape(
    parse(wrap(`<TITLE>What exactly is AI?</TITLE>${BODY}`))[0],
  );

  it("parses a well-formed slide as title + columns + callout", () => {
    expect(expected.map((s) => s.split(":")[0])).toEqual([
      "presentation-title",
      "column_group",
      "callout",
    ]);
  });

  it("recovers an unclosed TITLE to the same structure", () => {
    expect(shape(parse(wrap(`<TITLE>What exactly is AI?${BODY}`))[0])).toEqual(
      expected,
    );
  });

  it("recovers content nested inside a TITLE", () => {
    expect(
      shape(parse(wrap(`<TITLE>What exactly is AI?${BODY}</TITLE>`))[0]),
    ).toEqual(expected);
  });

  it("recovers an unclosed H1", () => {
    const got = shape(parse(wrap(`<H1>What exactly is AI?${BODY}`))[0]);
    expect(got[0]).toBe("h1:What exactly is AI?");
    expect(got.slice(1)).toEqual(expected.slice(1));
  });

  it("keeps inline formatting inside a heading", () => {
    const got = shape(
      parse(wrap(`<H1>Churn fell <B>34%</B> after the redesign</H1><P>Body.</P>`))[0],
    );
    expect(got[0]).toBe("h1:Churn fell 34% after the redesign");
  });

  it("keeps loose trailing text as a paragraph instead of dropping it", () => {
    const got = shape(
      parse(wrap(`<TITLE>Heading<BULLETS><DIV><P>One</P></DIV><DIV><P>Two</P></DIV></BULLETS>Closing line.</TITLE>`))[0],
    );
    expect(got[0]).toBe("presentation-title:Heading");
    expect(got.some((s) => s === "p:Closing line.")).toBe(true);
  });

  it("drops a heading that had no text of its own", () => {
    const got = shape(parse(wrap(`<H1>${BODY}</H1>`))[0]);
    expect(got[0].startsWith("column_group:")).toBe(true);
  });

  it("gives an unclosed heading a stable id across streaming ticks", () => {
    // The id is fingerprinted from the H1. When the H1 swallowed the rest of
    // the slide, its text grew every tick and the slide id changed under the
    // editor; lifting the blocks out first pins it to the heading itself.
    const full = wrap(`<H1>What exactly is AI?${BODY}`);
    const ids = new Set<string>();
    for (let cut = full.indexOf("</H3>") + 5; cut <= full.length; cut += 37) {
      const slides = parse(full.slice(0, cut));
      if (slides[0]) ids.add(slides[0].id);
    }
    ids.add(parse(full)[0].id);
    expect(ids.size).toBe(1);
  });
});
