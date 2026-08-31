/**
 * Projections that keep tool results inside a sane token budget.
 *
 * The numbers this defends against, measured on the live library:
 *   - full document row: median 30 KB, max 63 KB (dominated by `rawXml`)
 *   - `slides` JSON alone: median 14 KB (~4k tokens), max 33 KB (~10k tokens)
 *
 * So there is no "get the whole document" projection. `summary` is the default
 * and answers almost every question an agent actually has; `rawXml` is isolated
 * behind its own view and appears nowhere else, which is what keeps the rest cheap.
 */
import type {
  AssetsResponse,
  DocumentDetail,
  DocumentSummary,
  PlateNode,
  PlateSlide,
  QaIssue,
  QualityReport,
} from "../vellum/types.js";

export type DocumentView =
  | "summary"
  | "outline"
  | "slides"
  | "quality"
  | "assets"
  | "raw_xml";

/** `## ` headings in the persisted outline — the slide-count contract. */
export function countOutlineCards(outline: string | null | undefined): number {
  if (!outline) return 0;
  return (outline.match(/^##\s+/gm) ?? []).length;
}

export function parseSlides(slidesJson: string | null | undefined): PlateSlide[] {
  if (!slidesJson) return [];
  try {
    const parsed = JSON.parse(slidesJson);
    return Array.isArray(parsed) ? (parsed as PlateSlide[]) : [];
  } catch {
    return [];
  }
}

export function parseQuality(json: string | null | undefined): QualityReport | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as QualityReport;
  } catch {
    return null;
  }
}

/**
 * Whether a generation was cut short.
 *
 * MUST be a strict `<`. When a deck cites sources, Vellum appends a Sources
 * appendix slide (content/route.ts:341-360), so a perfectly healthy deck
 * legitimately reports `slideCount === cardCount + 1`. Using `!==` here would
 * false-positive on every researched deck.
 */
export function isTruncated(slideCount: number, cardCount: number): boolean {
  return cardCount > 0 && slideCount < cardCount;
}

/**
 * Whether the post-generation quality pass has genuinely finished.
 *
 * `qualityReport != null` is NOT sufficient: qa/run.ts writes a PARTIAL report
 * with `score: null` at the same moment it flips status to "reviewing". The
 * report only counts as complete once a score is present.
 */
export function isQualityComplete(report: QualityReport | null): boolean {
  return report !== null && report.score !== null;
}

/** Flatten a Plate node tree to plain text. */
export function extractText(nodes: readonly PlateNode[] | undefined): string {
  if (!nodes) return "";
  const parts: string[] = [];
  const walk = (node: PlateNode): void => {
    if (typeof (node as { text?: unknown }).text === "string") {
      parts.push((node as { text: string }).text);
      return;
    }
    const children = (node as { children?: PlateNode[] }).children;
    if (Array.isArray(children)) children.forEach(walk);
  };
  nodes.forEach(walk);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** First heading-ish line of a slide, for identification. */
export function slideHeading(slide: PlateSlide): string {
  const HEADINGS = new Set([
    "presentation-title",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "label",
  ]);
  for (const node of slide.content ?? []) {
    const type = (node as { type?: string }).type;
    if (type && HEADINGS.has(type)) {
      const text = extractText([node]);
      if (text) return text;
    }
  }
  return extractText(slide.content).slice(0, 80);
}

export interface SlideDigest {
  index: number;
  id: string;
  heading: string;
  archetype?: string;
  wordCount: number;
  hasImage: boolean;
  imageResolved?: boolean;
  text: string;
  speakerNote?: string;
  textTruncated?: boolean;
}

export interface DigestOptions {
  /** 0 means unbounded. Default 400 — Vellum's own critique uses a 320-char digest. */
  maxCharsPerSlide?: number;
  /** 1-based subset. */
  slideNumbers?: number[];
  includeSpeakerNotes?: boolean;
}

export function digestSlides(
  slides: readonly PlateSlide[],
  opts: DigestOptions = {},
): SlideDigest[] {
  const max = opts.maxCharsPerSlide ?? 400;
  const wanted = opts.slideNumbers?.length ? new Set(opts.slideNumbers) : null;

  const out: SlideDigest[] = [];
  slides.forEach((slide, i) => {
    const index = i + 1;
    if (wanted && !wanted.has(index)) return;

    const full = extractText(slide.content);
    const text = max > 0 && full.length > max ? `${full.slice(0, max)}…` : full;
    const digest: SlideDigest = {
      index,
      id: slide.id,
      heading: slideHeading(slide),
      wordCount: full ? full.split(/\s+/).length : 0,
      hasImage: Boolean(slide.rootImage),
      text,
    };
    if (slide.archetype) digest.archetype = slide.archetype;
    if (slide.rootImage) digest.imageResolved = Boolean(slide.rootImage.url);
    if (max > 0 && full.length > max) digest.textTruncated = true;
    if (opts.includeSpeakerNotes && slide.speakerNote) digest.speakerNote = slide.speakerNote;
    out.push(digest);
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Document summary — the default view, ~250 tokens                            */
/* -------------------------------------------------------------------------- */

export interface DocumentSummaryView {
  documentId: string;
  kind: string;
  title: string;
  status: string;
  themeName: string;
  templateId: string | null;
  cardCount: number;
  slideCount: number;
  /** True when slideCount < cardCount — the generation was cut short. */
  truncated: boolean;
  exportReady: boolean;
  quality: { score: number | null; majorIssues: number; minorIssues: number } | null;
  errorMessage: string | null;
  createdAt: string | number;
  updatedAt: string | number;
}

export function summarize(doc: DocumentDetail, assets?: AssetsResponse): DocumentSummaryView & {
  images?: { total: number; done: number; pending: number; failed: number };
} {
  const slides = parseSlides(doc.slides);
  const cardCount = countOutlineCards(doc.outline);
  const report = parseQuality(doc.qualityReport);

  const view: DocumentSummaryView & {
    images?: { total: number; done: number; pending: number; failed: number };
  } = {
    documentId: doc.id,
    kind: doc.kind,
    title: doc.title,
    status: doc.status,
    themeName: doc.themeName,
    templateId: doc.templateId,
    cardCount,
    slideCount: slides.length,
    truncated: isTruncated(slides.length, cardCount),
    exportReady: slides.length > 0,
    quality: report
      ? {
          score: report.score,
          majorIssues: countBySeverity(report, "major"),
          minorIssues: countBySeverity(report, "minor"),
        }
      : null,
    errorMessage: doc.errorMessage,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (assets) view.images = summarizeAssets(assets);
  return view;
}

function countBySeverity(report: QualityReport, severity: QaIssue["severity"]): number {
  const all = [...(report.lint ?? []), ...(report.critique ?? [])];
  return all.filter((i) => i.severity === severity).length;
}

export function summarizeAssets(assets: AssetsResponse): {
  total: number;
  done: number;
  pending: number;
  failed: number;
} {
  const images = assets.images ?? [];
  return {
    total: images.length,
    done: images.filter((i) => i.status === "done").length,
    pending: assets.pending,
    failed: images.filter((i) => i.status === "failed").length,
  };
}

/** Only the failures — never the full array with every prompt. */
export function assetFailures(assets: AssetsResponse) {
  return (assets.images ?? [])
    .filter((i) => i.status === "failed")
    .map((i) => ({
      slideId: i.slideId,
      nodeId: i.nodeId,
      error: i.error,
      prompt: i.prompt.slice(0, 160),
    }));
}

/** Quality view: majors by default, since those are what `revise_slide` can act on. */
export function projectQuality(
  report: QualityReport | null,
  slides: readonly PlateSlide[],
  includeMinor = false,
) {
  if (!report) return null;
  const byId = new Map(slides.map((s, i) => [s.id, i + 1]));
  const issues = [...(report.lint ?? []), ...(report.critique ?? [])]
    .filter((i) => includeMinor || i.severity === "major")
    .map((i) => ({
      slideNumber: i.slideId ? (byId.get(i.slideId) ?? null) : null,
      slideId: i.slideId,
      severity: i.severity,
      code: i.code,
      issue: i.issue,
      suggestion: i.suggestion,
    }));
  return {
    score: report.score,
    complete: isQualityComplete(report),
    strengths: report.strengths ?? [],
    checkedAt: report.checkedAt,
    issues,
    minorIssuesOmitted: includeMinor ? 0 : countBySeverity(report, "minor"),
  };
}

/** List projection — Vellum already selects 7 columns, so this is near-free. */
export function projectList(docs: readonly DocumentSummary[]) {
  return docs.map((d) => ({
    documentId: d.id,
    kind: d.kind,
    title: d.title,
    status: d.status,
    themeName: d.themeName,
    updatedAt: d.updatedAt,
  }));
}
