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
}

export function buildOutlinePrompt(input: OutlinePromptInput): {
  system: string;
  user: string;
} {
  const unit = input.kind === "deck" ? "slide" : "section";
  const sections = input.templateSections ?? [];
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
  }${input.audience ? `\n- Target audience: ${input.audience}.` : ""}${templateBlock}${importBlock}`;

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
