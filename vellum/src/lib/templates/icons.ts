import type { IconName } from "@/components/ui/icon";

/**
 * Template id → chrome icon. Kept beside the library rather than inside it so
 * the blueprint stays a pure data module with no UI dependency. Anything not
 * listed falls back to its kind's generic icon.
 */
export const TEMPLATE_ICON: Record<string, IconName> = {
  "pitch-deck": "tplPitch",
  "sales-deck": "tplSales",
  "corporate-deck": "tplBoard",
  "research-deck": "tplResearch",
  "product-launch": "tplLaunch",
  "training-workshop": "tplTraining",
  "marketing-overview": "tplMarketing",
  "consulting-strategy": "tplStrategy",
  "saas-investor-update": "tplInvestor",
  "conference-keynote": "tplKeynote",
  "education-course": "tplCourse",
  "studio-brief": "tplStudio",
  "research-memo": "tplMemo",
  "launch-spotlight": "tplSpotlight",
  "visual-story": "tplVisual",
  "business-proposal": "tplProposal",
  "research-report": "tplReport",
  whitepaper: "tplWhitepaper",
  "case-study": "tplCase",
  "executive-one-pager": "tplOnePager",
};

export function templateIcon(id: string, kind: string): IconName {
  return TEMPLATE_ICON[id] ?? (kind === "doc" ? "doc" : "deck");
}
