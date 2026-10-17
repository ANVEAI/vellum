import { describe, expect, it } from "vitest";
import { planDeck, replanSlide } from "@/lib/design/planner";
import { SlideParser } from "@/lib/generation/parser/slide-parser";
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
  slide({ content: [el("h2", "One number carries the argument."), group("stats", 1)] });
const shortSlide = (heading = "One bold claim, few words.") =>
  slide({ content: [el("h2", heading), el("p", "A single supporting line.")] });

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

  it("infers kpi, chart-focus, quote-full, and statement from a single number", () => {
    const planned = planDeck(deck());
    expect(planned[2].archetype).toBe("kpi");
    expect(planned[3].archetype).toBe("chart-focus");
    expect(planned[4].archetype).toBe("quote-full");
    expect(planned[6].archetype).toBe("statement");
  });

  it("honors a valid role and rejects an invalid one", () => {
    const withRole = [heroSlide(), { ...shortSlide(), intent: "divider" }];
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

  /**
   * Regression: a COLUMNS group did not count toward groupItemCount, so a
   * slide carrying 13 lanes read as groupItemCount 0 and qualified for
   * `statement` — an archetype that renders its heading at display size.
   * The generated deck that exposed this overflowed its canvas by 109px.
   */
  it("keeps display-type archetypes off multi-lane column slides", () => {
    const columns = (lanes: number) => ({
      id: "cg",
      type: "column_group",
      children: Array.from({ length: lanes }, (_, i) => ({
        id: `col-${i}`,
        type: "column",
        children: [el("h4", `Lane ${i + 1}`), el("p", "Supporting detail.")],
      })),
    });
    const dense = slide({
      content: [el("label", "06 - YOU & AI"), el("h1", "Short heading"), columns(13)],
    });
    const planned = planDeck([heroSlide(), dense]);
    expect(planned[1].archetype).not.toBe("statement");
    expect(planned[1].archetype).not.toBe("divider");
    expect(planned[1].archetype).not.toBe("full-bleed");
  });

  it("still allows display archetypes when there are no column lanes", () => {
    const bare = slide({ content: [el("h1", "One decisive line")] });
    const planned = planDeck([heroSlide(), bare]);
    expect(["statement", "divider", "content"]).toContain(planned[1].archetype);
  });

  it("ignores empty lanes when counting columns", () => {
    const oneRealLane = {
      id: "cg2",
      type: "column_group",
      children: [
        { id: "c0", type: "column", children: [el("p", "Only real lane.")] },
        { id: "c1", type: "column", children: [] },
        { id: "c2", type: "column", children: [{ text: "   " }] },
      ],
    };
    const s = slide({ content: [el("h1", "Short"), oneRealLane] });
    // One real lane is not "parallel content", so display type stays legal.
    const planned = planDeck([heroSlide(), s]);
    expect(typeof planned[1].archetype).toBe("string");
  });

  /**
   * Regression: given one example image prompt, the model copied it onto 16
   * of 20 slides. The planner drops a root image whose prompt an earlier
   * slide already used.
   */
  it("drops a root image whose prompt an earlier slide used", () => {
    const withImage = (q: string) =>
      slide({ content: [el("h1", "A heading"), el("p", "Body text.")], rootImage: { query: q } } as never);
    const planned = planDeck([
      heroSlide(),
      withImage("a futuristic smart city at dawn"),
      withImage("A futuristic   smart city at dawn"),
      withImage("container cranes at a harbour"),
    ]);
    expect(planned[1].rootImage).toBeDefined();
    expect(planned[2].rootImage).toBeUndefined();
    expect(planned[3].rootImage).toBeDefined();
  });

  it("never drops an image that already rendered", () => {
    const rendered = slide({
      content: [el("h1", "A heading"), el("p", "Body.")],
      rootImage: { query: "same prompt", url: "/api/images/file/a.png" },
    } as never);
    const first = slide({
      content: [el("h1", "Another"), el("p", "Body.")],
      rootImage: { query: "same prompt" },
    } as never);
    expect(planDeck([heroSlide(), first, rendered])[2].rootImage).toBeDefined();
  });

  it("keeps the repeat check prefix-stable for the streaming preview", () => {
    const a = slide({ content: [el("h1", "One"), el("p", "x.")], rootImage: { query: "q" } } as never);
    const b = slide({ content: [el("h1", "Two"), el("p", "y.")], rootImage: { query: "q" } } as never);
    const prefix = planDeck([heroSlide(), a]);
    const full = planDeck([heroSlide(), a, b]);
    expect(full[1]).toEqual(prefix[1]);
  });

  it("drops a root image that asks for a diagram instead of a subject", () => {
    const diagram = slide({
      content: [el("h1", "What exactly is AI?"), el("p", "Layers.")],
      rootImage: { query: "nested concentric circles diagram labelled by layer" },
    } as never);
    expect(planDeck([heroSlide(), diagram])[1].rootImage).toBeUndefined();
  });

  /**
   * Regression: the model suggested role="statement" for a slide carrying a
   * line chart; statement accepted it, rendered an 84px heading above the
   * chart, and the slide overflowed by 50px.
   */
  it("never gives a display-type archetype to a chart slide", () => {
    const chartSlide = slide({
      intent: "statement",
      content: [
        el("h1", "Error mitigation improved fidelity by 14%"),
        { id: "c", type: "chart-line", data: [{ label: "a", value: 1 }], children: [{ text: "" }] },
      ],
    } as never);
    const planned = planDeck([heroSlide(), chartSlide]);
    expect(["statement", "divider", "full-bleed", "hero", "closing"]).not.toContain(
      planned[1].archetype,
    );
  });
});


describe("image prompts on a replanned slide", () => {
  // The quality gate and "Regenerate slide" replan one slide. That path used
  // to skip the image rules planDeck applies, and a rewritten slide asked for
  // "concentric rings diagram on dark purple background".
  const withImage = (query: string) =>
    slide({
      content: [el("h1", "What exactly is AI, in four rings"), el("p", "Short line.")],
      rootImage: { query } as unknown as PlateSlide["rootImage"],
      layoutType: "left",
    });

  it("drops furniture, a look with no subject, and a repeat of an earlier slide", () => {
    const earlier = withImage("container cranes at a harbour at dusk");
    for (const query of [
      "concentric rings diagram on dark purple background",
      "abstract dark purple background with a soft violet radial glow",
      "container cranes at a harbour at dusk",
    ]) {
      const replanned = replanSlide([earlier, withImage(query)], 1);
      expect(replanned.rootImage, query).toBeUndefined();
    }
  });

  it("keeps a concrete, new subject", () => {
    const replanned = replanSlide([withImage("a harbour at dusk"), withImage("a farmer photographing a leaf")], 1);
    expect(replanned.rootImage).toEqual({ query: "a farmer photographing a leaf" });
  });
});

describe("display type is a decision", () => {
  /**
   * Regression: statement was inferred for any slide under 30 words, and
   * special layouts may not repeat back to back, so a run of same-shaped
   * slides alternated between a 110px and a 36px title (a 21-slide keynote,
   * slides 13-19).
   */
  it("gives a run of same-shaped short slides one treatment", () => {
    const planned = planDeck([
      heroSlide(),
      shortSlide("What this unlocks for teams"),
      shortSlide("What this enables for customers"),
      shortSlide("What this demands of leaders"),
      shortSlide("What this changes by next year"),
    ]);
    const treatments = new Set(planned.slice(1).map((s) => s.archetype));
    expect(treatments).toEqual(new Set(["content"]));
  });

  it("honors a statement the writer asked for", () => {
    const planned = planDeck([heroSlide(), { ...shortSlide(), intent: "statement" }]);
    expect(planned[1].archetype).toBe("statement");
  });

  it("reads a role written into the layout attribute", () => {
    const parser = new SlideParser({ mode: "deck" });
    parser.parseChunk(
      '<PRESENTATION><SECTION layout="statement"><H2>Time is the new currency</H2><P>One line.</P></SECTION></PRESENTATION>',
    );
    parser.finalize();
    const [parsed] = parser.getAllSlides();
    expect(parsed.intent).toBe("statement");
    expect(parsed.layoutType).toBe("left");
  });

  it("does not turn a slide into a statement or divider for relief", () => {
    const planned = planDeck([heroSlide(), kpiSlide(), chartSlide(), shortSlide()]);
    expect(planned[3].archetype).toBe("content");
  });

  it("recognises a sign-off as the closing slide", () => {
    for (const heading of ["Thank You", "Thank You & Resources", "Questions?", "Q&A", "Any questions"]) {
      const planned = planDeck([heroSlide(), contentSlide(), shortSlide(heading)]);
      expect(planned[2].archetype, heading).toBe("closing");
    }
    const notOne = planDeck([heroSlide(), contentSlide(), shortSlide("Thanks to our partners, revenue doubled")]);
    expect(notOne[2].archetype).not.toBe("closing");
  });

  it("offers three-up only to a row of boxes or icons", () => {
    const bullets = slide({ content: [el("h1", "Three points in a list"), group("bullets", 3)] });
    const boxes = slide({ content: [el("h1", "Three ideas side by side"), group("boxes", 3)] });
    expect(planDeck([heroSlide(), bullets])[1].archetype).not.toBe("three-up");
    expect(planDeck([heroSlide(), boxes])[1].archetype).toBe("three-up");
  });
});
