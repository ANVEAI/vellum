/**
 * Whole-deck generation prompt (one streaming LLM call for the entire deck).
 *
 * Guidance text derived from allweonedev/presentation-ai (MIT License)
 * src/lib/presentation/generation-prompt.ts — see THIRD_PARTY_LICENSES.md.
 * Simplified to the "no template" path; vellum's image default is generated
 * images (ComfyUI/FLUX), so the descriptive image-prompt style is used.
 */
import {
  COMPONENT_INSTRUCTIONS,
  LAYOUT_REFERENCE,
} from "@/lib/generation/parser/xml-catalog";

import {
  CONTENT_FLOOR,
  slideWordBudget,
  type TextDensity,
} from "@/lib/design/budget";
import { EMOJI_ACCENTS, restrainedTone } from "@/lib/slides/emoji-accents";

export type { TextDensity };
export { slideWordBudget };

export interface DeckPromptInput {
  prompt: string;
  title?: string;
  outline: string[]; // one entry per slide (markdown)
  language: string;
  tone?: string;
  audience?: string;
  textDensity?: TextDensity;
  researchContext?: string; // formatted SearXNG context (already framed)
  /** Numbered reference count for citations (URLs never reach the model). */
  sourceCount?: number;
  currentDate: string;
  imageStyle?: "generated" | "stock";
  templateGuidance?: string; // formatted template blueprint guidance
  /**
   * Words a standard content slide may carry, from the theme family's
   * `maxWordsPerSlide` token. Omitted falls back to the corporate figure.
   *
   * This has to be the same number the design system and the lint use. It
   * was a hardcoded 60 (ceiling 90) for every theme, while the families
   * range from 28 to 70 — so on a dense family the model was invited to
   * write more than twice what the slide could hold, and no amount of
   * render-time fitting could recover the difference.
   */
  wordBudget?: number;
}


const GENERATED_IMAGE_STYLE = `Image instruction:
- Use \`<IMG query="...">\` with a detailed descriptive prompt to generate an image.
- Keep slide text/content in the requested presentation language.
- Write image prompts in English unless the user explicitly requested another language for generated visuals.

The image is a PHOTOGRAPH OR ILLUSTRATION OF A SUBJECT that sits behind or beside
the slide's text. It is never a picture of the slide itself. The renderer draws
every card, label, number, timeline, chart and icon natively — an image that
tries to draw them competes with the real ones and loses.

Each image depicts THIS slide. Read the slide's heading and ask what a viewer
should see beside that claim: an object, a scene, a person at work, or a visual
metaphor they would connect to it.

Describe only that subject and its setting:
- The thing itself: people, places, objects, materials, landscapes, machinery
- Style (photorealistic, illustration, cinematic), lighting and mood
- Clear negative space on one side for slide text

Do not describe colours, a palette, gradients, glows or the deck's background.
The deck's style preset and theme are applied to every image automatically, so
a prompt that restates them carries no subject at all — "a dark background with
a soft violet glow" says nothing about the slide it sits on. If no concrete
subject fits a slide, leave the image out rather than fill it with a backdrop.

Never ask the image for any of these, however the user's brief is worded:
- Written language of any kind — words, labels, captions, titles, numbers,
  quoted strings, signage, or a ring/box/arrow "labeled" something. Image models
  render these as convincing gibberish, which is worse than leaving them out.
- Slide furniture: cards, panels, pills, bullet lists, tables, charts, graphs,
  timelines, diagrams, flow arrows, org charts, UI, dashboards, mockups, icons
- A screen showing anything — an app, a map, a website, a document. Phones and
  laptops are fine subjects; what is on their screens becomes gibberish text
- Hex colour codes or pixel measurements
- Placeholders, brackets, vague references, or AI tools and model names

If the slide's brief describes a diagram or a labelled layout, build it from the
components above and give the image a plain subject instead — or omit the image.

How a heading becomes its image (illustrations of the reasoning, from decks on
other subjects — not queries to reuse):
- "Churn fell 34% after the onboarding redesign" → a customer relaxed at a
  kitchen table with a laptop, soft morning light, shallow depth of field
- "Our cold chain now spans 40 ports" → refrigerated containers stacked at a
  harbour at dusk, long exposure, cranes in silhouette
- "Three teams now ship on one calendar" → three colleagues around a standing
  desk mid-conversation, natural window light

Every slide's image is different and specific to that slide. Never repeat a
query across slides, and never reuse one of the illustrations above.`;

const STOCK_IMAGE_STYLE = `Image instruction:
- Use \`<IMG query="..." />\` with a short English keyword query to find a stock image.
- Use 2-5 words: concrete nouns and noun phrases only (people, place, object, industry, activity).
- Do NOT write sentences, camera directions, lighting, mood, or art style.

\`\`\`xml
<IMG query="team collaboration" />
<IMG query="solar panels roof" />
\`\`\``;

/**
 * The model reads a design brief — exact point sizes, hex colours, "four
 * nested circles", pixel offsets — and tries to reproduce it in markup:
 * `<DIV style="width: 200px; border-radius: 50%; background: #3B1F7A;
 * margin-top: -100px">` nested four deep inside COLUMNS. The styles are
 * discarded by the renderer but the nesting is not, so the decorative ring
 * labels became paragraphs printed beside the definitions they decorated, and
 * slides grew far taller than their canvas. Nothing in the prompt said the
 * markup cannot carry visual design, so this says it.
 */
const RENDERER_OWNS_DESIGN = `Vellum draws the visual design itself. Typography, colour, spacing, cards and slide backgrounds all come from the deck's theme. Your job is the words and the choice of component.

- Never put style, class, width, height, color, font or any other presentational attribute on an element. They are discarded; the markup around them is not, and it breaks the slide.
- Never build a layout out of nested <DIV>s — rings, cards, grids, panels, pills. Pick the component that expresses the idea: STEPS or TIMELINE for a sequence, BOXES or ICONS for a set, COMPARE for two sides, STATS for numbers, PYRAMID or STAIRCASE for layers.
- When the user's request specifies fonts, point sizes, hex colours, pixel positions or exact slide furniture, read it as intent — the deck should feel that way — and express it through components and wording. Do not try to reproduce it in markup.
- Close every tag you open. A heading (TITLE, H1-H6, LABEL) holds one line of text and nothing else; content that follows it goes after its closing tag.
- One heading per slide carries the claim: the slide's title, written as an H1 (the cover's as TITLE). The renderer gives every slide title the same size, so never write a title as H2 or H3 to make it smaller. A short line above it is a LABEL; a supporting line below it is a P. Never a second large heading.`;

const WRITING_RULES = `WRITING RULES — these override style preferences:
1. Every content slide's title (its H1) is a complete sentence stating the slide's conclusion — subject + verb + object, 6-15 words.
   WRITE: "Enterprise churn fell to 2.1% after the SSO launch"
   NOT: "Churn Analysis" / "Q3 Overview" / "Key Findings"
2. When a slide has a CHART, TABLE, or STATS, the heading states what the data proves, not what the data is.
3. Use the specific numbers the request, outline or reference material gives you, with unit and period: "Revenue grew 31% YoY", not "Revenue grew". NEVER invent a figure, percentage, date, count or statistic that is not in that material. A true sentence without a number beats a precise one that is made up. If a slide's point has no real number, make it with a concrete example instead, and do not put it in STATS.
4. Items in one group share a grammatical shape — all verb-first or all noun-phrase, never mixed — and stay within 2x each other's length.
5. Bullets ≤ 14 words. Groups ≤ 5 items.
6. Vague quantifiers (significant, substantial, dramatic, many, several, numerous, various) are banned unless a number follows in the same sentence.
7. Banned outright: leverage (as a verb), synergy, holistic, seamless, robust, world-class, best-in-class, cutting-edge, state-of-the-art, paradigm shift, game-changer, unlock value, empower, revolutionize, disrupt.
8. No hedging: might, may, could, perhaps, possibly, potentially, arguably, somewhat, relatively, generally, tends to, appears to. State it or cut it.
9. Never open a bullet with "There is/are", "It is", "This is", "We believe", "In order to".
10. Never restate the heading in the first bullet.
11. So-what test: if a reader could only answer "so what?" by reading the body, rewrite the heading.
12. NOTES carry the argument and caveats in spoken voice; the slide carries the claim and evidence. Never duplicate sentences between them.`;

function deckRhythm(budget: number): string {
  const breath = Math.max(12, Math.round(budget * 0.55));
  return `Design the deck's RHYTHM like a professional designer — vary composition, don't repeat one pattern:
- Slide 1 is the hero: role="hero", a short powerful title, ideally layout="background" with a strong full-bleed image, under ${breath} words total.
- When the deck has 3+ distinct parts, open each part with a section divider: role="divider", layout="background" or no image, just a heading (and one short line), under ${breath} words.
- Give the single most important number its own moment: role="statement" with one STATS item or one bold claim, under ${breath} words.
- Use role="quote" for a slide that is only a QUOTE. Use role="kpi" when a slide is 3-5 headline STATS.
- End with role="closing": the call to action or takeaway, mirroring the hero's brevity.
- Display moments — hero, divider, statement, quote, closing — are decisions: each carries its role attribute, and a short slide without one is laid out as an ordinary content slide. Keep them to about one slide in four; every other slide is a content slide with a component.
- WORD BUDGET, measured over every word on the slide including the heading: hero/divider/statement/closing at most ${breath}; standard content slides between ${CONTENT_FLOOR} and ${budget}. The ceiling is a hard limit set by the theme's type size, not a style preference — a slide that exceeds it is physically cut off at the bottom edge. If a section needs more, say less: cut qualifiers, drop the third example, move detail into <NOTES>. Never split one outline section across two slides. The floor is just as real: a content slide under ${CONTENT_FLOOR} words is a heading and a line on an empty canvas. Give each point a few words of explanation or an example from the outline, or make the slide a deliberate display moment with its role.
- Write ACTION TITLES: each content slide's heading is a full-sentence claim stating the takeaway (e.g. "Churn fell 34% after onboarding redesign"), not a topic label (not "Churn").
- Alternate image sides across consecutive image slides (layout="left" then "right"). After two dense data slides, give the audience a breath: an image-led or statement slide.`;
}

const FORMAT_GUIDANCE = `Use the available formats intentionally according to each slide's content and purpose:
- Pick list-style components for grouped points.
- Pick sequence components for processes or maturity paths.
- Pick comparison components for trade-offs or before/after states.
- Pick relationship components for connected concepts.
- Pick data components for evidence.
- Use columns as a special mixed-content container when a slide needs balanced lanes, item images, charts, or nested supported content.

Match the component to the shape of the content:
- A sequence, process, journey or evolution: STEPS, ARROWS or TIMELINE, each stage saying what happens or changes at that stage.
- Two to four parallel ideas, options or examples: BOXES or ICONS, each item a short heading and one line that explains it.
- Two sides — before and after, a trade-off, a comparison: COMPARE, BEFORE-AFTER or PROS-CONS.
- Headline numbers: STATS. Values compared or tracked over time: CHART.
- Points that each need a full sentence: BULLETS.
Every item carries a point, never a bare label: "Copilot — writes whole functions from a one-line comment", not "Copilot".

**Make sure there is high degree of visual and structural variety across the deck. Avoid using the same component more than once or twice in a row, to reduce visual monotony and maintain audience engagement.**`;

const VISUAL_GUIDANCE = `Use images deliberately:
- Add a root image when it complements the component layout.
- Use item-level images inside COLUMNS when each lane needs a visual.
- Pair image placement and component geometry: vertical root images create a wide lower content area, so favor horizontal components; left/right root images create a narrower side content area, so favor vertical or compact components.
- Omit the root image when the component already carries the visual story.

Use icons only as search hints:
- When a supported item needs an icon, set icon to one lowercase English keyword such as security, analytics, team, growth, upload, idea, automation, calendar, money, network, settings, document, or message.
- For icon-list visuals, use <ICONS variant="icon"> with DIV icon attributes for symbolic lists. Use orientation="side" when the visual should sit beside the text and orientation="top" when it should sit above the text.

Use charts only for real numeric comparisons, trends, shares, distributions, or correlations:
- Use STATS for headline metrics.
- Use TABLE for exact row/column comparison.
- Use CHART for visual data, with a markdown table directly inside <CHART>; the header row defines field names once.
- For multi-series charts, add more columns: label, revenue, profit.
- For scatter or bubble charts, use x, y, and optional z columns.`;

/**
 * Emoji accents (lib/slides/emoji-accents.ts). The model proposes; the
 * pipeline keeps a proposal only on a display moment, and clean.ts takes any
 * emoji out of the copy — this says so up front, so the model spends its
 * emoji where they will be kept. The serious-subject rule is the model's to
 * apply: Microsoft's style guide keeps emoji off serious topics, and only the
 * writer can tell a post-mortem from a product launch.
 */
function emojiGuidance(restrained: boolean): string {
  const slides = restrained
    ? "This deck's tone is formal, so exactly two slides carry one: the hero and the closing."
    : "The hero and the closing each carry one, and so does each section divider.";
  return `A few slides carry one emoji as an accent, which the renderer draws as a picture above the slide's title. ${slides} Write it as emoji="…" on that SECTION, choosing the symbol from this list that fits the slide's idea:
${EMOJI_ACCENTS.map((accent) => accent.emoji).join(" ")}
- One emoji per slide, never the same one twice in a deck, and only in that attribute. Never write an emoji inside any text: titles, labels, bullets, cards, quotes and notes are words only.
- Content, data and quote slides carry none.
- When the subject is serious — loss, harm, a crisis, layoffs, illness, a legal or financial disclosure — leave emoji out of the deck entirely.`;
}

/** The output contract's line for accents, so the last checklist the model reads has it. */
function emojiContract(restrained: boolean): string {
  return restrained
    ? `- Unless the subject is serious, the hero SECTION and the closing SECTION each carry emoji="…" from the EMOJI ACCENTS list.`
    : `- Unless the subject is serious, the hero SECTION, each divider SECTION and the closing SECTION carry emoji="…" from the EMOJI ACCENTS list.`;
}

function densityGuidance(density: TextDensity): string {
  switch (density) {
    case "minimal":
      // It said "use short labels", and the model did exactly that: bullets
      // of one word each, the explanation left in the notes, slides a heading
      // and a line. Minimal shortens each point; it does not empty a slide.
      return "Text density is minimal: fewer and shorter points, each a short phrase with a few words of support — never a bare label. A minimal slide is brief, not empty.";
    case "detailed":
      return "Text density is detailed: add a specific support detail.";
    case "extensive":
      return "Text density is extensive: add context and implication while keeping each point presentation-friendly.";
    case "concise":
      return "Text density is concise: use one direct sentence per point.";
  }
}

export function buildDeckPrompt(input: DeckPromptInput): {
  system: string;
  user: string;
} {
  const totalSlides = input.outline.length;
  const density = input.textDensity ?? "concise";
  const budget = slideWordBudget(input.wordBudget, density);
  const imageStyle =
    input.imageStyle === "stock" ? STOCK_IMAGE_STYLE : GENERATED_IMAGE_STYLE;

  const styleRules = [
    input.tone ? `Match the requested tone: ${input.tone}.` : "",
    input.audience ? `Write for this audience: ${input.audience}.` : "",
    `${densityGuidance(density)} Keep every slide at or under ${budget} words.`,
  ]
    .filter(Boolean)
    .map((rule) => `- ${rule}`)
    .join("\n");

  const templateBlock = input.templateGuidance
    ? `\n# TEMPLATE GUIDANCE\n\nThis deck follows a fixed template. Honor its direction and per-slide component hints (they override the variety rule when they conflict):\n\n${input.templateGuidance}\n`
    : "";

  const citationBlock =
    input.sourceCount && input.sourceCount > 0
      ? `\n# CITATIONS\n\nThe reference material below is numbered 1-${input.sourceCount}. When a slide asserts a figure that came from reference k, add source="k" to the element that carries it — CHART, TABLE, STATS, or the P that states the claim.
Never write a URL. Never invent a reference number outside 1-${input.sourceCount}. At most two citations per slide.\n`
      : "";

  const system = `You are a presentation XML expert. Generate a complete presentation from the user's request, outline, and supporting context. Your output goes directly into a strict XML parser, so produce only valid presentation XML. Do not wrap the output in markdown code fences and do not add commentary before or after the XML.

Your task is to create exactly ${totalSlides} slides. Use the outline for coverage and sequence, then write stronger slide copy when the outline wording is too raw. Match the requested language, tone, audience, and text density.

# XML SYNTAX GUIDANCE

Available XML syntax: wrap the deck in one <PRESENTATION> root. Put each slide in <SECTION layout="left|right|vertical">. Put one main component in each SECTION, except simple text slides may use only headings, paragraphs, title, label, quote, callout, code, or contributor blocks. Put a direct child root <IMG ... /> last when the slide needs a root image.

${LAYOUT_REFERENCE}

${COMPONENT_INSTRUCTIONS}

# THE RENDERER OWNS THE DESIGN

${RENDERER_OWNS_DESIGN}

# WRITING RULES

${WRITING_RULES}

# DECK RHYTHM

${deckRhythm(budget)}

# FORMAT GUIDANCE

${FORMAT_GUIDANCE}
${templateBlock}${citationBlock}
# VISUAL GUIDANCE

${VISUAL_GUIDANCE}

# EMOJI ACCENTS

${emojiGuidance(restrainedTone(input.tone))}

# Image query guidance:
${imageStyle}

# STYLE GUIDANCE

Style guidance:
${styleRules}

# XML output contract:
Presentation rules:
- Output exactly ${totalSlides} slides.
- Return one <PRESENTATION> root and valid XML only.
- Use supported tags and attributes only.
- Do not generate <BUTTON> elements.
- When you generate root level image, i.e <IMG /> elements, put it at last in each SECTION.
- Make sure you follow all the component level requirements and guidelines.
- Use the outline to cover the intended ideas, but shape the final slide copy like a strong presentation rather than copying the outline literally.
- Include images where they strengthen the slide visually.
- Include one <NOTES>...</NOTES> element per SECTION with 2-3 spoken-voice sentences the presenter would say on that slide.
${emojiContract(restrainedTone(input.tone))}
- Every word inside a SECTION is shown to the audience. Never write "Slide N" in a heading or anywhere on a slide, and never write notes about your own choices or edits.
- Every item holds its own text: never leave a <DIV> empty inside BULLETS, BOXES, COLUMNS or any group, and never write a group's items as an attribute.

Generate the complete XML presentation now.`;

  const rows: Array<[string, string]> = [
    ["Title", input.title ?? "Derive from the request"],
    ["User Request", input.prompt || "No specific prompt provided"],
    ["Date", input.currentDate],
    ["Language", input.language],
    ["Tone", input.tone ?? "professional"],
    ["Total Slides", String(totalSlides)],
    ["Text Density", density],
  ];
  if (input.audience) rows.push(["Target Audience", input.audience]);

  const outlineBlock = input.outline
    .map((item, index) => `Slide ${index + 1}:\n${item.trim()}`)
    .join("\n\n---\n\n");

  const sections = [
    `# Presentation Context\n\n| Field | Value |\n|---|---|\n${rows
      .map(([label, value]) => `| ${label} | ${value} |`)
      .join("\n")}`,
    `## Outline\n\n\`\`\`md\n${outlineBlock}\n\`\`\``,
  ];
  if (input.researchContext) {
    sections.push(input.researchContext);
    sections.push(
      "Use provided research to enrich slide content with accurate facts, statistics, and context.",
    );
  }

  return { system, user: sections.join("\n\n") };
}
