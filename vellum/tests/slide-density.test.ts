/**
 * Density limits: a content slide carries at least a heading and two points,
 * and density shortens points without squeezing a slide below that.
 *
 * A minimal keynote on the sparest family had a budget of 18 words — the
 * floor itself — and the deck prompt said "use short labels". The model
 * wrote 5-15 word slides of one-word bullets, filling 11-21% of the canvas,
 * and nothing checked for too little.
 */
import { describe, expect, it } from "vitest";
import { CONTENT_FLOOR, slideWordBudget } from "@/lib/design/budget";
import { resolveDesignTokens } from "@/lib/design/tokens";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import { DESIGN_FAMILIES } from "@/lib/design/families";
import { lintSlides } from "@/lib/qa/lint";
import { buildDeckPrompt } from "@/lib/generation/prompts/deck";
import { enrichRequest } from "@/lib/generation/pipeline/condense";
import { endOnSignOff, trimToCount } from "@/lib/generation/pipeline/deck-order";
import { endOutlineOnSignOff, trimOutlineCards } from "@/lib/generation/prompts/outline";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { TElement } from "@/lib/slides/plate-shim";

const el = (type: string, text: string): TElement => ({ type, children: [{ text }] });
const labels = (...items: string[]): TElement => ({
  type: "bullets",
  children: items.map((text) => ({ type: "bullet", children: [el("h4", text)] })),
});
let n = 0;
const slide = (content: unknown[], extra: Partial<PlateSlide> = {}): PlateSlide =>
  ({ id: `s${n++}`, content, alignment: "center", ...extra }) as unknown as PlateSlide;
const sparse = (s: PlateSlide) =>
  lintSlides([s], null, "deck").some((i) => i.code === "sparse-slide" && i.severity === "major");

/** One builtin theme per design family, so the budgets come from real tokens. */
const FAMILY_THEME: Record<(typeof DESIGN_FAMILIES)[number], string> = {
  swiss: "piano",
  editorial: "noir",
  corporate: "daktilo",
  bold: "cosmos",
  organic: "forest",
  tech: "orbit",
  studio: "meridian",
};
const DENSITIES = ["minimal", "concise", "detailed", "extensive"];
const familyBase = (family: (typeof DESIGN_FAMILIES)[number]) => {
  const name = FAMILY_THEME[family];
  const tokens = resolveDesignTokens(resolveThemeOrDefault(name, null), name);
  expect(tokens.family).toBe(family);
  return tokens.content.maxWordsPerSlide;
};

describe("word budget", () => {
  it("leaves every family room above the floor at every density", () => {
    for (const family of DESIGN_FAMILIES) {
      for (const density of DENSITIES) {
        expect(slideWordBudget(familyBase(family), density), `${family}/${density}`).toBeGreaterThan(
          CONTENT_FLOOR,
        );
      }
    }
  });

  it("keeps each family's budgets ordered by density", () => {
    for (const family of DESIGN_FAMILIES) {
      const budgets = DENSITIES.map((d) => slideWordBudget(familyBase(family), d));
      expect([...budgets].sort((a, b) => a - b), family).toEqual(budgets);
    }
  });

  it("no longer clamps the sparest family's minimal budget to the floor", () => {
    // cosmos (bold) is 28 words; x 0.6 is 17, which used to be raised to 18 —
    // the floor itself — leaving the writer no room above a bare minimum.
    expect(familyBase("bold")).toBe(28);
    expect(slideWordBudget(28, "minimal")).toBe(28);
  });
});

describe("sparse-slide lint", () => {
  it("flags a heading over bare labels", () => {
    expect(sparse(slide([el("h3", "The Three-Step Evolution"), labels("Autocomplete", "Copilot", "Agent")]))).toBe(true);
  });

  it("flags a heading and one line on a content layout", () => {
    expect(sparse(slide([el("h2", "What This Enables"), el("p", "Hyper-personalized services driven by real-time logic.")]))).toBe(true);
  });

  it("passes a slide at the floor", () => {
    const enough = slide([
      el("h1", "Copilots now write whole functions from a comment"),
      el("p", "Developers review, test and steer the code instead of typing every line."),
    ]);
    expect(sparse(enough)).toBe(false);
  });

  it("leaves display layouts and sign-offs alone", () => {
    const short = [el("h2", "Velocity has outpaced understanding")];
    for (const archetype of ["statement", "divider", "hero", "closing", "quote-full"]) {
      expect(sparse(slide(short, { archetype } as Partial<PlateSlide>)), archetype).toBe(false);
    }
    expect(sparse(slide([el("h2", "Thank You"), el("p", "@handle")]))).toBe(false);
  });

  it("leaves a slide a visual carries", () => {
    const chart = { type: "chart-bar", data: [{ label: "a", value: 1 }, { label: "b", value: 2 }], children: [{ text: "" }] };
    expect(sparse(slide([el("h1", "Adoption doubled"), chart]))).toBe(false);
    const boxes = { type: "boxes", children: [{ type: "box", children: [el("h3", "One")] }, { type: "box", children: [el("h3", "Two")] }] };
    expect(sparse(slide([el("h1", "Two options"), boxes]))).toBe(false);
    const rendered = slide([el("h2", "The friction point"), el("p", "One line.")], {
      rootImage: { query: "a person at a desk", url: "/api/images/file/a.png" },
    } as Partial<PlateSlide>);
    expect(sparse(rendered)).toBe(false);
  });

  it("does not count a picture that has only been asked for", () => {
    const requested = slide([el("h2", "The friction point"), el("p", "One line.")], {
      rootImage: { query: "a person at a desk" },
    } as Partial<PlateSlide>);
    expect(sparse(requested)).toBe(true);
  });
});

describe("deck prompt", () => {
  const prompt = (textDensity: "minimal" | "concise") =>
    buildDeckPrompt({
      prompt: "The future of generative AI",
      outline: ["## One\n- a", "## Two\n- b"],
      language: "English",
      currentDate: "2026-10-17",
      textDensity,
      wordBudget: 28,
    }).system;

  it("no longer asks a minimal deck for short labels", () => {
    const system = prompt("minimal");
    expect(system).not.toMatch(/use short labels/i);
    expect(system).toMatch(/never a bare label/i);
  });

  it("states the floor beside the ceiling", () => {
    expect(prompt("concise")).toContain(`between ${CONTENT_FLOOR} and 28`);
  });

  it("matches components to the shape of the content", () => {
    const system = prompt("concise");
    expect(system).toMatch(/sequence, process, journey or evolution: STEPS, ARROWS or TIMELINE/);
    expect(system).toMatch(/parallel ideas, options or examples: BOXES or ICONS/);
  });

  it("asks for display moments by role, and slide titles as H1", () => {
    const system = prompt("concise");
    expect(system).toMatch(/Display moments .* are decisions/);
    expect(system).toMatch(/slide's title, written as an H1/);
  });
});

describe("enrich rewrite", () => {
  it("asks for the slide's own substance back, within floor and budget", () => {
    const thin = slide([el("h3", "The Three-Step Evolution"), labels("Autocomplete", "Copilot", "Agent")], {
      speakerNote: "We move from text completion, to a partner that writes code, to an agent that executes tasks.",
    } as Partial<PlateSlide>);
    const text = enrichRequest("USER", 3, 21, { issue: "Slide 4 carries 6 words" }, thin, CONTENT_FLOOR, 28);
    expect(text).toContain("We move from text completion");
    expect(text).toContain(`in ${CONTENT_FLOOR} to 28 words`);
    expect(text).toMatch(/never a bare label/);
    expect(text).toMatch(/Never invent a number, a name, a date or a fact/);
    expect(text).not.toMatch(/move the rest into <NOTES>/);
  });
});

describe("deck order", () => {
  const titled = (title: string) => slide([el("h1", title), el("p", "Body line here.")]);

  it("ends on the sign-off when the model kept writing after it", () => {
    const deck = [titled("Cover"), titled("Point"), titled("Thank You"), titled("The End State")];
    expect(endOnSignOff(deck).map((s) => (s.content[0] as TElement).children[0])).toEqual([
      { text: "Cover" },
      { text: "Point" },
      { text: "The End State" },
      { text: "Thank You" },
    ]);
  });

  it("returns the same deck when it already ends on its sign-off", () => {
    const deck = [titled("Cover"), titled("Point"), titled("The call to action"), titled("Questions?")];
    expect(endOnSignOff(deck)).toBe(deck);
  });

  const titles = (deck: PlateSlide[]) =>
    deck.map((s) => ((s.content[0] as TElement).children[0] as { text: string }).text);
  const planned = (title: string, archetype: string) =>
    ({ ...titled(title), archetype }) as PlateSlide;

  /**
   * Regression: a 10-card pitch came back as 11 slides — the model added a
   * cover and two section dividers — and the trim kept the first ten, so the
   * deck lost "The Ask".
   */
  it("keeps the ending and drops the dividers the writer added", () => {
    const deck = [
      planned("Harbor", "hero"),
      planned("The problem", "content"),
      planned("Market opportunity", "divider"),
      planned("38,000 clinics", "content"),
      planned("Traction", "kpi"),
      planned("The team", "divider"),
      planned("Who we are", "three-up"),
      planned("The ask: $2.5M", "closing"),
    ];
    expect(titles(trimToCount(deck, 7))).toEqual([
      "Harbor", "The problem", "Market opportunity", "38,000 clinics", "Traction", "Who we are", "The ask: $2.5M",
    ]);
    expect(titles(trimToCount(deck, 5))).toEqual([
      "Harbor", "The problem", "38,000 clinics", "Traction", "The ask: $2.5M",
    ]);
  });

  it("cuts from just before the ending when there are no dividers", () => {
    const deck = [planned("Cover", "hero"), planned("A", "content"), planned("B", "content"), planned("Thank You", "content")];
    expect(titles(trimToCount(deck, 3))).toEqual(["Cover", "A", "Thank You"]);
  });

  it("cuts the tail as before when the last slide is not an ending", () => {
    const deck = [planned("Cover", "hero"), planned("A", "content"), planned("B", "content"), planned("C", "content")];
    expect(titles(trimToCount(deck, 3))).toEqual(["Cover", "A", "B"]);
    expect(trimToCount(deck, 4)).toBe(deck);
  });
});

describe("outline order", () => {
  const card = (heading: string) => `## ${heading}\n- a point`;
  const headings = (cards: string[]) => cards.map((c) => c.split("\n")[0].replace("## ", ""));

  /**
   * Regression: topping up a short outline appended four sections after
   * "The Closing Thank You and Resources", which then sat 16th of 20.
   */
  it("moves a sign-off card the continuation buried back to the end", () => {
    const cards = [card("The hook"), card("The shift"), card("The Closing Thank You and Resources"), card("Compute costs"), card("Talent")];
    expect(headings(endOutlineOnSignOff(cards))).toEqual([
      "The hook", "The shift", "Compute costs", "Talent", "The Closing Thank You and Resources",
    ]);
    const done = [card("The hook"), card("Five questions every CTO should ask"), card("Q&A")];
    expect(endOutlineOnSignOff(done)).toBe(done);
  });

  it("trims an outline from before its sign-off", () => {
    const cards = [card("Hook"), card("One"), card("Two"), card("Three"), card("Thank you & resources")];
    expect(headings(trimOutlineCards(cards, 4))).toEqual(["Hook", "One", "Two", "Thank you & resources"]);
    expect(headings(trimOutlineCards([card("Hook"), card("One"), card("Two")], 2))).toEqual(["Hook", "One"]);
  });
});
