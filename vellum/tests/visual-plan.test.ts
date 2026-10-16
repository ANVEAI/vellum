import { describe, expect, it } from "vitest";
import {
  applyVisualPlan,
  hasRoomForPicture,
  visualCandidates,
  visualPlanPrompt,
} from "@/lib/images/visual-plan";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const t = (text: string) => ({ text });
const h1 = (text: string) => ({ type: "h1", children: [t(text)] });
const p = (text: string) => ({ type: "p", children: [t(text)] });
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

let n = 0;
const slide = (content: unknown[], extra: Partial<PlateSlide> = {}): PlateSlide =>
  ({ id: `s${n++}`, content, alignment: "center", archetype: "content", ...extra }) as PlateSlide;

const BUDGET = 30;

describe("room for a picture", () => {
  it("a short statement has room", () => {
    const s = slide([h1("AI won't replace you. Someone using AI might."), p("Start building skills today.")], {
      archetype: "statement",
    });
    expect(hasRoomForPicture(s, BUDGET)).toBe(true);
  });

  it("a slide past the canvas's capacity has none", () => {
    // Capacity is what the canvas holds at full type size; within it, a
    // slide reflows beside a rail with its type one step down.
    expect(hasRoomForPicture(slide([h1("Heading here"), p(words(28))]), BUDGET)).toBe(true);
    expect(hasRoomForPicture(slide([h1("Heading here"), p(words(29))]), BUDGET)).toBe(false);
  });

  it("a slide that already carries a visual has none", () => {
    const chart = slide([h1("Revenue grew"), { type: "chart-bar", data: [{ a: 1 }], children: [t("")] }]);
    const steps = slide([h1("Three steps"), { type: "steps", children: [{ type: "step", children: [p("Listen")] }] }]);
    const kpis = slide([
      h1("By the numbers"),
      { type: "stats", children: [{ type: "stats-item", stat: "4", children: [p("a")] }, { type: "stats-item", stat: "5", children: [p("b")] }] },
    ]);
    const lanes = slide([
      h1("Two sides"),
      { type: "column_group", children: [{ type: "column", children: [p("left")] }, { type: "column", children: [p("right")] }] },
    ]);
    for (const s of [chart, steps, kpis, lanes]) expect(hasRoomForPicture(s, BUDGET)).toBe(false);
  });

  it("does not count a picture the slide already asked for, and an empty slide has none", () => {
    expect(hasRoomForPicture(slide([h1("Has one")], { rootImage: { query: "a harbour at dusk" } }), BUDGET)).toBe(true);
    expect(hasRoomForPicture(slide([]), BUDGET)).toBe(false);
  });
});

describe("applying the decisions", () => {
  const deck = () => [
    slide([h1("AI Today")], { archetype: "hero", layoutType: "background", rootImage: { query: "abstract violet glow" } }),
    slide([h1("What we will cover"), p(words(10))], { layoutType: "left", rootImage: { query: "a glowing orb of data" } }),
    slide([h1("AI won't replace you")], { archetype: "statement", layoutType: "vertical" }),
    slide([h1("Dense slide"), p(words(40))], { layoutType: "vertical", rootImage: { query: "a robotic hand holding a gear" } }),
    slide([h1("Thank you")], { archetype: "closing", layoutType: "left" }),
  ];

  it("offers every slide with room, with its role and the writer's usable idea", () => {
    const candidates = visualCandidates(deck(), BUDGET);
    expect(candidates.map((c) => [c.index, c.role, c.current])).toEqual([
      [0, "opening", undefined],
      [1, "content", "a glowing orb of data"],
      [2, "key message", undefined],
      [4, "closing", undefined],
    ]);
  });

  it("gives each slide exactly the picture decided — or none", () => {
    const slides = deck();
    const { slides: out, changed } = applyVisualPlan(slides, visualCandidates(slides, BUDGET), {
      slides: [
        { slide: 1, image: true, subject: "a packed college lecture hall facing a speaker at a podium" },
        { slide: 2, image: false },
        { slide: 3, image: true, subject: "a student working at a laptop beside a small humanoid robot" },
        { slide: 5, image: true, subject: "students raising their hands in a bright seminar room" },
      ],
    });
    expect(changed).toEqual([0, 1, 2, 3, 4]);
    // Rails, alternating — the opening's "background" included: behind the
    // text a picture is a faint wash.
    expect(out.map((s) => s.layoutType)).toEqual(["left", "left", "right", "vertical", "left"]);
    expect(out[0]!.rootImage).toEqual({ query: "a packed college lecture hall facing a speaker at a podium" });
    // A "no" removes the writer's picture; so does a slide without room.
    expect(out[1]!.rootImage).toBeUndefined();
    expect(out[3]!.rootImage).toBeUndefined();
  });

  it("drops subjects that ask for furniture, only a look, text, a repeat, or a slide not offered", () => {
    const slides = deck();
    const { slides: out } = applyVisualPlan(slides, visualCandidates(slides, BUDGET), {
      slides: [
        { slide: 1, image: true, subject: "a diagram of concentric rings" },
        { slide: 2, image: true, subject: "abstract dark purple background with a soft violet glow" },
        { slide: 3, image: true, subject: "a lighthouse on a cliff at dusk" },
        { slide: 4, image: true, subject: "a fishing boat at dawn" },
        { slide: 5, image: true, subject: "A lighthouse on a cliff at dusk" },
      ],
    });
    expect(out.map((s) => s.rootImage?.query ?? null)).toEqual([
      null,
      null,
      "a lighthouse on a cliff at dusk",
      null,
      null,
    ]);
  });

  it("refuses a subject that asked for words or screen content instead of repairing it", () => {
    const slides = deck();
    const { slides: out } = applyVisualPlan(slides, visualCandidates(slides, BUDGET), {
      slides: [{ slide: 3, image: true, subject: "a split screen showing a poem, a painting and a song being written" }],
    });
    expect(out[2]!.rootImage).toBeUndefined();
  });

  it("leaves slides outside the scope untouched", () => {
    const slides = deck();
    const { slides: out, changed } = applyVisualPlan(
      slides,
      visualCandidates(slides, BUDGET).filter((c) => c.index === 2),
      { slides: [{ slide: 3, image: true, subject: "a student working at a laptop beside a small humanoid robot" }] },
      [2],
    );
    expect(changed).toEqual([2]);
    expect(out[1]).toBe(slides[1]);
    expect(out[3]).toBe(slides[3]);
  });

  it("never removes a picture that already rendered", () => {
    const rendered = slide([h1("Dense"), p(words(40))], { rootImage: { query: "a harbour", url: "/api/images/file/x.png" } });
    const { slides: out } = applyVisualPlan([rendered], [], { slides: [] });
    expect(out[0]!.rootImage?.url).toBe("/api/images/file/x.png");
  });
});

describe("the picture editor's brief", () => {
  it("names each slide, carries the start of the request and the writer's idea", () => {
    const deck = [
      slide([h1("AI won't replace you"), p("Build skills today.")], {
        archetype: "statement",
        rootImage: { query: "a student coding at night beside a window" },
      }),
    ];
    const { system, user } = visualPlanPrompt(visualCandidates(deck, BUDGET), {
      title: "AI Today",
      request: "A one-hour guest lecture at a college in India for undergraduate students.",
    });
    expect(user).toContain("Slide 1 (opening): AI won't replace you — Build skills today.");
    expect(user).toContain("Writer's picture idea: a student coding at night beside a window");
    expect(user).toContain("guest lecture at a college in India");
    expect(system).toMatch(/never ask for/i);
  });
});
