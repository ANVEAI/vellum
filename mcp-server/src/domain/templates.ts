/**
 * Static mirror of Vellum's template blueprints.
 *
 * Vellum exposes no `/api/templates` endpoint — the catalogue lives only in
 * `vellum/src/lib/templates/library.ts`. Since `templateId` is validated at
 * create time (unknown ids are rejected with 400), an agent that cannot see the
 * list is reduced to guessing among 20 opaque strings, which is worse than the
 * small duplication here.
 *
 * `tests/unit/templates.test.ts` guards against drift; if Vellum adds a
 * blueprint this table is the one place to update.
 */
export interface TemplateInfo {
  id: string;
  kind: "deck" | "doc";
  /** Vellum's default section count; overridden by genParams.nCards. */
  nCards: number;
  theme: string;
  summary: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: "pitch-deck", kind: "deck", nCards: 8, theme: "indigo", summary: "Investor pitch: problem, solution, market, traction, ask." },
  { id: "sales-deck", kind: "deck", nCards: 7, theme: "crimson", summary: "Customer-facing sales narrative built around a buyer's pain." },
  { id: "corporate-deck", kind: "deck", nCards: 8, theme: "piano", summary: "Neutral corporate update or business review." },
  { id: "research-deck", kind: "deck", nCards: 8, theme: "arctic", summary: "Findings-led research presentation with evidence and method." },
  { id: "product-launch", kind: "deck", nCards: 7, theme: "cosmos", summary: "Launch announcement: what shipped, why it matters, availability." },
  { id: "training-workshop", kind: "deck", nCards: 7, theme: "forest", summary: "Teaching deck with objectives, exercises and recap." },
  { id: "marketing-overview", kind: "deck", nCards: 6, theme: "coral", summary: "Campaign or channel overview for a marketing audience." },
  { id: "consulting-strategy", kind: "deck", nCards: 8, theme: "piano", summary: "Consulting-style strategy deck with action titles." },
  { id: "saas-investor-update", kind: "deck", nCards: 7, theme: "orbit", summary: "Periodic investor update: metrics, wins, asks." },
  { id: "conference-keynote", kind: "deck", nCards: 9, theme: "cosmos", summary: "Visual keynote: full-bleed imagery, very low word count." },
  { id: "education-course", kind: "deck", nCards: 8, theme: "canopy", summary: "Course module with learning outcomes and assessment." },
  { id: "studio-brief", kind: "deck", nCards: 7, theme: "meridian", summary: "Creative studio brief with a strong visual register." },
  { id: "launch-spotlight", kind: "deck", nCards: 7, theme: "prism", summary: "Short, high-energy spotlight on a single launch." },
  { id: "visual-story", kind: "deck", nCards: 6, theme: "nocturne", summary: "Image-led narrative with minimal text." },
  { id: "research-memo", kind: "doc", nCards: 6, theme: "foolscap", summary: "Short written research memo." },
  { id: "business-proposal", kind: "doc", nCards: 7, theme: "ocean", summary: "Written proposal: scope, approach, pricing." },
  { id: "research-report", kind: "doc", nCards: 8, theme: "daktilo", summary: "Long-form research report with sections and citations." },
  { id: "whitepaper", kind: "doc", nCards: 7, theme: "sand", summary: "Authoritative whitepaper for a technical audience." },
  { id: "case-study", kind: "doc", nCards: 6, theme: "mystique", summary: "Customer case study: context, intervention, outcome." },
  { id: "executive-one-pager", kind: "doc", nCards: 4, theme: "ebony", summary: "Single-page executive summary." },
] as const;

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export const IMAGE_STYLES = [
  "auto",
  "editorial-photo",
  "brand-duotone",
  "archive-mono",
  "studio-still",
  "editorial-illustration",
  "technical-line",
  "soft-3d",
  "abstract-field",
  "editorial-dim",
] as const;

export const IMAGE_MODELS = ["flux-schnell", "qwen-image", "hidream"] as const;
export const TEXT_DENSITIES = ["minimal", "concise", "detailed", "extensive"] as const;
