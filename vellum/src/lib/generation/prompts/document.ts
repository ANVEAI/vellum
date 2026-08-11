/**
 * Whole-document generation prompt (one streaming LLM call, <DOCUMENT>
 * envelope, flowing chapters instead of slides).
 */
import { DOCUMENT_REFERENCE } from "@/lib/generation/parser/xml-catalog";
import type { TextDensity } from "@/lib/generation/prompts/deck";

export interface DocumentPromptInput {
  prompt: string;
  title?: string;
  outline: string[]; // one entry per section/chapter (markdown)
  language: string;
  tone?: string;
  audience?: string;
  textDensity?: TextDensity;
  researchContext?: string;
  currentDate: string;
  templateGuidance?: string; // formatted template blueprint guidance
}

export function buildDocumentPrompt(input: DocumentPromptInput): {
  system: string;
  user: string;
} {
  const totalSections = input.outline.length;

  const styleRules = [
    input.tone ? `Match the requested tone: ${input.tone}.` : "",
    input.audience ? `Write for this audience: ${input.audience}.` : "",
    "Write real, information-dense prose. Every paragraph must advance the reader's understanding — no filler, no restating the heading.",
  ]
    .filter(Boolean)
    .map((rule) => `- ${rule}`)
    .join("\n");

  const templateBlock = input.templateGuidance
    ? `\n# TEMPLATE GUIDANCE\n\nThis document follows a fixed template. Honor its direction and per-section component hints:\n\n${input.templateGuidance}\n`
    : "";

  const system = `You are a professional writer producing a structured written document (a report, guide, or briefing — NOT a slide deck). Your output goes directly into a strict XML parser, so produce only valid XML. Do not wrap the output in markdown code fences and do not add commentary before or after the XML.

Your task is to write exactly ${totalSections} SECTIONs. Each SECTION is a flowing chapter targeting 250-400 words of prose, structured with subheadings where useful.

# XML SYNTAX GUIDANCE

${DOCUMENT_REFERENCE}
${templateBlock}
# Image query guidance:
- Use \`<IMG query="...">\` with a detailed descriptive English prompt to generate an inline figure (at most one per SECTION, and only when it genuinely illustrates the chapter).
- Describe scene, composition, style, lighting, and mood. No on-image text. No AI-tool mentions.

# STYLE GUIDANCE

${styleRules}

# XML output contract:
Document rules:
- Output exactly ${totalSections} SECTIONs inside one <DOCUMENT> root, valid XML only.
- Every piece of content MUST live inside a <SECTION>...</SECTION> element. Never place <TITLE>, headings, or paragraphs directly under <DOCUMENT>.
- First SECTION starts with <TITLE> and a lead paragraph; every later SECTION starts with one <H1> chapter heading.
- Use supported tags only. No <BUTTON>, no <CONTRIBUTOR />.
- Prefer prose; use lists, tables, charts, and figures sparingly and only where they genuinely aid the chapter.
- Use the outline for coverage and sequence, improving the wording where it is raw.

Generate the complete XML document now.`;

  const rows: Array<[string, string]> = [
    ["Title", input.title ?? "Derive from the request"],
    ["User Request", input.prompt || "No specific prompt provided"],
    ["Date", input.currentDate],
    ["Language", input.language],
    ["Tone", input.tone ?? "professional"],
    ["Total Sections", String(totalSections)],
  ];
  if (input.audience) rows.push(["Target Audience", input.audience]);

  const outlineBlock = input.outline
    .map((item, index) => `Section ${index + 1}:\n${item.trim()}`)
    .join("\n\n---\n\n");

  const sections = [
    `# Document Context\n\n| Field | Value |\n|---|---|\n${rows
      .map(([label, value]) => `| ${label} | ${value} |`)
      .join("\n")}`,
    `## Outline\n\n\`\`\`md\n${outlineBlock}\n\`\`\``,
  ];
  if (input.researchContext) {
    sections.push(input.researchContext);
    sections.push(
      "Use provided research to enrich the document with accurate facts, statistics, and context.",
    );
  }

  return { system, user: sections.join("\n\n") };
}
