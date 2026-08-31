/**
 * Projections and the two predicates that are easy to get subtly wrong.
 */
import { describe, expect, it } from "vitest";
import {
  countOutlineCards,
  digestSlides,
  extractText,
  isQualityComplete,
  isTruncated,
  slideHeading,
} from "../../src/domain/projection.js";
import type { PlateSlide } from "../../src/vellum/types.js";

const slide = (id: string, heading: string, body: string): PlateSlide => ({
  id,
  content: [
    { type: "h1", children: [{ text: heading }] },
    { type: "p", children: [{ text: body }] },
  ],
});

describe("countOutlineCards", () => {
  it("counts '## ' headings only", () => {
    expect(countOutlineCards("# Title\n\n## One\n- a\n\n## Two\n")).toBe(2);
  });
  it("returns 0 when the markdown uses the wrong heading level", () => {
    // The real footgun: '### Heading' parses as zero cards, and the content
    // stage then generates against an empty contract.
    expect(countOutlineCards("# Title\n\n### One\n### Two")).toBe(0);
  });
});

describe("isTruncated", () => {
  it("flags a deck with fewer slides than its outline promised", () => {
    expect(isTruncated(3, 8)).toBe(true);
  });

  it("does NOT flag a deck with one EXTRA slide", () => {
    // When a deck cites sources Vellum appends a Sources appendix slide, so
    // slideCount === cardCount + 1 is healthy. A `!==` comparison here would
    // false-positive on every researched deck.
    expect(isTruncated(9, 8)).toBe(false);
  });

  it("is inert when there is no outline to compare against", () => {
    expect(isTruncated(0, 0)).toBe(false);
  });
});

describe("isQualityComplete", () => {
  it("rejects the partial report written when status flips to reviewing", () => {
    // qa/run.ts writes {score: null} at the same moment it sets "reviewing",
    // so `qualityReport != null` is NOT a completion signal.
    expect(isQualityComplete({ score: null, lint: [], critique: [], strengths: [], checkedAt: "" })).toBe(false);
  });
  it("accepts a scored report", () => {
    expect(isQualityComplete({ score: 7, lint: [], critique: [], strengths: [], checkedAt: "" })).toBe(true);
  });
  it("treats a missing report as incomplete", () => {
    expect(isQualityComplete(null)).toBe(false);
  });
});

describe("slide digests", () => {
  it("flattens nested nodes to plain text", () => {
    expect(extractText([{ type: "p", children: [{ text: "a" }, { type: "b", children: [{ text: "c" }] }] }])).toBe("a c");
  });

  it("picks a heading node for identification", () => {
    expect(slideHeading(slide("s1", "The Case", "body"))).toBe("The Case");
  });

  it("truncates per-slide text and says so", () => {
    const long = slide("s1", "H", "x".repeat(900));
    const [d] = digestSlides([long], { maxCharsPerSlide: 100 });
    expect(d!.text.length).toBeLessThanOrEqual(101);
    expect(d!.textTruncated).toBe(true);
  });

  it("honours a 1-based slideNumbers subset", () => {
    const slides = [slide("a", "A", "1"), slide("b", "B", "2"), slide("c", "C", "3")];
    const out = digestSlides(slides, { slideNumbers: [2] });
    expect(out).toHaveLength(1);
    expect(out[0]!.index).toBe(2);
    expect(out[0]!.heading).toBe("B");
  });

  it("omits speaker notes unless asked", () => {
    const s: PlateSlide = { ...slide("a", "A", "x"), speakerNote: "secret prep note" };
    expect(digestSlides([s])[0]!.speakerNote).toBeUndefined();
    expect(digestSlides([s], { includeSpeakerNotes: true })[0]!.speakerNote).toBe("secret prep note");
  });
});
