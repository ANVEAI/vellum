/**
 * Which slides get a picture, and what it shows.
 *
 * Root images used to be exactly what the deck model wrote into its stream,
 * and two generations of one 20-slide lecture show what that produces. In
 * one, three image prompts in all, each "Abstract dark purple background
 * with a soft violet radial glow" copied from the brief's colour scheme, and
 * nothing where a picture would have helped — a statement slide carried its
 * one line alone on an empty canvas. In the other, a prompt on every slide:
 * glowing orbs, "particles of text" rendered as invented lettering, a map of
 * India covered in made-up place names, and wide banners above dense slides
 * that left their text too small to read. The model writing two thousand
 * words of slide XML is not also judging, slide by slide, where a picture
 * earns its place.
 *
 * So the decision is a step of its own, taken once the text is final, and it
 * is the only one: the model's own image prompt is a suggestion it weighs.
 *
 * 1. Room, decided here and deterministically. A slide can take a picture
 *    when nothing on it already carries the visual story — no chart, table,
 *    diagram, sequence or headline numbers — and its text is short enough to
 *    sit beside it. A slide without room gets no picture, whatever the model
 *    asked for.
 * 2. Need, decided by one model call for the whole deck: of the slides with
 *    room, which would a picture help the audience understand or remember,
 *    and what should it show? A subject that fails the image-prompt hygiene
 *    every prompt goes through is dropped.
 * 3. Slot: a side rail, alternating sides. Never the wide banner, which takes
 *    the height dense slides need, nor a background, which on most layouts
 *    is a faint wash. The caller saves the deck before queueing the job, so
 *    the image is generated in the rail's portrait shape.
 */
import { z } from "zod";
import { generateStructuredWithRetries } from "@/lib/generation/llm/schema-retry";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import { signatureOf } from "@/lib/design/archetypes";
import { walkNodes } from "@/lib/slides/walk";
import { slidePlainText } from "@/lib/generation/pipeline/condense";
import {
  requestsBackdropOnly,
  requestsSlideFurniture,
  stripTextRequests,
} from "@/lib/images/prompt-hygiene";

/**
 * Components that are already a visual: data, diagrams and sequences, which
 * a side image would squeeze, and which tell the slide's story in shapes.
 * Text components — paragraphs, bullets, boxes, icon lists, callouts,
 * quotes — are what a picture complements.
 */
const VISUAL_COMPONENTS = new Set([
  "table",
  "img",
  "steps",
  "timeline",
  "arrows",
  "arrow-vertical",
  "cycle",
  "pyramid",
  "staircase",
  "slope",
  "snake",
  "circular-grid",
  "connected-circles",
  "compare",
  "before-after",
  "pros-cons",
  "antv-infographic",
  "funnel-flow",
  "kpi-row",
  "progress-rings",
  "pictogram",
  "harvey-table",
  "matrix",
  "org-chart",
  "journey",
  "venn",
  "iceberg",
  "flow-diagram",
]);

/**
 * Words a content slide holds beside a picture rail at full type size,
 * whatever its family's writing budget. The budget is a style choice — the
 * keynote family's is 28 — and was standing in for the physical limit:
 * slides of 30-40 words on that family fitted beside a rail with autofit
 * untouched (measured on the print route, 2026-10-17), as did slides of up
 * to 63 words on three other families. Under the 28-word cap a minimal
 * keynote whose slides now carry their points got one picture in twenty.
 */
const RAIL_WORDS = 40;

/**
 * Whether a picture can sit beside this slide's text without crowding it or
 * competing with a visual the slide already has. A picture the slide already
 * asked for is not counted: the question is whether there is room for one.
 *
 * `capacity` is the theme family's `maxWordsPerSlide`, never taken below
 * RAIL_WORDS. A side rail takes `--v-split`, 40% of the width; a slide within
 * capacity reflows into the rest, while one past it was already tight across
 * the full width.
 */
export function hasRoomForPicture(slide: PlateSlide, capacity: number): boolean {
  const sig = signatureOf(slide);
  if (sig.wordCount === 0) return false;
  // One headline number counts: a statement sets it at numeral size, and a
  // keynote's "30%" beside a rail and a display title autofit to its floor.
  if (sig.hasChart || sig.hasTable || sig.statCount >= 1) return false;
  // Lanes are laid out across the full width; a rail would halve each one.
  if (sig.columnCount > 1) return false;
  let visual = false;
  walkNodes(slide.content, (node) => {
    const type = String(node.type);
    if (VISUAL_COMPONENTS.has(type) || type.startsWith("chart-")) visual = true;
  });
  if (visual) return false;
  return sig.wordCount <= Math.max(capacity, RAIL_WORDS);
}

export interface VisualCandidate {
  /** 0-based position in the deck. */
  index: number;
  role: string;
  heading: string;
  body: string;
  /** The deck model's own image prompt for the slide, when it passed hygiene. */
  current?: string;
}

function roleOf(slide: PlateSlide, index: number, total: number): string {
  if (index === 0) return "opening";
  if (index === total - 1 || slide.archetype === "closing") return "closing";
  switch (slide.archetype) {
    case "divider":
      return "section opener";
    case "statement":
    case "quote-full":
    case "testimonial":
      return "key message";
    default:
      return "content";
  }
}

/** Words a candidate is described to the picture editor with, at most. */
const DESCRIPTION_WORDS = 60;

/**
 * A subject as it can be drawn, or undefined. One that asked for written
 * words or screen content is refused rather than repaired: scrubbing "a
 * split screen showing a poem, a painting and a song" left "a split screen
 * with a dark, blank screen", which was then generated.
 */
function usablePrompt(query: string | undefined): string | undefined {
  if (!query) return undefined;
  const { prompt, removed } = stripTextRequests(query);
  if (removed.length > 0) return undefined;
  if (requestsSlideFurniture(prompt) || requestsBackdropOnly(prompt)) return undefined;
  return prompt;
}

/** The slides that could take a picture, described for the decision. */
export function visualCandidates(
  slides: PlateSlide[],
  capacity: number,
): VisualCandidate[] {
  return slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => hasRoomForPicture(slide, capacity))
    .map(({ slide, index }) => {
      const heading = signatureOf(slide).headingText;
      const lines = slidePlainText(slide)
        .split("\n")
        .filter((line) => line.trim() && line.trim() !== heading);
      const body = lines.join(" · ").split(/\s+/).slice(0, DESCRIPTION_WORDS).join(" ");
      const current = usablePrompt((slide.rootImage as { query?: string } | undefined)?.query);
      return {
        index,
        role: roleOf(slide, index, slides.length),
        heading,
        body,
        ...(current ? { current } : {}),
      };
    });
}

export const VisualDecisionSchema = z.object({
  slides: z.array(
    z.object({
      slide: z.number().int(),
      image: z.boolean(),
      subject: z.string().optional(),
    }),
  ),
});
export type VisualDecisions = z.infer<typeof VisualDecisionSchema>;

/**
 * The decision schema for one set of candidates: an answer must say yes or
 * no for every slide it was asked about.
 *
 * `{"slides": []}` passed the plain schema, and would have counted as a
 * decision against every picture — the writer's own prompts included, since
 * the fallback to them only runs when the call fails. An answer that leaves
 * a slide out is now invalid: it is re-asked with the error, and if it never
 * covers them all, the call fails and the fallback applies.
 */
export function decisionSchemaFor(candidates: VisualCandidate[]) {
  const asked = candidates.map((c) => c.index + 1);
  return VisualDecisionSchema.refine(
    (decisions) => asked.every((slide) => decisions.slides.some((d) => d.slide === slide)),
    { message: `Give one entry for each slide listed: ${asked.join(", ")}.` },
  );
}

/**
 * Enough of the request to say who the audience is and where the talk
 * happens — briefs open with that — without resending a brief that can run
 * to thousands of words.
 */
const REQUEST_EXCERPT = 600;

/** The picture editor's brief. */
export function visualPlanPrompt(
  candidates: VisualCandidate[],
  deck: { title: string; request: string },
): { system: string; user: string } {
  const system = `You are the picture editor for a presentation. For each slide listed, decide whether a photograph or illustration beside its text would help the audience understand or remember the slide's point. If it would, say what the picture shows.

Say yes when the point can be shown: a person doing the thing the slide describes, the object or place itself, a concrete example from the slide, or a scene that carries the moment — the opening, a section's start, the key message, the closing.
Say no when a picture would only decorate: the slide is a list of separate items or categories, a definition that needs its words, or numbers — or when nothing concrete fits. No picture is better than a generic one.

Each subject is one sentence of 8 to 25 words: who or what is in the picture, doing what, and where, in plain nouns an image model can draw. Fit the people and places to the audience and setting the request describes. Describe people by what they are — a speaker, a student, a nurse — never by name: the image model cannot know what a real person looks like. Prefer close views and settings without signs, posters, labels or printed matter: any lettering in the picture comes out as gibberish. Every subject is specific to its slide and different from every other.

Some slides carry the writer's own picture idea. Keep it, word for word, only if it is a concrete subject that shows that slide's point; otherwise replace it or say no. Glowing orbs, light, particles and abstract shapes are decoration, not a subject.

Never ask for:
- written words of any kind: text, labels, letters, numbers, signs, logos, captions, code;
- maps, or anything on a screen — a phone or laptop is fine, its screen is dark and blank;
- charts, diagrams, icons, interfaces, slides or infographics;
- colours, gradients, glows, lighting moods or backgrounds — the deck's visual style is applied to every picture automatically.

Answer with JSON only: {"slides":[{"slide":<number>,"image":true,"subject":"..."},{"slide":<number>,"image":false}]} with one entry per slide listed.`;

  const request = deck.request.replace(/\s+/g, " ").trim();
  const user = `Presentation: ${deck.title}
${request ? `The request it was written from begins: ${request.slice(0, REQUEST_EXCERPT)}${request.length > REQUEST_EXCERPT ? "…" : ""}\n` : ""}
Slides:
${candidates
  .map(
    (c) =>
      `Slide ${c.index + 1} (${c.role}): ${c.heading || "(no heading)"}${c.body ? ` — ${c.body}` : ""}${c.current ? `\n  Writer's picture idea: ${c.current}` : ""}`,
  )
  .join("\n")}`;
  return { system, user };
}

function normalized(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function withoutRootImage(slide: PlateSlide): PlateSlide {
  // A picture that already rendered was chosen by someone — the editor's
  // own image tools — and stays.
  if (!slide.rootImage || (slide.rootImage as { url?: string }).url) return slide;
  const rest = { ...slide };
  delete rest.rootImage;
  return rest;
}

/**
 * Turn the decisions into root images. Pure: returns new slides, and the
 * indices whose picture changed. Every slide in scope ends with exactly the
 * picture the decision gave it — or none: a slide with no room, a "no", and
 * a subject that asks for furniture, only a look, or another slide's picture
 * all leave it without one. Slides outside `scope` are returned untouched.
 */
export function applyVisualPlan(
  slides: PlateSlide[],
  candidates: VisualCandidate[],
  decisions: VisualDecisions,
  scope?: number[],
): { slides: PlateSlide[]; changed: number[] } {
  const inScope = (index: number) => !scope || scope.includes(index);
  const offered = new Set(candidates.map((c) => c.index));
  const chosen = new Map<number, string>();
  // Pictures outside the scope keep their place, so a new one must differ.
  const seen = new Set(
    slides
      .filter((_, i) => !inScope(i))
      .map((s) => (s.rootImage as { query?: string } | undefined)?.query)
      .filter((q): q is string => Boolean(q))
      .map(normalized),
  );
  for (const decision of decisions.slides) {
    const index = decision.slide - 1;
    if (!decision.image || !offered.has(index) || !inScope(index) || chosen.has(index)) continue;
    const prompt = usablePrompt(decision.subject ?? "");
    if (!prompt) continue;
    const key = normalized(prompt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chosen.set(index, prompt);
  }

  // Alternate sides from one picture to the next, as the deck prompt asks.
  // The model writes layout="left" on nearly every section whether or not an
  // image follows, so that attribute says nothing about where a picture
  // belongs. Always a rail: behind the text ("background") a picture is a
  // 25% wash on every archetype but full-bleed, which a display slide's own
  // role outranks in the planner — present, but not something the audience
  // can see.
  const changed: number[] = [];
  let lastSide: "left" | "right" = "right";
  const out = slides.map((slide, index): PlateSlide => {
    if (!inScope(index)) {
      if (slide.rootImage && (slide.layoutType === "left" || slide.layoutType === "right")) {
        lastSide = slide.layoutType;
      }
      return slide;
    }
    const query = chosen.get(index);
    const before = (slide.rootImage as { query?: string } | undefined)?.query;
    if (!query) {
      const next = withoutRootImage(slide);
      if (next !== slide) changed.push(index);
      return next;
    }
    lastSide = lastSide === "left" ? "right" : "left";
    const layoutType: PlateSlide["layoutType"] = lastSide;
    if (before !== query || slide.layoutType !== layoutType) changed.push(index);
    return { ...slide, layoutType, rootImage: { query } };
  });
  return { slides: out, changed };
}

/**
 * Decide and apply the deck's pictures: one structured model call over the
 * slides with room for one. If the call fails — the model down, an answer
 * that never validates — the room rule still applies and the writer's own
 * prompts that pass hygiene stand on the slides that have room; pictures are
 * an improvement to a finished deck, never a reason to fail it.
 */
export async function planPictures(
  slides: PlateSlide[],
  options: {
    /** The theme family's maxWordsPerSlide — see hasRoomForPicture. */
    capacity: number;
    title: string;
    request: string;
    llm: { baseUrl: string; model: string };
    /** Decide only these slides (0-based) — "Regenerate slide" passes one. */
    only?: number[];
    signal?: AbortSignal;
  },
): Promise<{ slides: PlateSlide[]; changed: number[] }> {
  const candidates = visualCandidates(slides, options.capacity).filter(
    (c) => !options.only || options.only.includes(c.index),
  );
  const fallback: VisualDecisions = {
    slides: candidates
      .filter((c) => c.current)
      .map((c) => ({ slide: c.index + 1, image: true, subject: c.current })),
  };
  if (candidates.length === 0) {
    return applyVisualPlan(slides, candidates, fallback, options.only);
  }
  const deck = { title: options.title, request: options.request };
  const ask = (asked: VisualCandidate[], feedback?: string) => {
    const { system, user } = visualPlanPrompt(asked, deck);
    return generateStructuredWithRetries({
      baseUrl: options.llm.baseUrl,
      model: options.llm.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: feedback ? `${user}\n\n${feedback}` : user },
      ],
      schema: decisionSchemaFor(asked),
      // One retry of each kind: this runs while the user waits on a finished
      // deck, and the fallback is a reasonable deck.
      parseRetries: 2,
      validationLoops: 2,
      signal: options.signal,
    });
  };
  let decisions = fallback;
  try {
    decisions = await ask(candidates);
  } catch {
    return applyVisualPlan(slides, candidates, fallback, options.only);
  }

  // A subject that shows writing or a screen's content is refused, not
  // repaired (usablePrompt). On a technology deck the editor reaches for one
  // nearly every time — "a developer reviewing code", "a tablet showing a
  // live video call" — and its brief saying not to does not stop it: over
  // three runs on one keynote it said yes to seven or eight slides and two to
  // four survived, and the generated deck had none. Those slides are asked
  // once more, with the reason; with that, the same runs kept five to eight.
  const refused = decisions.slides.filter(
    (d) => d.image && !usablePrompt(d.subject ?? ""),
  );
  const again = candidates.filter((c) => refused.some((d) => d.slide === c.index + 1));
  if (again.length > 0) {
    const feedback = `These subjects cannot be drawn: ${refused
      .map((d) => `slide ${d.slide}, "${d.subject ?? ""}"`)
      .join("; ")}. Each shows writing or what is on a screen — code, an interface, labels, a video call — which the image model turns into gibberish. Give each of these slides a new subject with nothing written and no screen content: people, objects, places, hands at work, a screen seen from behind. Or answer image false.`;
    try {
      const second = await ask(again, feedback);
      decisions = {
        slides: [
          ...decisions.slides.filter((d) => !again.some((c) => c.index + 1 === d.slide)),
          ...second.slides,
        ],
      };
    } catch {
      // The first answer stands; its refused subjects get no picture.
    }
  }
  return applyVisualPlan(slides, candidates, decisions, options.only);
}
