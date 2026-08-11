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

export type TextDensity = "minimal" | "concise" | "detailed" | "extensive";

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
}

const GENERATED_IMAGE_STYLE = `Image instruction:
- Use \`<IMG query="...">\` with a detailed descriptive prompt to generate an image.
- Keep slide text/content in the requested presentation language.
- Write image prompts in English unless the user explicitly requested another language for generated visuals.

Create prompts that:
- Describe the visual scene, composition, and mood
- Include style references (photorealistic, illustration, cinematic, etc.)
- Mention lighting, colors, and atmosphere
- Compose with clear negative space (sky, wall, calm gradient area) on one side so slide text can sit beside or over the image
- Are relevant to the slide topic
- Do NOT include on-image text unless explicitly required by the slide content
- Do NOT use placeholders, brackets, or vague references
- Do NOT mention AI tools, models, or generation technology

\`\`\`xml
<IMG query="cinematic wide-angle view of a futuristic smart city powered by renewable energy, gleaming solar arrays and vertical gardens, morning haze, warm sunlight cutting through glass towers, clean aerial composition with leading lines, crisp details, high contrast, optimistic mood" />
\`\`\``;

const STOCK_IMAGE_STYLE = `Image instruction:
- Use \`<IMG query="..." />\` with a short English keyword query to find a stock image.
- Use 2-5 words: concrete nouns and noun phrases only (people, place, object, industry, activity).
- Do NOT write sentences, camera directions, lighting, mood, or art style.

\`\`\`xml
<IMG query="team collaboration" />
<IMG query="solar panels roof" />
\`\`\``;

const WRITING_RULES = `WRITING RULES — these override style preferences:
1. Every content slide's H1/H2 is a complete sentence stating the slide's conclusion — subject + verb + object, 6-15 words.
   WRITE: "Enterprise churn fell to 2.1% after the SSO launch"
   NOT: "Churn Analysis" / "Q3 Overview" / "Key Findings"
2. When a slide has a CHART, TABLE, or STATS, the heading states what the data proves, not what the data is.
3. Every content slide contains at least one specific number with unit and period. "Revenue grew" is not a claim; "Revenue grew 31% YoY" is.
4. Items in one group share a grammatical shape — all verb-first or all noun-phrase, never mixed — and stay within 2x each other's length.
5. Bullets ≤ 14 words. Groups ≤ 5 items.
6. Vague quantifiers (significant, substantial, dramatic, many, several, numerous, various) are banned unless a number follows in the same sentence.
7. Banned outright: leverage (as a verb), synergy, holistic, seamless, robust, world-class, best-in-class, cutting-edge, state-of-the-art, paradigm shift, game-changer, unlock value, empower, revolutionize, disrupt.
8. No hedging: might, may, could, perhaps, possibly, potentially, arguably, somewhat, relatively, generally, tends to, appears to. State it or cut it.
9. Never open a bullet with "There is/are", "It is", "This is", "We believe", "In order to".
10. Never restate the heading in the first bullet.
11. So-what test: if a reader could only answer "so what?" by reading the body, rewrite the heading.
12. NOTES carry the argument and caveats in spoken voice; the slide carries the claim and evidence. Never duplicate sentences between them.`;

const DECK_RHYTHM = `Design the deck's RHYTHM like a professional designer — vary composition, don't repeat one pattern:
- Slide 1 is the hero: role="hero", a short powerful title, ideally layout="background" with a strong full-bleed image, under 30 words total.
- When the deck has 3+ distinct parts, open each part with a section divider: role="divider", layout="background" or no image, just a heading (and one short line), under 20 words.
- Give the single most important number its own moment: role="statement" with one STATS item or one bold claim, under 20 words.
- Use role="quote" for a slide that is only a QUOTE. Use role="kpi" when a slide is 3-5 headline STATS.
- End with role="closing": the call to action or takeaway, mirroring the hero's brevity.
- Word budgets: hero/divider/statement/closing ≤ 30 words; standard content slides ≤ 60; never exceed 90.
- Write ACTION TITLES: each content slide's heading is a full-sentence claim stating the takeaway (e.g. "Churn fell 34% after onboarding redesign"), not a topic label (not "Churn").
- Alternate image sides across consecutive image slides (layout="left" then "right"). After two dense data slides, give the audience a breath: an image-led or statement slide.`;

const FORMAT_GUIDANCE = `Use the available formats intentionally according to each slide's content and purpose:
- Pick list-style components for grouped points.
- Pick sequence components for processes or maturity paths.
- Pick comparison components for trade-offs or before/after states.
- Pick relationship components for connected concepts.
- Pick data components for evidence.
- Use columns as a special mixed-content container when a slide needs balanced lanes, item images, charts, or nested supported content.

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

function densityGuidance(density: TextDensity): string {
  switch (density) {
    case "minimal":
      return "Text density is minimal: use short labels.";
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
  const imageStyle =
    input.imageStyle === "stock" ? STOCK_IMAGE_STYLE : GENERATED_IMAGE_STYLE;

  const styleRules = [
    input.tone ? `Match the requested tone: ${input.tone}.` : "",
    input.audience ? `Write for this audience: ${input.audience}.` : "",
    densityGuidance(density),
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

# WRITING RULES

${WRITING_RULES}

# DECK RHYTHM

${DECK_RHYTHM}

# FORMAT GUIDANCE

${FORMAT_GUIDANCE}
${templateBlock}${citationBlock}
# VISUAL GUIDANCE

${VISUAL_GUIDANCE}

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
