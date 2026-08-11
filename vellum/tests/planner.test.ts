import { describe, expect, it } from "vitest";
import { planDeck, replanSlide } from "@/lib/design/planner";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

let idCounter = 0;
function el(type: string, text: string, children: unknown[] = []) {
  return {
    id: `el-${idCounter++}`,
    type,
    children: children.length ? children : [{ text }],
  };
}
function group(type: string, itemCount: number, extra: Record<string, unknown> = {}) {
  return {
    id: `el-${idCounter++}`,
    type,
    ...extra,
    children: Array.from({ length: itemCount }, (_, i) => ({
      id: `el-${idCounter++}`,
      type: "div",
      ...(type === "stats" ? { stat: `${40 + i}%` } : {}),
      children: [
        el("h3", `Item ${i + 1}`),
        el("p", "Short supporting sentence here."),
      ],
    })),
  };
}
function slide(
  partial: Omit<Partial<PlateSlide>, "content"> & { content: unknown[] },
): PlateSlide {
  return {
    id: `slide-${idCounter++}`,
    alignment: "center",
    ...partial,
  } as unknown as PlateSlide;
}

const heroSlide = () =>
  slide({
    content: [el("presentation-title", "Vellum Deck"), el("p", "A short tagline")],
    rootImage: { query: "cityscape" } as unknown as PlateSlide["rootImage"],
    layoutType: "background",
  });
const contentSlide = () =>
  slide({
    content: [el("h1", "A heading with a claim in it"), group("bullets", 3)],
    rootImage: { query: "office" } as unknown as PlateSlide["rootImage"],
    layoutType: "left",
  });
const kpiSlide = () =>
  slide({ content: [el("h1", "Numbers that matter"), group("stats", 4)] });
const chartSlide = () =>
  slide({
    content: [
      el("h1", "Revenue is compounding"),
      { id: `el-${idCounter++}`, type: "chart-bar", data: [], children: [{ text: "" }] },
    ],
  });
const quoteSlide = () =>
  slide({
    content: [
      {
        id: `el-${idCounter++}`,
        type: "quote",
        author: "A. Person",
        children: [{ text: "A memorable one-liner." }],
      },
    ],
  });
const statementSlide = () =>
  slide({ content: [el("h2", "One bold claim, few words.")] });

function deck(): PlateSlide[] {
  return [
    heroSlide(),
    contentSlide(),
    kpiSlide(),
    chartSlide(),
    quoteSlide(),
    contentSlide(),
    statementSlide(),
    contentSlide(),
  ];
}

describe("layout planner", () => {
  it("is deterministic", () => {
    const slides = deck();
    const a = planDeck(slides).map((s) => s.archetype);
    const b = planDeck(slides).map((s) => s.archetype);
    expect(a).toEqual(b);
  });

  it("is prefix-stable (backward-looking only)", () => {
    const slides = deck();
    for (let i = 1; i < slides.length; i++) {
      const shorter = planDeck(slides.slice(0, i)).map((s) => s.archetype);
      const longer = planDeck(slides.slice(0, i + 1)).map((s) => s.archetype);
      expect(longer.slice(0, i)).toEqual(shorter);
    }
  });

  it("assigns hero to an eligible first slide only", () => {
    const planned = planDeck(deck());
    expect(planned[0].archetype).toBe("hero");
    const chartFirst = planDeck([chartSlide(), contentSlide()]);
    expect(chartFirst[0].archetype).toBe("content");
  });

  it("infers kpi, chart-focus, quote-full, statement from content", () => {
    const planned = planDeck(deck());
    expect(planned[2].archetype).toBe("kpi");
    expect(planned[3].archetype).toBe("chart-focus");
    expect(planned[4].archetype).toBe("quote-full");
    expect(planned[6].archetype).toBe("statement");
  });

  it("honors a valid role and rejects an invalid one", () => {
    const withRole = [heroSlide(), { ...statementSlide(), intent: "divider" }];
    expect(planDeck(withRole)[1].archetype).toBe("divider");
    const invalid = [heroSlide(), { ...contentSlide(), intent: "kpi" }];
    // Bullets slide can't be a KPI grid — planner overrides to a workhorse.
    expect(planDeck(invalid)[1].archetype).not.toBe("kpi");
  });

  it("blocks immediate repeats of special archetypes", () => {
    const planned = planDeck([heroSlide(), quoteSlide(), quoteSlide()]);
    expect(planned[1].archetype).toBe("quote-full");
    expect(planned[2].archetype).not.toBe("quote-full");
  });

  it("replans one slide without touching neighbors", () => {
    const planned = planDeck(deck());
    const before = planned.map((s) => s.archetype);
    const mutated = [...planned];
    // Regenerated slide 3 comes back as a quote-only slide.
    mutated[3] = { ...quoteSlide(), id: planned[3].id };
    mutated[3] = replanSlide(mutated, 3);
    expect(mutated[3].archetype).toBe("quote-full");
    mutated.forEach((s, i) => {
      if (i !== 3) expect(s.archetype).toBe(before[i]);
    });
  });

  it("stamps every slide with some archetype", () => {
    for (const s of planDeck(deck())) {
      expect(typeof s.archetype).toBe("string");
      expect(s.archetype!.length).toBeGreaterThan(0);
    }
  });
});
