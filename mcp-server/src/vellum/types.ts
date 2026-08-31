/**
 * Types mirroring Vellum's wire format.
 *
 * Hand-maintained on purpose: this package imports nothing from `vellum/`, which
 * is what lets it be lifted into its own repository. The contract tests are the
 * guard against drift.
 *
 * Every field below was read from Vellum's source, not inferred:
 *   prisma/schema.prisma, src/app/api/**, src/lib/generation/parser/slide-parser.ts
 */

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Six values, not five. `"reviewing"` is written by src/lib/qa/run.ts:94 during
 * the post-generation quality pass but is REJECTED by PATCH
 * (src/app/api/documents/[id]/route.ts:33). Readable, never writable.
 */
export type DocumentStatus =
  | "draft"
  | "outlining"
  | "generating"
  | "ready"
  | "error"
  | "reviewing";

/** The subset PATCH will accept — deliberately excludes "reviewing". */
export type WritableDocumentStatus = Exclude<DocumentStatus, "reviewing">;

export const WRITABLE_STATUSES: readonly WritableDocumentStatus[] = [
  "draft",
  "outlining",
  "generating",
  "ready",
  "error",
];

export type DocumentKind = "deck" | "doc";

/** Exactly the 7 fields `GET /api/documents` selects. It returns a bare array. */
export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  title: string;
  status: DocumentStatus;
  themeName: string;
  createdAt: string | number;
  updatedAt: string | number;
}

/**
 * `GET /api/documents/{id}` returns every column plus the joined theme.
 * Median 30 KB, max 63 KB — `rawXml` alone is 5-20 KB of LLM debug output.
 * Never hand this to a model unprojected.
 */
export interface DocumentDetail extends DocumentSummary {
  prompt: string | null;
  outline: string | null;
  researchContext: string | null;
  /** JSON string containing PlateSlide[]. */
  slides: string;
  customThemeId: string | null;
  customTheme: CustomTheme | null;
  /** JSON string containing GenParams. */
  genParams: string | null;
  templateId: string | null;
  /** JSON string containing QualityReport. */
  qualityReport: string | null;
  /** JSON string containing DeckSource[]. */
  sources: string | null;
  errorMessage: string | null;
  /** Raw LLM XML. Debug only; stripped unless verbosity === "full". */
  rawXml: string | null;
}

export interface CustomTheme {
  id: string;
  name: string;
  /** JSON string of ThemeProperties. */
  data: string;
  createdAt: string | number;
}

/* -------------------------------------------------------------------------- */
/* Generation parameters                                                       */
/* -------------------------------------------------------------------------- */

export type TextDensity = "minimal" | "concise" | "detailed" | "extensive";
export type ImageModel = "flux-schnell" | "qwen-image" | "hidream";
export type ImportMode = "verbatim" | "summarize";
export type ImageStyle =
  | "auto"
  | "editorial-photo"
  | "brand-duotone"
  | "archive-mono"
  | "studio-still"
  | "editorial-illustration"
  | "technical-line"
  | "soft-3d"
  | "abstract-field"
  | "editorial-dim";

export interface GenParams {
  /** 1-30. Authoritative over the template's default (outline/route.ts:42-49). */
  nCards?: number;
  language?: string;
  tone?: string;
  /** Accepted by the API but never sent by Vellum's own UI. */
  audience?: string;
  textDensity?: TextDensity;
  /**
   * Research runs only if researchContext is empty AND this !== false AND the
   * global settings.search.enabled is true (outline/route.ts:60-61).
   */
  webSearch?: boolean;
  imageModel?: ImageModel;
  imageStyle?: ImageStyle;
  importMode?: ImportMode;
}

/* -------------------------------------------------------------------------- */
/* Slides                                                                      */
/* -------------------------------------------------------------------------- */

export type LayoutType = "left" | "right" | "vertical" | "background" | "none";

export interface RootImage {
  query: string;
  url?: string;
  layoutType?: LayoutType;
  imageSource?: "generate" | "search" | "gif" | "upload";
  /**
   * Present in persisted rows and read by src/lib/slides/image-fit.ts:82, but
   * absent from Vellum's own RootImage type. Typed here because it is real.
   */
  focus?: string;
  [key: string]: unknown;
}

/** A leaf. */
export interface PlateText {
  text: string;
  [key: string]: unknown;
}

/** An element. `type` is one of ~50 tags; children may be elements or leaves. */
export interface PlateElement {
  type: string;
  children: PlateNode[];
  id?: string;
  [key: string]: unknown;
}

export type PlateNode = PlateElement | PlateText;

export interface PlateSlide {
  /** Deterministic FNV-1a hash — stable across re-parses. */
  id: string;
  content: PlateNode[];
  rootImage?: RootImage;
  layoutType?: LayoutType;
  intent?: string;
  archetype?: string;
  speakerNote?: string;
  alignment?: "start" | "center" | "end";
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

export type ImageJobStatus = "pending" | "running" | "done" | "failed";

export interface GeneratedImageRow {
  id: string;
  slideId: string | null;
  nodeId: string | null;
  status: ImageJobStatus;
  path: string | null;
  error: string | null;
  prompt: string;
}

export interface AssetsResponse {
  images: GeneratedImageRow[];
  /** Count of status ∈ {pending, running}. Reaching 0 is one third of "done". */
  pending: number;
}

/* -------------------------------------------------------------------------- */
/* Quality                                                                     */
/* -------------------------------------------------------------------------- */

export interface QaIssue {
  slideId: string | null;
  severity: "minor" | "major";
  code: string;
  issue: string;
  suggestion: string;
}

export interface QualityReport {
  /** 1-10, or null when the LLM critique failed (lint still ran). */
  score: number | null;
  lint: QaIssue[];
  critique: QaIssue[];
  strengths: string[];
  checkedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export interface HealthResponse {
  /** NOTE: `ok` is db && ollama only — it ignores searxng and comfyui. */
  ok: boolean;
  services: { db: boolean; ollama: boolean; searxng: boolean; comfyui: boolean };
  settings: { model: string; imageProvider: string };
}

export interface IconHit {
  name: string;
  url: string;
  score: number;
}

export interface ImportResult {
  text: string;
  kind: string;
  title: string;
  chars: number;
  words: number;
}

export type ExportFormat = "pdf" | "pptx" | "docx";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/* -------------------------------------------------------------------------- */
/* SSE events                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `status` carries free-text prose written for humans ("Refining 3 weak
 * slides"). It is NOT an enum — never pattern-match it. The only machine
 * readable progress signals are `progress` and the assets `pending` count.
 */
export type VellumSseEvent =
  | { type: "status"; data: { status: string } }
  | { type: "chunk"; data: { chunk: string } }
  | { type: "progress"; data: { sections: number; total: number } }
  | { type: "complete"; data: OutlineComplete | ContentComplete }
  | { type: "error"; data: { detail: string } }
  | { type: string; data: unknown };

export interface OutlineComplete {
  documentId: string;
  title: string;
  cardCount: number;
}

export interface ContentComplete {
  documentId: string;
  slideCount: number;
  /** Images ENQUEUED, not finished. Poll /assets for completion. */
  imageCount: number;
}
