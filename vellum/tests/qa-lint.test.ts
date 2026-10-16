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

  it("flags topic headings as major and number-free slides only as advice", () => {
    const s = slide("b", [
      { type: "h1", children: [t("Churn Analysis")] },
      { type: "p", children: [t("Retention has been improving lately across our cohorts and segments overall.")] },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "topic-heading" && i.severity === "major")).toBe(true);
    // Minor on purpose: as a major fault it was a hard gate, and the rewrite
    // it forced invented statistics for slides that had none.
    const nq = issues.find((i) => i.code === "no-quantification");
    expect(nq?.severity).toBe("minor");
    expect(nq?.suggestion).toMatch(/never invent/i);
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

  it("flags column fan-out as major", () => {
    const lanes = Array.from({ length: 6 }, (_, i) => ({
      type: "column",
      children: [{ type: "p", children: [t(`Lane ${i + 1} carries some text.`)] }],
    }));
    const s = slide("a", [
      { type: "h1", children: [t("Too many lanes")] },
      { type: "column_group", children: lanes },
    ]);
    const issues = lintSlides([s], null, "deck");
    const hit = issues.find((i) => i.code === "too-many-columns");
    expect(hit?.severity).toBe("major");
    expect(hit?.issue).toContain("6 lanes");
  });

  it("flags empty column lanes separately", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Blank lanes")] },
      {
        type: "column_group",
        children: [
          { type: "column", children: [{ type: "p", children: [t("Real content here.")] }] },
          { type: "column", children: [] },
          { type: "column", children: [t("  ")] },
        ],
      },
    ]);
    const issues = lintSlides([s], null, "deck");
    const hit = issues.find((i) => i.code === "empty-column");
    expect(hit?.issue).toContain("2 empty lanes");
  });

  it("accepts a two-lane column group", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Balanced lanes")] },
      {
        type: "column_group",
        children: [
          { type: "column", children: [{ type: "p", children: [t("Left lane text, 40% share.")] }] },
          { type: "column", children: [{ type: "p", children: [t("Right lane text, 60% share.")] }] },
        ],
      },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "too-many-columns")).toBe(false);
    expect(issues.some((i) => i.code === "empty-column")).toBe(false);
  });

  it("flags the same label repeated on one slide", () => {
    const s = slide("a", [
      { type: "h1", children: [t("What exactly is AI?")] },
      {
        type: "column_group",
        children: [
          { type: "column", children: [{ type: "h4", children: [t("Machine Learning")] }] },
          { type: "column", children: [{ type: "h4", children: [t("Machine Learning")] }] },
        ],
      },
    ]);
    const issues = lintSlides([s], null, "deck");
    const hit = issues.find((i) => i.code === "repeated-heading");
    expect(hit?.severity).toBe("major");
    expect(hit?.issue).toContain("2 times");
  });

  it("does not flag a single-word heading repeated", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Comparison of the two options")] },
      {
        type: "column_group",
        children: [
          { type: "column", children: [{ type: "h4", children: [t("Before")] }] },
          { type: "column", children: [{ type: "h4", children: [t("Before")] }] },
        ],
      },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "repeated-heading")).toBe(false);
  });

  it("does not flag distinct headings", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Two routes to the same outcome")] },
      {
        type: "column_group",
        children: [
          { type: "column", children: [{ type: "h4", children: [t("Machine Learning")] }] },
          { type: "column", children: [{ type: "h4", children: [t("Deep Learning")] }] },
        ],
      },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "repeated-heading")).toBe(false);
  });

  it("flags a ring caption repeated as a paragraph beside its definition", () => {
    // What a "four nested circles" brief produced: each ring label emitted as
    // a paragraph, then again as the bold opener of its definition.
    const s = slide("a", [
      { type: "h1", children: [t("What exactly is AI?")] },
      {
        type: "column_group",
        children: [
          { type: "column", children: [{ type: "p", children: [t("Artificial Intelligence")] }] },
          {
            type: "column",
            children: [
              { type: "p", children: [t("Artificial Intelligence:")] },
              { type: "p", children: [t("Machines doing tasks that normally need people.")] },
            ],
          },
        ],
      },
    ]);
    const hit = lintSlides([s], null, "deck").find((i) => i.code === "repeated-heading");
    expect(hit?.severity).toBe("major");
  });

  it("does not flag two long paragraphs that share wording", () => {
    const s = slide("a", [
      { type: "h1", children: [t("Two ways to read the same result")] },
      { type: "p", children: [t("Revenue grew because new customers arrived in the spring quarter.")] },
      { type: "p", children: [t("Revenue grew because new customers arrived in the spring quarter.")] },
    ]);
    // Seven-plus words: a repeated sentence is a different fault, not a label.
    expect(lintSlides([s], null, "deck").some((i) => i.code === "repeated-heading")).toBe(false);
  });

  it("flags a STATS block whose values are mostly zero", () => {
    // From a real deck: industries put into STATS with a value of 0 each.
    const item = (stat: string, label: string) => ({
      type: "stats-item",
      stat,
      children: [{ type: "h3", children: [t(label)] }],
    });
    const s = slide("z", [
      { type: "h1", children: [t("AI is reshaping every industry today")] },
      {
        type: "stats",
        children: [
          item("2", "Nobel Prizes in 2024 went to AI work"),
          item("0", "Banking & Finance"),
          item("0", "Healthcare"),
          item("0", "Agriculture"),
        ],
      },
    ]);
    const hit = lintSlides([s], null, "deck").find((i) => i.code === "stats-without-figures");
    expect(hit?.severity).toBe("major");
    expect(hit?.issue).toContain("3 of 4");
  });

  it("accepts a STATS block of real figures, rupees included", () => {
    const item = (stat: string, label: string) => ({
      type: "stats-item",
      stat,
      children: [{ type: "h3", children: [t(label)] }],
    });
    const s = slide("r", [
      { type: "h1", children: [t("India is funding its own AI stack")] },
      {
        type: "stats",
        children: [item("₹10,372 Cr", "IndiaAI outlay"), item("22", "Languages"), item("0", "Fees for students")],
      },
    ]);
    const issues = lintSlides([s], null, "deck");
    expect(issues.some((i) => i.code === "stats-without-figures")).toBe(false);
    // The old pattern only knew $, € and £.
    expect(issues.some((i) => i.code === "stat-not-numeric")).toBe(false);
  });
});
