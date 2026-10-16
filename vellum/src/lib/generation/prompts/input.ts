/**
 * The prompt input for a deck or document, from its stored record.
 *
 * Whole-deck generation and "Regenerate slide" used to build this
 * separately, and the copies drifted: the single-slide route passed no word
 * budget, no text density and no audience, and handed a numbered brief the
 * template's own section list. A regenerated slide was written to the
 * default budget — roughly twice what a minimal-density slide holds — and
 * came back longer than every slide around it. One function, so they cannot
 * disagree again.
 */
import type { DeckPromptInput } from "@/lib/generation/prompts/deck";
import { isScriptedRequest } from "@/lib/generation/prompts/scripted";
import { formatTemplateGuidance, getTemplate } from "@/lib/templates/library";

interface GenParams {
  language?: string;
  tone?: string;
  audience?: string;
  textDensity?: "minimal" | "concise" | "detailed" | "extensive";
}

export function promptInputFor(
  document: {
    prompt: string | null;
    title: string;
    templateId: string | null;
    genParams: string | null;
    researchContext: string | null;
    sources: string | null;
  },
  outline: { title: string; cards: string[] },
  wordBudget: number,
): DeckPromptInput {
  let genParams: GenParams = {};
  try {
    genParams = document.genParams ? (JSON.parse(document.genParams) as GenParams) : {};
  } catch {
    genParams = {};
  }
  const template = document.templateId ? getTemplate(document.templateId) : undefined;
  let sourceCount = 0;
  try {
    sourceCount = document.sources ? (JSON.parse(document.sources) as unknown[]).length : 0;
  } catch {
    sourceCount = 0;
  }
  return {
    prompt: document.prompt ?? "",
    title: document.title !== "Untitled" ? document.title : outline.title,
    outline: outline.cards,
    language: genParams.language ?? "English",
    tone: genParams.tone,
    audience: genParams.audience,
    textDensity: genParams.textDensity,
    researchContext: document.researchContext ?? undefined,
    sourceCount,
    currentDate: new Date().toISOString().slice(0, 10),
    // When the request numbers its own slides, the template's per-section
    // list would contradict them, so only its overall direction is passed on.
    templateGuidance: template
      ? isScriptedRequest(document.prompt)
        ? template.globalGuidance
        : formatTemplateGuidance(template)
      : undefined,
    wordBudget,
  };
}
