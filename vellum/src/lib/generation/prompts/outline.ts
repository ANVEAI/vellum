/**
 * Outline-stage prompt. Streams plain markdown (never structured output —
 * this sidesteps local models' empty-array failure mode entirely).
 *
 * Output contract:
 *   # <Title>
 *   ## <Card 1 heading>
 *   - bullet
 *   - bullet
 *   ## <Card 2 heading>
 *   ...
 */

export interface OutlinePromptInput {
  prompt: string;
  kind: "deck" | "doc";
  nCards: number;
  language: string;
  tone?: string;
  audience?: string;
  researchContext?: string;
  currentDate: string;
  /** Template blueprint sections — when set, they fix count, order, and intent. */
  templateSections?: Array<{ heading: string; guidance: string }>;
  /** Template-wide direction applied across the whole outline. */
  templateGuidance?: string;
  /** When content was imported: mirror its structure or restructure freely. */
  importMode?: "verbatim" | "summarize";
  /**
   * How many slides the request enumerates itself ("Slide 1: …"). When it is
   * set, the request's own list is the outline and the template's sections
   * are ignored — see scripted.ts.
   */
  scriptedSlides?: number;
}

export function buildOutlinePrompt(input: OutlinePromptInput): {
  system: string;
  user: string;
} {
  const unit = input.kind === "deck" ? "slide" : "section";
  const scripted = (input.scriptedSlides ?? 0) > 0;
  // A request that lists its own slides has its arc already; a blueprint
  // forced on top of it drops slides and invents others.
  const sections = scripted ? [] : (input.templateSections ?? []);
  const fromTemplate = sections.length > 0;
  // The requested count is ALWAYS authoritative. A template's section list is
  // its default and its narrative arc — not a cap. This used to read
  // `sections.length`, so picking 10 slides on a template whose blueprint has
  // 8 silently produced 8.
  const nCards = input.nCards;
  const delta = nCards - sections.length;

  // How the blueprint bends to reach the requested count.
  const countRule =
    delta === 0
      ? `- Produce exactly the ${nCards} blueprint ${unit} entries below, as "## " headings IN THIS ORDER — no extra entries, none skipped.`
      : delta > 0
        ? `- The user asked for ${nCards} ${unit}s but the blueprint lists ${sections.length}. Produce exactly ${nCards} entries: keep every blueprint ${unit} in order, then add ${delta} more by SPLITTING the richest blueprint ${unit}s into their natural parts (e.g. a combined market/competition ${unit} becomes one for each) or by adding directly supporting ${unit}s next to the ${unit} they support. Never repeat a ${unit}, and never append filler at the end.`
        : `- The user asked for ${nCards} ${unit}s but the blueprint lists ${sections.length}. Produce exactly ${nCards} entries: keep the blueprint's order and cover its intent, MERGING the most closely related adjacent ${unit}s. The opening and the closing ${unit} must both survive.`;

  const templateBlock = fromTemplate
    ? `\n\nTemplate contract (this outline follows a blueprint):
${countRule}
- Adapt each heading's wording to the specific topic while keeping its intent (e.g. "The Problem" may become the topic's actual problem).
- Write each entry's bullets following that ${unit}'s guidance.${
        input.templateGuidance
          ? `\n- Overall direction: ${input.templateGuidance}`
          : ""
      }

Blueprint (${sections.length} ${unit}s; the target is ${nCards}):
${sections.map((s, i) => `${i + 1}. ${s.heading} — ${s.guidance}`).join("\n")}`
    : "";

  const scriptBlock = scripted
    ? `\n\nScripted-request contract: the request lists its own ${input.scriptedSlides} ${unit}s ("Slide 1", "Slide 2", …). That list IS the outline. Produce one "## " entry per listed ${unit}, in the request's order, using each ${unit}'s own title, with bullets taken from what the request says that ${unit} contains. Do not add, skip, merge, rename or reorder ${unit}s.${
        input.scriptedSlides !== nCards
          ? ` The user asked for ${nCards} entries and the request lists ${input.scriptedSlides}: ${
              nCards < (input.scriptedSlides ?? 0)
                ? "merge the most closely related adjacent ones, keeping the first and the last"
                : "split the richest ones into their natural parts, next to the slide they come from"
            }.`
          : ""
      }${input.templateGuidance ? `\n- Overall direction: ${input.templateGuidance}` : ""}`
    : "";

  const importBlock =
    input.importMode && input.researchContext
      ? input.importMode === "verbatim"
        ? `\n\nImported-source contract: the user supplied a source document (below) and chose to KEEP ITS STRUCTURE. Derive the outline directly from the source's own sections and order — mirror its structure 1:1 as far as ${nCards} entries allow, reuse its headings (lightly cleaned), and take every bullet from its actual content. Do not invent sections the source does not contain.`
        : `\n\nImported-source contract: the user supplied a source document (below) to SUMMARIZE AND RESTRUCTURE. Treat it as the authoritative content, but design the strongest possible ${nCards}-${unit} narrative from it — merge, reorder, and condense freely while staying faithful to its facts.`
      : "";

  const system = `You are an expert ${
    input.kind === "deck" ? "presentation" : "document"
  } planner. Produce a markdown outline and nothing else — no preamble, no commentary, no code fences.

Format contract:
- First line: "# " followed by a strong title in ${input.language}.
- Then exactly ${nCards} ${unit} entries. Each entry is a "## " heading line followed by 2-4 "- " bullet lines summarizing what that ${unit} covers.
- Bullets are terse planning notes (not final copy).
- Cover the topic with a clear narrative arc: opening, development, conclusion.
- Write everything in ${input.language}.${
    input.tone ? `\n- Match this tone: ${input.tone}.` : ""
  }${input.audience ? `\n- Target audience: ${input.audience}.` : ""}${templateBlock}${scriptBlock}${importBlock}`;

  const parts = [
    `Today's date: ${input.currentDate}`,
    `Request: ${input.prompt}`,
  ];
  if (input.researchContext) parts.push(input.researchContext);

  return { system, user: parts.join("\n\n") };
}

/** Count "## " card headings in streamed outline markdown. */
export function countOutlineCards(markdown: string): number {
  return (markdown.match(/^##\s+/gm) ?? []).length;
}

/**
 * What to put between an outline and a continuation of it, so the first new
 * "## " heading starts a line of its own.
 *
 * Top-ups were appended straight onto the outline, and the model rarely ends
 * its output with a newline, so the first new heading landed at the end of
 * the last bullet — "…a clean, professional end state## The New Skill
 * Stack". Neither the counter nor the parser sees a heading there: that
 * section's text merged into the card before it, every top-up came up one
 * card short, and a 21-slide keynote shipped 20 slides twice in three runs.
 */
export function sectionBreak(markdown: string): string {
  if (markdown.length === 0 || markdown.endsWith("\n\n")) return "";
  return markdown.endsWith("\n") ? "\n" : "\n\n";
}

/**
 * An outline card whose heading is the sign-off: "Thank You & Resources",
 * "The Closing Thank You and Resources", "Q&A", "Questions?". Planning
 * headings describe the slide rather than title it, so "thank you" may sit
 * anywhere in one; "questions" only counts at the start, since "Five
 * questions every CTO should ask" is content.
 */
const SIGN_OFF_CARD = /\bthank\s+you\b|\bq\s*&\s*a\b|^(any\s+)?questions\b/i;

/**
 * The cards with every sign-off card moved to the end, the rest in order.
 *
 * Topping up a short outline asks the model to continue it, and it does —
 * after the closing card: one keynote's 21-card outline put "The Closing
 * Thank You and Resources" 16th, with four sections appended behind it. The
 * deck model then wrote the thank-you last as the 21st slide, the 20-card
 * contract trimmed it, and the deck lost its sign-off.
 */
export function endOutlineOnSignOff(cards: string[]): string[] {
  const signOffs = cards.filter((card, index) => index > 0 && isSignOffCard(card));
  if (signOffs.length === 0) return cards;
  const rest = cards.filter((card) => !signOffs.includes(card));
  const reordered = [...rest, ...signOffs];
  return reordered.every((card, index) => card === cards[index]) ? cards : reordered;
}

function isSignOffCard(card: string): boolean {
  return SIGN_OFF_CARD.test((card.split("\n")[0] ?? "").replace(/^##\s+/, "").trim());
}

/**
 * The first `count` cards, except that trailing sign-off cards are kept and
 * the surplus is taken from just before them: the outline is trimmed to the
 * requested count, and cutting its tail used to cut its ending.
 */
export function trimOutlineCards(cards: string[], count: number): string[] {
  if (cards.length <= count) return cards;
  let tail = 0;
  while (tail < count - 1 && isSignOffCard(cards[cards.length - 1 - tail])) tail += 1;
  return [...cards.slice(0, count - tail), ...cards.slice(cards.length - tail)];
}

/** Split outline markdown into title + per-card markdown blocks. */
export function parseOutlineMarkdown(markdown: string): {
  title: string;
  cards: string[];
} {
  const lines = markdown.split(/\r?\n/);
  let title = "";
  const cards: string[] = [];
  let current: string[] | null = null;

  for (const rawLine of lines) {
    // Local models sometimes double the heading marker ("## ## Title");
    // collapse repeated marker runs before structural parsing.
    const line = rawLine.replace(/^(#{1,6})\s+(?:#{1,6}\s+)+/, "$1 ");
    if (/^#\s+/.test(line) && !title) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (current) cards.push(current.join("\n").trim());
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) cards.push(current.join("\n").trim());

  return { title, cards: cards.filter((c) => c.length > 0) };
}
