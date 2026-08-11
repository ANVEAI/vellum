import { describe, expect, it } from "vitest";
import { lintSlides } from "@/lib/qa/lint";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const t = (text: string) => ({ text });
const slide = (id: string, content: unknown[]): PlateSlide =>
  ({ id, content, alignment: "center" }) as unknown as PlateSlide;

describe("qa lint", () => {
  it("flags empty slides as major", () => {
    const issues = lintSlides([slide("a", [{ type: "p", children: [t("hi")] }])], null, "deck");
    expect(issues.some((i) => i.code === "empty" && i.severity === "major")).toBe(true);
  });

  it("flags duplicate headings", () => {
    const mk = (id: string) =>
      slide(id, [
        { type: "h1", children: [t("Growth Strategy")] },
        { type: "p", children: [t("Enough body text to avoid the empty check here.")] },
      ]);
    const issues = lintSlides([mk("a"), mk("b")], null, "deck");
    expect(issues.filter((i) => i.code === "dup-heading").length).toBe(1);
  });

  it("flags bad chart data", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Numbers")] },
      { type: "p", children: [t("Some body text that is long enough to pass empty.")] },
      { type: "chart-bar", data: [{ label: "Q1", value: "n/a" }], children: [t("")] },
    ]);
    expect(lintSlides([s], null, "deck").some((i) => i.code === "bad-chart-data")).toBe(true);
  });

  it("flags single-item comparison groups", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Compare")] },
      { type: "p", children: [t("Some body text long enough to pass the empty check.")] },
      { type: "compare", children: [{ type: "compare-side", children: [t("only one")] }] },
    ]);
    expect(lintSlides([s], null, "deck").some((i) => i.code === "single-item-group")).toBe(true);
  });

  it("flags unresolved images and outline gaps", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Vision")] },
      { type: "p", children: [t("Plenty of body text so this slide is not empty at all.")] },
      { type: "img", url: "", query: "city skyline", children: [t("")] },
    ]);
    const outline = "# T\n\n## Vision\n- x\n\n## Financial Projections\n- y";
    const issues = lintSlides([s], outline, "deck");
    expect(issues.some((i) => i.code === "image-pending")).toBe(true);
    expect(issues.some((i) => i.code === "outline-gap")).toBe(true);
  });

  it("passes a healthy slide with no issues", () => {
    // "Healthy" now means the Phase-4 content bar: action-title heading
    // (verb + claim) and quantified evidence.
    const s = slide("a", [
      { type: "h1", children: [t("The addressable market reaches $3B by 2027")] },
      { type: "p", children: [t("Regulated verticals adopt fastest, holding 42% of near-term demand.")] },
      {
        type: "stats",
        children: [
          { type: "stats-item", stat: "42%", children: [t("share")] },
          { type: "stats-item", stat: "$3B", children: [t("TAM")] },
        ],
      },
    ]);
    expect(
      lintSlides(
        [s],
        "# T\n\n## Market opportunity\n- addressable market size and demand share",
        "deck",
      ),
    ).toEqual([]);
  });

  it("flags topic headings and evidence-free slides as major", () => {
    const s = slide("b", [
      { type: "h1", children: [t("Churn Analysis")] },
      { type: "p", children: [t("Retention has been improving lately across our cohorts and segments overall.")] },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "topic-heading" && i.severity === "major")).toBe(true);
    expect(issues.some((i) => i.code === "no-quantification" && i.severity === "major")).toBe(true);
  });

  it("flags buzzwords, hedging headings, and vague quantifiers", () => {
    const s = slide("c", [
      { type: "h1", children: [t("Our platform may leverage synergy across teams")] },
      { type: "p", children: [t("This creates significant value for numerous stakeholders.")] },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "buzzword")).toBe(true);
    expect(issues.some((i) => i.code === "hedging")).toBe(true);
    expect(issues.some((i) => i.code === "vague-quantifier")).toBe(true);
  });

  it("flags non-parallel groups and weak openers", () => {
    const s = slide("d", [
      { type: "h1", children: [t("Three moves cut onboarding time 40%")] },
      {
        type: "boxes",
        children: [
          { type: "div", children: [{ type: "h3", children: [t("Automating imports")] }] },
          { type: "div", children: [{ type: "h3", children: [t("Faster setup")] }] },
          { type: "div", children: [{ type: "h3", children: [t("We should also consider improving the documentation experience for admins")] }] },
        ],
      },
      { type: "p", children: [t("There is a clear path to 40% faster onboarding.")] },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "non-parallel")).toBe(true);
  });

  it("exempts breath archetypes from quantification", () => {
    const s = {
      ...slide("e", [
        { type: "h1", children: [t("The future belongs to local intelligence")] },
      ]),
      archetype: "statement",
    };
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "no-quantification")).toBe(false);
  });
});
