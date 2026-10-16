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

describe("a rewrite must still be the slide", () => {
  const h1 = (text: string) => ({ type: "h1", children: [t(text)] });
  const callout = (text: string) => ({ type: "callout", children: [p(text)] });
  const industries = slide(
    h1("AI is reshaping every industry"),
    p("Banking and finance: fraud detection, credit scoring, trading"),
    p("Accounting and audit: reading invoices, reconciliation, spotting anomalies"),
    p("Healthcare: reading scans, early diagnosis"),
    p(words(40)),
  );
  const overflowing = (s: PlateSlide) =>
    s === industries ? [issue("overflow-risk"), issue("too-many-columns")] : [];

  it("rejects an answer about the edit instead of the slide", () => {
    // The real answer: no heading, twelve words, no hard issues — it won.
    const note = slide(callout(`Slide 9: Removed duplicate "Accounting & audit" entries. Reordered list for clarity.`));
    expect(isImprovement(industries, note, overflowing)).toBe(false);
  });

  it("rejects a rewrite that lost the heading", () => {
    const headless = slide(p("Banking and finance: fraud detection, credit scoring"));
    expect(isImprovement(industries, headless, overflowing)).toBe(false);
  });

  it("rejects a rewrite about something else", () => {
    const other = slide(h1("Voice agents answer customer calls"), p("Support lines run around the clock"));
    expect(isImprovement(industries, other, overflowing)).toBe(false);
  });

  it("keeps a condensed rewrite with a sharper heading", () => {
    const condensed = slide(
      h1("AI already works inside banking, audit and healthcare"),
      p("Fraud detection and credit scoring"),
      p("Reading invoices and spotting anomalies"),
      p("Reading scans for early diagnosis"),
    );
    expect(isImprovement(industries, condensed, overflowing)).toBe(true);
  });

  it("counts the outline entry as the slide's own material", () => {
    const fromOutline = slide(h1("Chemistry's Nobel went to protein folding"), p("AlphaFold predicts protein structures"));
    const original = slide(h1("Two Nobel prizes went to AI work"), p(words(60)));
    const hard = (s: PlateSlide) => (s === original ? [issue("overflow-risk")] : []);
    expect(isImprovement(original, fromOutline, hard)).toBe(false);
    expect(
      isImprovement(original, fromOutline, hard, {
        reference: "Nobel Chemistry prize: AlphaFold predicts protein structures",
      }),
    ).toBe(true);
  });
});

describe("a rewrite must not become another slide", () => {
  const h1 = (text: string) => ({ type: "h1", children: [t(text)] });
  const title = (text: string) => ({ type: "presentation-title", children: [t(text)] });
  const agenda = slide(
    { type: "label", children: [t("TODAY'S JOURNEY")] },
    h1("What we'll cover in the next hour"),
    p("01 AI basics: what AI really is, its history and everyday use"),
    p("02 What's trending: generative AI, agents and India's moment"),
    p(words(30)),
  );
  const tooManyLanes = (s: PlateSlide) => (s === agenda ? [issue("too-many-columns")] : []);
  const elsewhere = ["AI Today: Trends, Voice AI & Your Future", "Raise your hand if…"];

  it("rejects a second title slide in place of the agenda", () => {
    // The real rewrite: the deck title as a TITLE, the agenda's own heading
    // demoted to a paragraph, every one of its six parts gone.
    const cover = slide(
      title("AI Today: Trends, / Voice AI & Your Future"),
      { type: "label", children: [t("TODAY'S JOURNEY")] },
      p("What we'll cover in the next hour"),
    );
    expect(isImprovement(agenda, cover, tooManyLanes, { elsewhere })).toBe(false);
  });

  it("rejects a heading that is another slide's", () => {
    const copy = slide(h1("Raise your hand if…"), p("What we'll cover: AI basics, history, everyday use"));
    expect(isImprovement(agenda, copy, tooManyLanes, { elsewhere })).toBe(false);
  });

  it("keeps a real condensed agenda", () => {
    const condensed = slide(
      h1("Six parts in one hour, from AI basics to your career"),
      p("AI basics, history and everyday use"),
      p("Generative AI, agents and India's moment"),
    );
    expect(isImprovement(agenda, condensed, tooManyLanes, { elsewhere })).toBe(true);
  });
});
