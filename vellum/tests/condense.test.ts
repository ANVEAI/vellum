import { describe, expect, it } from "vitest";
import {
  condenseRequest,
  isImprovement,
  slidePlainText,
} from "@/lib/generation/pipeline/condense";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { QaIssue } from "@/lib/qa/lint";

const t = (text: string) => ({ text });
const p = (text: string) => ({ type: "p", children: [t(text)] });
const slide = (...content: unknown[]): PlateSlide =>
  ({ id: "s", content, alignment: "center" }) as unknown as PlateSlide;

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const issue = (code: string): QaIssue => ({
  slideId: "s",
  severity: "major",
  code,
  issue: code,
  suggestion: "",
});

describe("the gate keeps a rewrite only when it is better", () => {
  it("keeps a shorter rewrite that clears the overflow", () => {
    const long = slide(p(words(80)));
    const short = slide(p(words(20)));
    const hard = (s: PlateSlide) =>
      (s.content[0] as { children: Array<{ text: string }> }).children[0].text.split(" ")
        .length > 30
        ? [issue("overflow-risk")]
        : [];
    expect(isImprovement(long, short, hard)).toBe(true);
  });

  it("rejects a rewrite that came back just as long", () => {
    // The old gate replaced the slide unconditionally; a 176-word slide
    // regenerated from a brief that dictated it came back at 176 words.
    const a = slide(p(words(120)));
    const b = slide(p(words(120)));
    expect(isImprovement(a, b, () => [issue("overflow-risk")])).toBe(false);
  });

  it("rejects a rewrite that trades one fault for two", () => {
    const original = slide(p(words(60)));
    const candidate = slide(p(words(20)));
    const hard = (s: PlateSlide) =>
      s === original ? [issue("overflow-risk")] : [issue("empty"), issue("topic-heading")];
    expect(isImprovement(original, candidate, hard)).toBe(false);
  });

  it("rejects an empty rewrite", () => {
    expect(isImprovement(slide(p(words(50))), slide(), () => [])).toBe(false);
  });

  it("asks for an edit of the current slide, with a number", () => {
    const current = slide({ type: "h1", children: [t("Voice is the next interface")] }, p(words(40)));
    const req = condenseRequest("BRIEF", 5, 20, { issue: "too long", suggestion: "cut it" }, current, 24);
    expect(req).toContain("BRIEF");
    expect(req).toContain("Rewrite slide 6 of 20");
    expect(req).toContain("at most 24 words");
    expect(req).toContain("Voice is the next interface");
    expect(req).toContain("do not reproduce it word for word");
  });

  it("renders a slide as one line per block", () => {
    expect(
      slidePlainText(slide({ type: "h1", children: [t("Heading")] }, p("Body  text"))),
    ).toBe("Heading\nBody text");
  });
});
