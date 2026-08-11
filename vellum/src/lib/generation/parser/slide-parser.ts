/**
 * Streaming XML → PlateSlide[] parser.
 *
 * Ported from allweonedev/presentation-ai (MIT License)
 * src/components/notebook/presentation/utils/parser.ts — see
 * THIRD_PARTY_LICENSES.md for the full license text.
 *
 * Vellum adaptations:
 * - Plate types/constants come from the local structural shim
 *   (src/lib/slides/plate-shim.ts) so the parser runs headless.
 * - Document mode: `new SlideParser({ mode: "document" })` accepts a
 *   <DOCUMENT> envelope (normalized to <PRESENTATION> before parsing) and
 *   stamps formatCategory="document" on emitted slides.
 *
 * parseChunk() expects CUMULATIVE stream content (the full accumulated text
 * so far on every call), not deltas — deterministic FNV-1a section IDs make
 * repeated re-parses cheap and flicker-free.
 */
import {
  ColumnItemPlugin,
  ColumnPlugin,
  KEYS,
  type Descendant,
  type TColumnElement,
  type TColumnGroupElement,
  type TElement,
  type TTableCellElement,
  type TTableElement,
  type TTableRowElement,
  type TText,
  type PresentationStockImageProvider,
  ANTV_INFOGRAPHIC,
  AREA_CHART_ELEMENT,
  BAR_CHART_ELEMENT,
  BOX_PLOT_CHART_ELEMENT,
  BUBBLE_CHART_ELEMENT,
  CANDLESTICK_CHART_ELEMENT,
  CHORD_CHART_ELEMENT,
  CIRCULAR_GRID_GROUP,
  CIRCULAR_GRID_ITEM,
  COMPOSED_CHART_ELEMENT,
  CONE_FUNNEL_CHART_ELEMENT,
  CONNECTED_CIRCLES_GROUP,
  CONNECTED_CIRCLES_ITEM,
  CONTRIBUTOR_ELEMENT,
  DONUT_CHART_ELEMENT,
  FUNNEL_CHART_ELEMENT,
  HEATMAP_CHART_ELEMENT,
  HISTOGRAM_CHART_ELEMENT,
  LABEL_ELEMENT,
  LINE_CHART_ELEMENT,
  LINEAR_GAUGE_ELEMENT,
  NIGHTINGALE_CHART_ELEMENT,
  OHLC_CHART_ELEMENT,
  PIE_CHART_ELEMENT,
  PRESENTATION_TITLE_ELEMENT,
  PYRAMID_CHART_ELEMENT,
  QUOTE_ELEMENT,
  RADAR_CHART_ELEMENT,
  RADIAL_BAR_CHART_ELEMENT,
  RADIAL_COLUMN_CHART_ELEMENT,
  RADIAL_GAUGE_ELEMENT,
  RANGE_AREA_CHART_ELEMENT,
  RANGE_BAR_CHART_ELEMENT,
  SANKEY_CHART_ELEMENT,
  SCATTER_CHART_ELEMENT,
  SLOPE_GROUP,
  SLOPE_ITEM,
  SNAKE_GROUP,
  SNAKE_ITEM,
  SUNBURST_CHART_ELEMENT,
  TREEMAP_CHART_ELEMENT,
  WATERFALL_CHART_ELEMENT,
  // P4-W4 native infographics
  FLOW_DIAGRAM_ELEMENT,
  FUNNEL_FLOW_GROUP,
  FUNNEL_FLOW_ITEM,
  HARVEY_TABLE_ELEMENT,
  ICEBERG_ELEMENT,
  ICEBERG_SIDE,
  JOURNEY_GROUP,
  JOURNEY_ITEM,
  KPI_ROW_GROUP,
  KPI_ROW_ITEM,
  MATRIX_GROUP,
  MATRIX_ITEM,
  ORG_CHART_GROUP,
  ORG_CHART_NODE,
  PICTOGRAM_ELEMENT,
  PROGRESS_RINGS_GROUP,
  PROGRESS_RING_ITEM,
  VENN_GROUP,
  VENN_ITEM,
  type TContributorElement,
  type TLabelElement,
  type TPresentationTitleElement,
  type TAntvInfographicElement,
  type TArrowListElement,
  type TArrowListItemElement,
  type TBeforeAfterGroupElement,
  type TBeforeAfterSideElement,
  type TBoxGroupElement,
  type TBoxItemElement,
  type TBulletGroupElement,
  type TBulletItemElement,
  type TButtonElement,
  type TCompareGroupElement,
  type TCompareSideElement,
  type TCycleGroupElement,
  type TCycleItemElement,
  type TCircularGridGroupElement,
  type TCircularGridItemElement,
  type TConnectedCirclesGroupElement,
  type TConnectedCirclesItemElement,
  type TSlopeGroupElement,
  type TSlopeItemElement,
  type TSnakeGroupElement,
  type TSnakeItemElement,
  type TIconListElement,
  type TIconListItemElement,
  type TIconElement,
  type TConsItemElement,
  type TProsConsGroupElement,
  type TProsItemElement,
  type TPyramidGroupElement,
  type TPyramidItemElement,
  type TQuoteElement,
  type TSequenceArrowGroupElement,
  type TSequenceArrowItemElement,
  type TStairGroupElement,
  type TStairItemElement,
  type TStatsGroupElement,
  type TStatsItemElement,
  type TStepsGroupElement,
  type TStepsItemElement,
  type TTimelineGroupElement,
  type TTimelineItemElement,
  type GeneratingText,
  type HeadingElement,
  type ImageCropSettings,
  type ImageElement,
  type ParagraphElement,
  type TChartElement,
} from "@/lib/slides/plate-shim";

export type PlateNode =
  | TElement
  | ParagraphElement
  | HeadingElement
  | ImageElement
  | TColumnElement
  | TColumnGroupElement
  | TBulletGroupElement
  | TBulletItemElement
  | TIconListItemElement
  | TIconListElement
  | TIconElement
  | TCycleGroupElement
  | TCycleItemElement
  | TSlopeGroupElement
  | TSlopeItemElement
  | TConnectedCirclesGroupElement
  | TConnectedCirclesItemElement
  | TCircularGridGroupElement
  | TCircularGridItemElement
  | TSnakeGroupElement
  | TSnakeItemElement
  | TStairItemElement
  | TStairGroupElement
  | TPyramidGroupElement
  | TPyramidItemElement
  | TStepsGroupElement
  | TStepsItemElement
  | TArrowListElement
  | TArrowListItemElement
  | TTimelineGroupElement
  | TTimelineItemElement
  | TChartElement
  | TBoxGroupElement
  | TBoxItemElement
  | TCompareGroupElement
  | TCompareSideElement
  | TBeforeAfterGroupElement
  | TBeforeAfterSideElement
  | TProsConsGroupElement
  | TProsItemElement
  | TConsItemElement
  | TSequenceArrowGroupElement
  | TSequenceArrowItemElement
  | TButtonElement
  | TContributorElement
  | TLabelElement
  | TPresentationTitleElement
  | TTableElement
  | TTableRowElement
  | TTableCellElement
  | TQuoteElement
  | TAntvInfographicElement;

export type LayoutType = "left" | "right" | "vertical" | "background" | "none";
export type RootImage = {
  query: string;
  url?: string;
  embedType?: string;
  imageSource?: "generate" | "search" | "gif" | "upload";
  stockImageProvider?: PresentationStockImageProvider;
  cropSettings?: ImageCropSettings;
  layoutType?: LayoutType;
  size?: { w?: string; h?: number };
  isQueryStreaming?: boolean;
  // Chart support
  chartType?: string;
  chartData?: unknown;
  chartOptions?: Record<string, unknown>;
  paletteDropMutable?: boolean;
};

export type PlateSlide = {
  id: string;
  content: PlateNode[];
  rootImage?: RootImage;
  layoutType?: LayoutType | undefined;
  /** Advisory role="" from the LLM (raw); the planner has final say. */
  intent?: string;
  /** Planner-stamped archetype (persisted). Absent → legacy rendering. */
  archetype?: string;
  /** Per-slide speaker notes (<NOTES> tag). */
  speakerNote?: string;
  alignment?: "start" | "center" | "end";
  bgColor?: string;
  width?: "S" | "M" | "L";
  fontSize?: "S" | "M" | "L";
  fontFamily?: {
    heading: string;
    body: string;
    headingUrl?: string;
    bodyUrl?: string;
    headingWeight?: number;
    bodyWeight?: number;
  };
  formatCategory?: "presentation" | "social" | "document" | "webpage";
  aspectRatio?: {
    type: "fluid" | "ratio" | "tall" | "preset";
    value?: string;
  };
  isImageSlide?: boolean;
};

// Updated XMLNode to support mixed content (text and elements interleaved)
interface XMLNode {
  tag: string;
  attributes: Record<string, string>;
  children: Array<XMLNode | XMLTextNode>;
  originalTagContent?: string;
}

interface XMLTextNode {
  text: string;
}

function isTextNode(node: XMLNode | XMLTextNode): node is XMLTextNode {
  return "text" in node && !("tag" in node);
}

function isElementNode(node: XMLNode | XMLTextNode): node is XMLNode {
  return "tag" in node;
}

function hashStableText(input: string): string {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

const DETERMINISTIC_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function createDeterministicRandomId(seed: string, length = 21): string {
  let state = 0x811c9dc5;

  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }

  let id = "";
  for (let index = 0; index < length; index += 1) {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    const randomValue = ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    id +=
      DETERMINISTIC_ID_ALPHABET[
        Math.floor(randomValue * DETERMINISTIC_ID_ALPHABET.length)
      ];
  }

  return id;
}

function unescapeXmlText(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

const CHART_XML_TYPE_TO_ELEMENT: Record<string, string> = {
  pie: PIE_CHART_ELEMENT,
  bar: BAR_CHART_ELEMENT,
  area: AREA_CHART_ELEMENT,
  radar: RADAR_CHART_ELEMENT,
  scatter: SCATTER_CHART_ELEMENT,
  line: LINE_CHART_ELEMENT,
  "radial-bar": RADIAL_BAR_CHART_ELEMENT,
  composed: COMPOSED_CHART_ELEMENT,
  treemap: TREEMAP_CHART_ELEMENT,
  bubble: BUBBLE_CHART_ELEMENT,
  donut: DONUT_CHART_ELEMENT,
  histogram: HISTOGRAM_CHART_ELEMENT,
  heatmap: HEATMAP_CHART_ELEMENT,
  "range-bar": RANGE_BAR_CHART_ELEMENT,
  "range-area": RANGE_AREA_CHART_ELEMENT,
  waterfall: WATERFALL_CHART_ELEMENT,
  "box-plot": BOX_PLOT_CHART_ELEMENT,
  boxplot: BOX_PLOT_CHART_ELEMENT,
  candlestick: CANDLESTICK_CHART_ELEMENT,
  ohlc: OHLC_CHART_ELEMENT,
  nightingale: NIGHTINGALE_CHART_ELEMENT,
  "radial-column": RADIAL_COLUMN_CHART_ELEMENT,
  sunburst: SUNBURST_CHART_ELEMENT,
  sankey: SANKEY_CHART_ELEMENT,
  chord: CHORD_CHART_ELEMENT,
  funnel: FUNNEL_CHART_ELEMENT,
  "cone-funnel": CONE_FUNNEL_CHART_ELEMENT,
  pyramid: PYRAMID_CHART_ELEMENT,
  "radial-gauge": RADIAL_GAUGE_ELEMENT,
  "linear-gauge": LINEAR_GAUGE_ELEMENT,
  // Phase-4 comparison charts (rendered by lib/charts/build-option.ts).
  slope: "chart-slope",
  lollipop: "chart-lollipop",
  dumbbell: "chart-dumbbell",
};

function getChartElementType(chartType: string): string {
  const normalizedChartType = chartType.trim().toLowerCase();
  return (
    CHART_XML_TYPE_TO_ELEMENT[normalizedChartType] ??
    (normalizedChartType.startsWith("chart-")
      ? normalizedChartType
      : BAR_CHART_ELEMENT)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isElementRecord(value: unknown): value is TElement {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    Array.isArray(value.children)
  );
}

function parseJsonPayload(text: string): unknown | undefined {
  const trimmedText = unescapeXmlText(text).trim();
  if (!trimmedText) return undefined;

  try {
    return JSON.parse(trimmedText) as unknown;
  } catch {
    return undefined;
  }
}

function parsePrimitiveXmlValue(value: string): string | number {
  const trimmedValue = value.trim();
  const numericText = trimmedValue.endsWith("%")
    ? trimmedValue.slice(0, -1)
    : trimmedValue;
  const numericValue = Number(numericText);

  return numericText !== "" && Number.isFinite(numericValue)
    ? numericValue
    : trimmedValue;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmedLine = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let currentCell = "";
  let isEscaped = false;

  for (const character of trimmedLine) {
    if (isEscaped) {
      currentCell += character;
      isEscaped = false;
      continue;
    }

    if (character === "\\") {
      isEscaped = true;
      continue;
    }

    if (character === "|") {
      cells.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  cells.push(currentCell.trim());

  return cells;
}

function isMarkdownSeparatorRow(line: string): boolean {
  const cells = splitMarkdownTableRow(line);

  return (
    cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function parseMarkdownTableRows(
  text: string,
): Array<Record<string, string | number>> {
  const lines = unescapeXmlText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const separatorIndex = lines.findIndex(isMarkdownSeparatorRow);

  if (separatorIndex <= 0) {
    return [];
  }

  const headerLine = lines[separatorIndex - 1];
  if (!headerLine) {
    return [];
  }

  const headers = splitMarkdownTableRow(headerLine).filter(Boolean);
  if (headers.length === 0) {
    return [];
  }

  return lines.slice(separatorIndex + 1).flatMap((line) => {
    if (!line.includes("|") || line.startsWith("<")) {
      return [];
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length === 0) {
      return [];
    }

    const row: Record<string, string | number> = {};
    headers.forEach((header, index) => {
      const cell = cells[index];
      if (cell !== undefined && cell !== "") {
        row[header] = parsePrimitiveXmlValue(cell);
      }
    });

    return Object.keys(row).length > 0 ? [row] : [];
  });
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function parseOrientationAttribute(
  value: string | undefined,
): "vertical" | "horizontal" | undefined {
  if (value === "vertical" || value === "horizontal") return value;
  return undefined;
}

function parseSidednessAttribute(
  value: string | undefined,
): "single" | "double" | undefined {
  if (value === "single" || value === "double") return value;
  return undefined;
}

function parseAlignmentAttribute(
  value: string | undefined,
): "left" | "center" | "right" | undefined {
  if (value === "left" || value === "center" || value === "right") {
    return value;
  }

  return undefined;
}

function parsePresentationTitleVariant(
  value: string | undefined,
): TPresentationTitleElement["variant"] {
  if (value === "display" || value === "humongous" || value === "title") {
    return value;
  }

  return "title";
}

function isAntvInfographicSyntax(text: string): boolean {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return false;
  }

  return /^infographic\s+\S+/i.test(lines[0] ?? "") && lines[1] === "theme";
}

function extractLegacyInfographicFencePrompts(text: string): string[] {
  const prompts: string[] = [];
  const fencePattern = /```[ \t]*infographic[^\n]*(?:\n)?([\s\S]*?)(```|$)/gi;
  let match = fencePattern.exec(text);

  while (match !== null) {
    const prompt = unescapeXmlText(match[1] ?? "").trim();

    if (!prompt || match[2] !== "```") {
      match = fencePattern.exec(text);
      continue;
    }

    prompts.push(prompt);

    match = fencePattern.exec(text);
  }

  return prompts;
}

/**
 * Class to parse XML presentation data into Plate.js format with improved streaming support
 */
export class SlideParser {
  private buffer = "";
  private completedSections: string[] = [];
  private parsedSlides: PlateSlide[] = [];
  private lastInputLength = 0;
  private sectionIdMap = new Map<string, string>();
  private latestContent = "";
  private sectionCounter = 0;
  private readonly mode: "deck" | "document";

  constructor(options: { mode?: "deck" | "document" } = {}) {
    this.mode = options.mode ?? "deck";
  }

  /**
   * Document streams use a <DOCUMENT> envelope; the parsing internals only
   * know <PRESENTATION>, so normalize before anything touches the buffer.
   * Tag-name replacement is length-changing but consistent across calls, so
   * the cumulative-content detection in parseChunk still works.
   */
  private normalizeEnvelope(text: string): string {
    if (this.mode !== "document") return text;
    return text
      .replace(/<DOCUMENT(?=[\s>])/g, "<PRESENTATION")
      .replace(/<\/DOCUMENT>/g, "</PRESENTATION>");
  }

  private stampMode(slides: PlateSlide[]): PlateSlide[] {
    if (this.mode !== "document") return slides;
    for (const slide of slides) {
      slide.formatCategory = "document";
    }
    return slides;
  }

  /**
   * Parse a chunk of XML data
   */
  public parseChunk(chunk: string): PlateSlide[] {
    chunk = this.normalizeEnvelope(chunk);
    this.latestContent = chunk;

    const isFullContent =
      chunk.length >= this.lastInputLength &&
      chunk.substring(0, this.lastInputLength) ===
        this.buffer.substring(0, this.lastInputLength);

    if (isFullContent && this.lastInputLength > 0) {
      this.buffer = this.buffer + chunk.substring(this.lastInputLength);
    } else {
      this.buffer = chunk;
    }

    this.lastInputLength = chunk.length;
    this.extractCompleteSections();
    const newSlides = this.processSections();

    return this.stampMode(newSlides);
  }

  /**
   * Finalize parsing with any remaining content
   */
  /**
   * Drop a trailing "<TAG" fragment that never got its ">".
   *
   * Mid-stream the buffer routinely ends inside a tag. Force-closing such a
   * buffer with "</SECTION>" welds the two together — "<CALLO" + "</SECTION>"
   * parses as a tag literally named `CALLO</SECTION`, which logs
   * "Unknown top-level tag" and, if the model's output really was cut short,
   * leaves a junk node in the tree. The half-typed element simply isn't ready
   * yet, so drop it; the next tick re-parses the whole buffer and picks it up
   * complete.
   */
  private static trimIncompleteTrailingTag(text: string): string {
    const lastOpen = text.lastIndexOf("<");
    if (lastOpen === -1) return text;
    // A ">" after the last "<" means that tag is closed — nothing to trim.
    if (text.indexOf(">", lastOpen) !== -1) return text;
    return text.slice(0, lastOpen);
  }

  public finalize(): PlateSlide[] {
    try {
      this.extractCompleteSections();

      let remainingBuffer = this.buffer.trim();

      if (remainingBuffer.startsWith("<PRESENTATION")) {
        const tagEndIdx = remainingBuffer.indexOf(">");
        if (tagEndIdx !== -1) {
          remainingBuffer = remainingBuffer.substring(tagEndIdx + 1).trim();
        }
      }

      if (remainingBuffer.startsWith("<SECTION")) {
        const fixedSection =
          SlideParser.trimIncompleteTrailingTag(remainingBuffer) + "</SECTION>";
        this.completedSections.push(fixedSection);
      }

      const finalSlides = this.processSections();
      this.latestContent = "";

      return this.stampMode(finalSlides);
    } catch (e) {
      console.error("Error during finalization:", e);
      return [];
    }
  }

  /**
   * Get all parsed slides
   */
  public getAllSlides(): PlateSlide[] {
    return this.parsedSlides;
  }

  /**
   * Reset the parser state
   */
  public reset(): void {
    this.buffer = "";
    this.completedSections = [];
    this.parsedSlides = [];
    this.lastInputLength = 0;
    this.latestContent = "";
    this.sectionCounter = 0;
  }

  /**
   * Manually clear all generating marks from all slides
   */
  public clearAllGeneratingMarks(): void {
    for (const slide of this.parsedSlides) {
      this.clearGeneratingMarksFromNodes(slide.content as Descendant[]);
    }
    this.latestContent = "";
  }

  /**
   * Clear all generating marks from a tree of nodes
   */
  private clearGeneratingMarksFromNodes(nodes: Descendant[]): void {
    for (const node of nodes) {
      if ("text" in node && (node as GeneratingText).generating !== undefined) {
        (node as GeneratingText).generating = undefined;
      }

      if (
        "children" in node &&
        Array.isArray(node.children) &&
        node.children.length > 0
      ) {
        this.clearGeneratingMarksFromNodes(node.children as Descendant[]);
      }
    }
  }

  /**
   * Process the completed sections into Plate slides
   */
  private processSections(): PlateSlide[] {
    if (this.completedSections.length === 0) {
      return [];
    }

    const newSlides = this.completedSections.map(this.convertSectionToPlate);
    this.parsedSlides = [...this.parsedSlides, ...newSlides];
    this.completedSections = [];

    return newSlides;
  }

  /**
   * Extract SECTION blocks from the buffer
   */
  private extractCompleteSections(): void {
    let startIdx = 0;
    let extractedSectionEndIdx = 0;

    const presentationStartIdx = this.buffer.indexOf("<PRESENTATION");
    if (presentationStartIdx !== -1 && presentationStartIdx < 10) {
      const tagEndIdx = this.buffer.indexOf(">", presentationStartIdx);
      if (tagEndIdx !== -1) {
        startIdx = tagEndIdx + 1;

        const commentStartIdx = this.buffer.indexOf("<!--", startIdx);
        if (commentStartIdx !== -1 && commentStartIdx < startIdx + 20) {
          const commentEndIdx = this.buffer.indexOf("-->", commentStartIdx);
          if (commentEndIdx !== -1) {
            startIdx = commentEndIdx + 3;
          }
        }
      }
    }

    while (true) {
      const sectionStartIdx = this.buffer.indexOf("<SECTION", startIdx);
      if (sectionStartIdx === -1) break;

      const sectionEndIdx = this.buffer.indexOf("</SECTION>", sectionStartIdx);
      const nextSectionIdx = this.buffer.indexOf(
        "<SECTION",
        sectionStartIdx + 1,
      );

      if (
        sectionEndIdx !== -1 &&
        (nextSectionIdx === -1 || sectionEndIdx < nextSectionIdx)
      ) {
        const completeSection = this.buffer.substring(
          sectionStartIdx,
          sectionEndIdx + "</SECTION>".length,
        );

        this.completedSections.push(completeSection);
        startIdx = sectionEndIdx + "</SECTION>".length;
        extractedSectionEndIdx = startIdx;
      } else if (nextSectionIdx !== -1) {
        const partialSection = this.buffer.substring(
          sectionStartIdx,
          nextSectionIdx,
        );

        if (
          partialSection.includes("<H1>") ||
          partialSection.includes("<H2>") ||
          partialSection.includes("<H3>") ||
          partialSection.includes("<PYRAMID>") ||
          partialSection.includes("<ARROWS>") ||
          partialSection.includes("<TIMELINE>") ||
          partialSection.includes("<P>") ||
          partialSection.includes("<ICON") ||
          partialSection.includes("<IMG") ||
          partialSection.includes("<INFOGRAPHIC")
        ) {
          this.completedSections.push(
            SlideParser.trimIncompleteTrailingTag(partialSection) + "</SECTION>",
          );
        }

        startIdx = nextSectionIdx;
        extractedSectionEndIdx = nextSectionIdx;
      } else {
        break;
      }
    }

    if (extractedSectionEndIdx > 0) {
      this.buffer = this.buffer.substring(extractedSectionEndIdx);
    }
  }

  /**
   * Generate a section identifier
   */
  private generateSectionIdentifier(sectionNode: XMLNode): string {
    // Position prefix ensures unique fingerprints for slides at different positions,
    // while maintaining stable IDs across re-parses during streaming
    const positionPrefix = `pos-${this.sectionCounter++}-`;

    const h1Node = sectionNode.children.find(
      (child) => isElementNode(child) && child.tag.toUpperCase() === "H1",
    ) as XMLNode | undefined;

    if (h1Node) {
      const headingContent = this.getTextContent(h1Node);
      if (headingContent.trim().length > 0) {
        return `${positionPrefix}heading-${headingContent.trim()}`;
      }
    }

    let fingerprint = "";

    const attrKeys = Object.keys(sectionNode.attributes).sort();
    if (attrKeys.length > 0) {
      fingerprint += attrKeys
        .map((key) => `${key}=${sectionNode.attributes[key]}`)
        .join(";");
    }

    const childTags = sectionNode.children
      .filter(isElementNode)
      .slice(0, 3)
      .map((child) => child.tag.toUpperCase());
    if (childTags.length > 0) {
      fingerprint += "|" + childTags.join("-");
    }

    if (fingerprint.length < 5) {
      let hash = 0;
      const fullContent = sectionNode.originalTagContent ?? "";
      for (let i = 0; i < fullContent.length; i++) {
        const char = fullContent.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      fingerprint = `content-hash-${Math.abs(hash)}`;
    }

    return `${positionPrefix}${fingerprint}`;
  }

  /**
   * Convert an XML section string to Plate.js format
   */
  private convertSectionToPlate = (sectionString: string): PlateSlide => {
    const rootNode = this.parseXML(sectionString);

    const sectionNode = rootNode.children.find(
      (child) => isElementNode(child) && child.tag.toUpperCase() === "SECTION",
    ) as XMLNode | undefined;

    if (!sectionNode) {
      return {
        id: createDeterministicRandomId(`slide:${sectionString || "empty"}`),
        content: [],
        layoutType: undefined,
        alignment: "center",
      };
    }

    let slideId: string;
    if (sectionNode.attributes.id) {
      slideId = sectionNode.attributes.id;
    } else {
      const sectionIdentifier = this.generateSectionIdentifier(sectionNode);

      if (this.sectionIdMap.has(sectionIdentifier)) {
        slideId = this.sectionIdMap.get(sectionIdentifier)!;
      } else {
        slideId = createDeterministicRandomId(`slide:${sectionIdentifier}`);
        this.sectionIdMap.set(sectionIdentifier, slideId);
      }
    }

    let layoutType: LayoutType | undefined;
    const layoutAttr = sectionNode.attributes.layout;

    if (layoutAttr) {
      if (
        layoutAttr === "left" ||
        layoutAttr === "right" ||
        layoutAttr === "vertical" ||
        layoutAttr === "background"
      ) {
        layoutType = layoutAttr as LayoutType;
      } else {
        layoutType = "left";
      }
    }

    // Check for isImageSlide attribute
    const isImageSlideAttr = sectionNode.attributes.isImageSlide;
    const isImageSlide =
      isImageSlideAttr === "true" || isImageSlideAttr === "1";

    // Advisory design role (role="hero|divider|statement|…"); the layout
    // planner validates it against content and has final say.
    const intent = sectionNode.attributes.role?.trim().toLowerCase();

    const plateElements: PlateNode[] = [];
    let rootImage: RootImage | undefined;
    let speakerNote: string | undefined;

    for (const child of sectionNode.children) {
      if (isTextNode(child)) {
        rootImage ??= this.createRootImageFromTagContent(
          child.text,
          layoutType,
        );

        const infographicElements = this.createLegacyInfographicsFromText(
          child.text,
          slideId,
          layoutType,
        );
        plateElements.push(...infographicElements);
        continue;
      }

      if (!isElementNode(child)) continue;

      if (child.tag.toUpperCase() === "IMG") {
        rootImage ??= this.parseRootImageFromNode(child, layoutType);
        if (!rootImage && child.originalTagContent) {
          rootImage = this.createRootImageFromTagContent(
            child.originalTagContent,
            layoutType,
          );
        }
        continue;
      }

      // Speaker notes: captured onto the slide, never rendered as content.
      if (child.tag.toUpperCase() === "NOTES") {
        const text = child.children
          .map((noteChild) => (isTextNode(noteChild) ? noteChild.text : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) speakerNote = speakerNote ? `${speakerNote} ${text}` : text;
        continue;
      }

      if (child.tag.toUpperCase() === "DIV") {
        for (const divChild of child.children) {
          if (!isElementNode(divChild)) continue;
          const processedElement = this.processTopLevelNode(
            divChild,
            slideId,
            layoutType,
          );
          if (processedElement) {
            plateElements.push(processedElement);
          }
        }
      } else {
        const processedElement = this.processTopLevelNode(
          child,
          slideId,
          layoutType,
        );
        if (processedElement) {
          plateElements.push(processedElement);
        }
      }
    }

    return {
      id: slideId,
      content: this.withStableElementIds(plateElements, slideId),
      ...(rootImage ? { rootImage } : {}),
      ...(layoutType ? { layoutType: layoutType } : {}),
      ...(isImageSlide ? { isImageSlide: true } : {}),
      ...(intent ? { intent } : {}),
      ...(speakerNote ? { speakerNote } : {}),
      alignment: "center",
    };
  };

  private createStableElementId(
    slideId: string,
    path: readonly number[],
    type: string,
  ): string {
    return createDeterministicRandomId(
      `element:${slideId}:${path.join(".")}:${type}`,
    );
  }

  private withStableElementIds<TNode extends PlateNode>(
    nodes: TNode[],
    slideId: string,
  ): TNode[] {
    const addIds = (node: Descendant, path: number[]): Descendant => {
      if (!isElementRecord(node)) {
        return node;
      }

      const nextChildren = node.children.map((child, childIndex) =>
        addIds(child, [...path, childIndex]),
      );
      const existingId =
        isRecord(node) && typeof node.id === "string" ? node.id.trim() : "";

      return {
        ...node,
        id: existingId || this.createStableElementId(slideId, path, node.type),
        children: nextChildren,
      } as Descendant;
    };

    return nodes.map((node, index) => addIds(node, [index]) as TNode);
  }

  private extractAttributeFromTagContent(
    tagContent: string,
    attributeName: string,
  ): { value: string; isComplete: boolean } | null {
    const attributeStart = tagContent.indexOf(`${attributeName}=`);
    if (attributeStart === -1) {
      return null;
    }

    const afterAttribute = tagContent.substring(
      attributeStart + attributeName.length + 1,
    );
    if (afterAttribute.length === 0) {
      return null;
    }

    const quoteChar = afterAttribute[0];
    if (quoteChar !== '"' && quoteChar !== "'") {
      const nextSpaceIndex = afterAttribute.search(/\s/);
      const value =
        nextSpaceIndex === -1
          ? afterAttribute
          : afterAttribute.substring(0, nextSpaceIndex);
      return {
        value,
        isComplete: nextSpaceIndex !== -1 || tagContent.includes(">"),
      };
    }

    const closingQuoteIdx = afterAttribute.indexOf(quoteChar, 1);
    if (closingQuoteIdx !== -1) {
      return {
        value: afterAttribute.substring(1, closingQuoteIdx),
        isComplete: true,
      };
    }

    const rawValue = afterAttribute.substring(1);
    const nextTagIndex = rawValue.indexOf("<");
    return {
      value:
        nextTagIndex === -1 ? rawValue : rawValue.substring(0, nextTagIndex),
      isComplete: false,
    };
  }

  private createRootImageFromTagContent(
    tagContent: string,
    layoutType: LayoutType | undefined,
  ): RootImage | undefined {
    if (!tagContent.includes("<IMG")) {
      return undefined;
    }

    const urlAttribute =
      this.extractAttributeFromTagContent(tagContent, "url") ??
      this.extractAttributeFromTagContent(tagContent, "src");
    const completeUrl =
      urlAttribute?.isComplete && urlAttribute.value.trim().length > 0
        ? urlAttribute.value
        : "";

    const queryAttribute = this.extractAttributeFromTagContent(
      tagContent,
      "query",
    );
    const query = queryAttribute?.value.trim() ?? "";
    const imageSourceAttribute = this.extractAttributeFromTagContent(
      tagContent,
      "imageSource",
    );
    const stockImageProviderAttribute = this.extractAttributeFromTagContent(
      tagContent,
      "stockImageProvider",
    );

    if (query.length > 0) {
      return {
        query: queryAttribute?.value ?? "",
        layoutType,
        ...(completeUrl ? { url: completeUrl } : {}),
        ...(completeUrl ? { imageSource: "search" as const } : {}),
        ...(imageSourceAttribute?.isComplete
          ? {
              imageSource:
                imageSourceAttribute.value as RootImage["imageSource"],
            }
          : {}),
        ...(stockImageProviderAttribute?.isComplete
          ? {
              stockImageProvider:
                stockImageProviderAttribute.value as PresentationStockImageProvider,
            }
          : {}),
        ...(queryAttribute?.isComplete ? {} : { isQueryStreaming: true }),
      };
    }

    if (completeUrl) {
      return {
        query: "",
        layoutType,
        url: completeUrl,
        imageSource: "search",
      };
    }

    return undefined;
  }

  private getFirstChildByTag(
    node: XMLNode,
    tagName: string,
  ): XMLNode | undefined {
    const normalizedTagName = tagName.toUpperCase();
    return node.children.find(
      (child) =>
        isElementNode(child) && child.tag.toUpperCase() === normalizedTagName,
    ) as XMLNode | undefined;
  }

  private parseJsonChild(node: XMLNode, tagName: string): unknown | undefined {
    const child = this.getFirstChildByTag(node, tagName);
    if (!child) return undefined;

    return parseJsonPayload(this.getTextContent(child));
  }

  private parseChartDataRows(node: XMLNode): unknown[] {
    return parseMarkdownTableRows(this.getDirectTextContent(node));
  }

  private getOptionsFromAttributes(
    node: XMLNode,
    excludedKeys: readonly string[],
  ): Record<string, unknown> {
    const excludedKeySet = new Set(excludedKeys);
    const options: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node.attributes)) {
      if (!excludedKeySet.has(key)) {
        options[key] = value;
      }
    }

    return options;
  }

  private parseRootImageFromNode(
    node: XMLNode,
    layoutType: LayoutType | undefined,
  ): RootImage | undefined {
    const query = node.attributes.query ?? "";
    const url = node.attributes.url ?? node.attributes.src ?? "";
    const chartType = node.attributes.charttype
      ? getChartElementType(node.attributes.charttype)
      : undefined;
    const chartData = this.parseChartDataRows(node);
    const chartOptions = this.parseJsonChild(node, "OPTIONS");
    const cropSettings = this.parseJsonChild(node, "CROP");
    const width = node.attributes.width;
    const height = node.attributes.height
      ? Number.parseFloat(node.attributes.height)
      : undefined;
    const imageLayoutType =
      (node.attributes.layoutType as LayoutType | undefined) ?? layoutType;

    if (!query && !url && !chartType) {
      return undefined;
    }

    return {
      query,
      ...(imageLayoutType ? { layoutType: imageLayoutType } : {}),
      ...(url ? { url, imageSource: "search" as const } : {}),
      ...(node.attributes.embedType
        ? { embedType: node.attributes.embedType }
        : {}),
      ...(node.attributes.imageSource
        ? {
            imageSource: node.attributes
              .imageSource as RootImage["imageSource"],
          }
        : {}),
      ...(node.attributes.stockImageProvider
        ? {
            stockImageProvider: node.attributes
              .stockImageProvider as PresentationStockImageProvider,
          }
        : {}),
      ...(width || height !== undefined
        ? {
            size: {
              ...(width ? { w: width } : {}),
              ...(height !== undefined ? { h: height } : {}),
            },
          }
        : {}),
      ...(isRecord(cropSettings)
        ? { cropSettings: cropSettings as unknown as RootImage["cropSettings"] }
        : {}),
      ...(chartType ? { chartType } : {}),
      ...(chartType ? { chartData } : {}),
      ...(isRecord(chartOptions)
        ? { chartOptions }
        : chartType
          ? {
              chartOptions: this.getOptionsFromAttributes(node, [
                "query",
                "url",
                "src",
                "layoutType",
                "width",
                "height",
                "charttype",
              ]),
            }
          : {}),
      ...(node.attributes.paletteDropMutable !== undefined
        ? {
            paletteDropMutable:
              parseBooleanAttribute(node.attributes.paletteDropMutable) ??
              false,
          }
        : {}),
    };
  }

  private createInfographicFromPrompt(
    prompt: string,
    idSeed: string,
    layoutType?: LayoutType,
  ): TAntvInfographicElement | null {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      return null;
    }

    const isGeneratedSyntax = isAntvInfographicSyntax(trimmedPrompt);
    const stableKey = hashStableText(`${idSeed}:${trimmedPrompt}`);

    return {
      type: ANTV_INFOGRAPHIC,
      id: `infographic-${stableKey}`,
      generationPrompt: trimmedPrompt,
      ...(layoutType ? { slideLayoutType: layoutType } : {}),
      isLoading: !isGeneratedSyntax,
      syntax: isGeneratedSyntax ? trimmedPrompt : "",
      children: [{ text: "" } as TText],
    };
  }

  private createInfographic(
    node: XMLNode,
    slideId: string,
    layoutType?: LayoutType,
  ): PlateNode | null {
    const prompt =
      node.attributes.prompt ??
      node.attributes.query ??
      this.getTextContent(this.getFirstChildByTag(node, "PROMPT") ?? node);
    const syntax = this.getFirstChildByTag(node, "SYNTAX");
    const source = this.getFirstChildByTag(node, "SOURCE");
    const data = this.parseJsonChild(node, "DATA");
    const syntaxText = syntax ? this.getTextContent(syntax).trim() : "";
    const promptText = unescapeXmlText(prompt).trim();
    const content = syntaxText || promptText;
    const stableKey = hashStableText(
      `${slideId}:${node.originalTagContent ?? ""}:${content}`,
    );

    if (!content) {
      return null;
    }

    const parsedIsLoading = parseBooleanAttribute(node.attributes.isLoading);
    const isGeneratedSyntax = syntaxText
      ? isAntvInfographicSyntax(syntaxText)
      : isAntvInfographicSyntax(promptText);
    const width = node.attributes.width
      ? Number.parseFloat(node.attributes.width)
      : undefined;

    return {
      type: ANTV_INFOGRAPHIC,
      id: node.attributes.id ?? `infographic-${stableKey}`,
      generationPrompt: promptText || content,
      ...(source ? { sourceText: this.getTextContent(source).trim() } : {}),
      ...(node.attributes.slideLayoutType
        ? { slideLayoutType: node.attributes.slideLayoutType as LayoutType }
        : layoutType
          ? { slideLayoutType: layoutType }
          : {}),
      ...(width !== undefined && !Number.isNaN(width)
        ? { width }
        : node.attributes.width
          ? { width: node.attributes.width }
          : {}),
      ...(node.attributes.align === "left" ||
      node.attributes.align === "center" ||
      node.attributes.align === "right"
        ? { align: node.attributes.align }
        : {}),
      ...(isRecord(data)
        ? { data: data as TAntvInfographicElement["data"] }
        : {}),
      isLoading: parsedIsLoading ?? !isGeneratedSyntax,
      syntax: syntaxText || (isGeneratedSyntax ? promptText : ""),
      children: [{ text: "" } as TText],
    } as TAntvInfographicElement;
  }

  private createLegacyInfographicsFromText(
    text: string,
    slideId: string,
    layoutType?: LayoutType,
  ): TAntvInfographicElement[] {
    return extractLegacyInfographicFencePrompts(text).flatMap(
      (prompt, index) => {
        const infographic = this.createInfographicFromPrompt(
          prompt,
          `${slideId}:legacy:${index}`,
          layoutType,
        );

        return infographic ? [infographic] : [];
      },
    );
  }

  /**
   * Process a top-level node in the SECTION
   */
  private processTopLevelNode(
    node: XMLNode,
    slideId: string,
    layoutType?: LayoutType,
  ): PlateNode | null {
    const tag = node.tag.toUpperCase();

    switch (tag) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return this.createHeading(
          tag.toLowerCase() as "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
          node,
        );
      case "TITLE":
      case "PRESENTATION-TITLE":
      case "PRESENTATION_TITLE":
        return this.createPresentationTitle(node);
      case "LABEL":
        return this.createLabel(node);
      case "CONTRIBUTOR":
        return this.createContributor(node);
      case "BLOCKQUOTE":
        return this.createBlockquote(node);
      case "CALLOUT":
        return this.createCallout(node);
      case "CODE":
      case "CODE-BLOCK":
      case "CODE_BLOCK":
        return this.createCodeBlock(node);
      case "P":
        return this.createParagraph(node);
      case "IMG":
        return this.createImage(node);
      case "INFOGRAPHIC":
        return this.createInfographic(node, slideId, layoutType);
      case "COLUMNS":
        return this.createColumns(node);
      case "BULLETS":
        return this.createBulletGroup(node);
      case "ICONS":
        return this.createIconList(node);
      case "CYCLE":
        return this.createCycle(node);
      case "STAIRCASE":
        return this.createStaircase(node);
      case "CHART":
        return this.createChart(node);
      case "ARROWS":
        return this.createArrowList(node);
      case "BOXES":
        return this.createBoxes(node);
      case "STEPS":
        return this.createSteps(node);
      case "COMPARE":
        return this.createCompare(node);
      case "BEFORE-AFTER":
      case "BEFOREAFTER":
        return this.createBeforeAfter(node);
      case "PROS-CONS":
      case "PROSCONS":
        return this.createProsCons(node);
      case "ARROW-SEQUENCE":
      case "ARROW_SEQUENCE":
      case "ARROW-VERTICAL":
      case "ARROW_VERTICAL":
      case "VERTICAL-ARROWS":
      case "VERTICAL_ARROWS":
        return this.createArrowVertical(node);
      case "TABLE":
        return this.createPlainTable(node);
      case "BUTTON":
        return this.createButton(node);
      case "PYRAMID":
        return this.createPyramid(node);
      case "TIMELINE":
        return this.createTimeline(node);
      case "STATS":
        return this.createStats(node);
      case "QUOTE":
        return this.createQuote(node);
      case "SLOPE":
        return this.createSlope(node);
      case "CONNECTED-CIRCLES":
      case "CONNECTED_CIRCLES":
        return this.createConnectedCircles(node);
      case "CIRCULAR-GRID":
      case "CIRCULAR_GRID":
        return this.createCircularGrid(node);
      case "SNAKE":
        return this.createSnake(node);
      case "FUNNEL-FLOW":
      case "FUNNEL_FLOW":
        return this.createFunnelFlow(node);
      case "KPI-ROW":
      case "KPI_ROW":
        return this.createKpiRow(node);
      case "PROGRESS-RINGS":
      case "PROGRESS_RINGS":
        return this.createProgressRings(node);
      case "PICTOGRAM":
        return this.createPictogram(node);
      case "HARVEY-TABLE":
      case "HARVEY_TABLE":
        return this.createHarveyTable(node);
      case "MATRIX":
        return this.createMatrix(node);
      case "ORG-CHART":
      case "ORG_CHART":
        return this.createOrgChart(node);
      case "JOURNEY":
        return this.createJourney(node);
      case "VENN":
        return this.createVenn(node);
      case "ICEBERG":
        return this.createIceberg(node);
      case "FLOW":
        return this.createFlow(node);
      default:
        console.warn(`Unknown top-level tag: ${tag}`);
        return null;
    }
  }

  /**
   * Parse XML string into a structured tree with mixed content
   */
  private parseXML(xmlString: string): XMLNode {
    const rootNode: XMLNode = {
      tag: "ROOT",
      attributes: {},
      children: [],
    };

    let processedXml = xmlString;

    const presentationOpenStart = processedXml.indexOf("<PRESENTATION");
    if (presentationOpenStart !== -1) {
      const presentationOpenEnd = processedXml.indexOf(
        ">",
        presentationOpenStart,
      );
      if (presentationOpenEnd !== -1) {
        processedXml =
          processedXml.substring(0, presentationOpenStart) +
          processedXml.substring(presentationOpenEnd + 1);
      }
    }

    processedXml = processedXml.replace("</PRESENTATION>", "");

    try {
      let fixedXml = processedXml;

      if (fixedXml.includes("<SECTION") && !fixedXml.endsWith("</SECTION>")) {
        fixedXml = SlideParser.trimIncompleteTrailingTag(fixedXml) + "</SECTION>";
      }

      this.parseElement(fixedXml, rootNode);
    } catch (error) {
      console.error("Error parsing XML:", error);

      // Fall back to a very basic parser that just captures top level tags
      // First remove the PRESENTATION tags if present
      let withoutPresentation = xmlString;

      // Handle opening tag with possible attributes
      const presentationOpenStart =
        withoutPresentation.indexOf("<PRESENTATION");
      if (presentationOpenStart !== -1) {
        const presentationOpenEnd = withoutPresentation.indexOf(
          ">",
          presentationOpenStart,
        );
        if (presentationOpenEnd !== -1) {
          // Remove the entire opening tag including attributes
          withoutPresentation =
            withoutPresentation.substring(0, presentationOpenStart) +
            withoutPresentation.substring(presentationOpenEnd + 1);
        }
      }

      // Handle closing tag
      withoutPresentation = withoutPresentation.replace("</PRESENTATION>", "");

      const sections = withoutPresentation.split(/<\/?SECTION[^>]*>/);
      let inSection = false;

      for (const section of sections) {
        if (inSection && section.trim()) {
          // Create a synthetic section
          const sectionNode: XMLNode = {
            tag: "SECTION",
            attributes: {},
            children: [],
          };

          rootNode.children.push(sectionNode);
        }
        inSection = !inSection;
      }
    }

    return rootNode;
  }

  /**
   * Enhanced parser that maintains order of text and elements
   */
  private parseElement(xml: string, parentNode: XMLNode): void {
    let currentIndex = 0;

    while (currentIndex < xml.length) {
      const tagStart = xml.indexOf("<", currentIndex);

      // No more tags, add remaining text
      if (tagStart === -1) {
        const remainingText = xml.substring(currentIndex);
        if (remainingText) {
          parentNode.children.push({ text: unescapeXmlText(remainingText) });
        }
        break;
      }

      // Add text before tag
      if (tagStart > currentIndex) {
        const textContent = xml.substring(currentIndex, tagStart);
        if (textContent) {
          parentNode.children.push({ text: unescapeXmlText(textContent) });
        }
      }

      const tagEnd = xml.indexOf(">", tagStart);

      // Incomplete tag
      if (tagEnd === -1) {
        const remainingText = xml.substring(tagStart);
        if (remainingText) {
          parentNode.children.push({ text: unescapeXmlText(remainingText) });
        }
        break;
      }

      const tagContent = xml.substring(tagStart + 1, tagEnd);

      // Closing tag
      if (tagContent.startsWith("/")) {
        const closingTag = tagContent.substring(1);
        if (closingTag.toUpperCase() === parentNode.tag.toUpperCase()) {
          currentIndex = tagEnd + 1;
          break;
        } else {
          currentIndex = tagEnd + 1;
          continue;
        }
      }

      // Comments
      if (tagContent.startsWith("!--")) {
        const commentEnd = xml.indexOf("-->", tagStart);
        currentIndex = commentEnd !== -1 ? commentEnd + 3 : xml.length;
        continue;
      }

      // Parse tag name and attributes
      let tagName: string;
      let attrString: string;

      const firstSpace = tagContent.indexOf(" ");
      if (firstSpace === -1) {
        tagName = tagContent;
        attrString = "";
      } else {
        tagName = tagContent.substring(0, firstSpace);
        attrString = tagContent.substring(firstSpace + 1);
      }

      // Skip special tags
      if (tagName.startsWith("!") || tagName.startsWith("?")) {
        currentIndex = tagEnd + 1;
        continue;
      }

      // Self-closing tag
      const isSelfClosing = tagContent.endsWith("/");
      if (isSelfClosing) {
        tagName = tagName.replace(/\/$/, "");
      }

      // Parse attributes
      const attributes: Record<string, string> = {};
      let attrRemaining = attrString.trim();

      while (attrRemaining.length > 0) {
        const eqIndex = attrRemaining.indexOf("=");
        if (eqIndex === -1) break;

        const attrName = attrRemaining.substring(0, eqIndex).trim();
        attrRemaining = attrRemaining.substring(eqIndex + 1).trim();

        let attrValue = "";
        const quoteChar = attrRemaining.charAt(0);

        if (quoteChar === '"' || quoteChar === "'") {
          const endQuoteIndex = attrRemaining.indexOf(quoteChar, 1);

          if (endQuoteIndex !== -1) {
            attrValue = attrRemaining.substring(1, endQuoteIndex);
            attrRemaining = attrRemaining.substring(endQuoteIndex + 1).trim();
          } else {
            attrValue = attrRemaining.substring(1);
            attrRemaining = "";
          }
        } else {
          const nextSpaceIndex = attrRemaining.indexOf(" ");

          if (nextSpaceIndex !== -1) {
            attrValue = attrRemaining.substring(0, nextSpaceIndex);
            attrRemaining = attrRemaining.substring(nextSpaceIndex + 1).trim();
          } else {
            attrValue = attrRemaining;
            attrRemaining = "";
          }
        }

        attributes[attrName] = unescapeXmlText(attrValue);
      }

      // Create new node
      const newNode: XMLNode = {
        tag: tagName,
        attributes,
        children: [],
        originalTagContent: xml.substring(tagStart, tagEnd + 1),
      };

      // Add to parent's children
      parentNode.children.push(newNode);

      currentIndex = tagEnd + 1;

      // If not self-closing, recursively parse
      if (!isSelfClosing) {
        this.parseElement(xml.substring(currentIndex), newNode);

        const closingTag = `</${tagName}>`;
        const closingTagIndex = xml.indexOf(closingTag, currentIndex);

        if (closingTagIndex !== -1) {
          currentIndex = closingTagIndex + closingTag.length;
        } else {
          break;
        }
      }
    }
  }

  /**
   * Check if text should have generating mark
   */
  private shouldHaveGeneratingMark(text: string): boolean {
    const trimmedText = text.trim();
    if (!trimmedText) return false;

    const textPos = this.latestContent.lastIndexOf(trimmedText);
    if (textPos === -1) return false;

    const textEnd = textPos + trimmedText.length;
    if (textEnd >= this.latestContent.length) return true;

    const afterText = this.latestContent.substring(textEnd).trim();
    return !afterText.startsWith("<");
  }

  /**
   * Create a heading element
   */
  private createHeading(
    level: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
    node: XMLNode,
  ): HeadingElement {
    return {
      type: level,
      ...node.attributes,
      children: this.getTextDescendants(node),
    } as HeadingElement;
  }

  /**
   * Create a paragraph element
   */
  private createParagraph(node: XMLNode): ParagraphElement {
    return {
      type: "p",
      ...node.attributes,
      children: this.getTextDescendants(node),
    } as ParagraphElement;
  }

  /**
   * Create an image element
   */
  private createImage(node: XMLNode): ImageElement | null {
    if (!node.originalTagContent) {
      return null;
    }

    const url = node.attributes.url ?? node.attributes.src ?? "";

    const queryStart = node.originalTagContent.indexOf("query=");

    if (queryStart === -1) {
      return null;
    }

    const afterQuery = node.originalTagContent.substring(queryStart + 6);
    if (afterQuery.length === 0) {
      return null;
    }

    const quoteChar = afterQuery[0];
    if (quoteChar !== '"' && quoteChar !== "'") {
      return null;
    }

    const closingQuoteIdx = afterQuery.indexOf(quoteChar, 1);

    if (closingQuoteIdx === -1) {
      return null;
    }

    const query = afterQuery.substring(1, closingQuoteIdx);

    if (!query || query.trim().length < 3) {
      return null;
    }

    return {
      type: "img",
      ...node.attributes,
      url: url,
      query: query,
      ...(url ? { imageSource: "search" as const } : {}),
      children: [{ text: "" } as TText],
    } as ImageElement;
  }

  /**
   * Create a columns layout element
   */
  private createColumns(node: XMLNode): TColumnGroupElement {
    const columnItems: TColumnElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const columnItem: TColumnElement = {
          type: ColumnItemPlugin.key,
          ...child.attributes,
          width: child.attributes.width ?? "",
          children: this.processNodes(child.children) as Descendant[],
        };
        columnItems.push(columnItem);
      }
    }

    return {
      type: ColumnPlugin.key,
      ...node.attributes,
      children: columnItems,
    } as TColumnGroupElement;
  }

  /**
   * Process a DIV node
   */
  private processDiv(node: XMLNode): PlateNode | null {
    const children = this.processNodes(node.children);

    if (children.length === 0) {
      const textContent = this.getTextContent(node);
      return {
        type: "p",
        ...node.attributes,
        children: [
          {
            text: textContent,
            ...(this.shouldHaveGeneratingMark(textContent)
              ? { generating: true }
              : {}),
          } as TText,
        ],
      } as ParagraphElement;
    } else if (children.length === 1) {
      return children[0] ?? null;
    } else {
      return {
        type: "p",
        ...node.attributes,
        children: children as Descendant[],
      } as ParagraphElement;
    }
  }

  /**
   * Create a bullets layout element
   */
  private createBulletGroup(node: XMLNode): TBulletGroupElement {
    const bulletItems: TBulletItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const bulletItem: TBulletItemElement = {
          type: "bullet",
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children: this.processNodes(child.children) as Descendant[],
        };
        bulletItems.push(bulletItem);
      }
    }

    return {
      type: "bullets",
      ...node.attributes,
      children: bulletItems,
    } as TBulletGroupElement;
  }

  /**
   * Create an icons layout element
   */
  private createIconList(node: XMLNode): TIconListElement {
    const iconItems: TIconListItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        let icon = this.extractIconValue(child);
        const children: Descendant[] = [];

        for (const iconChild of child.children) {
          if (!isElementNode(iconChild)) continue;

          if (iconChild.tag.toUpperCase() === "ICON") {
            icon ||= this.extractIconValue(iconChild);
            continue;
          }

          const processedChild = this.processNode(iconChild);
          if (processedChild) {
            children.push(processedChild as Descendant);
          }
        }

        const iconItem: TIconListItemElement = {
          type: "icon-item",
          ...child.attributes,
          ...(icon ? { icon } : {}),
          ...(child.attributes.prompt
            ? { prompt: child.attributes.prompt }
            : {}),
          children,
        };
        iconItems.push(iconItem);
      }
    }

    return {
      type: "icons",
      ...node.attributes,
      ...(node.attributes.mediaSize
        ? { mediaSize: Number.parseFloat(node.attributes.mediaSize) }
        : {}),
      children: iconItems,
    } as TIconListElement;
  }

  private extractIconValue(node: XMLNode): string {
    const rawValue =
      node.attributes.icon ??
      node.attributes.name ??
      node.attributes.query ??
      "";

    if (!rawValue) return "";

    let sanitizedValue = rawValue;

    if (
      sanitizedValue.includes("<") ||
      sanitizedValue.includes(">") ||
      sanitizedValue.includes("</") ||
      sanitizedValue.includes("SECTION")
    ) {
      const tagIndex = Math.min(
        sanitizedValue.indexOf("<") !== -1
          ? sanitizedValue.indexOf("<")
          : Infinity,
        sanitizedValue.indexOf(">") !== -1
          ? sanitizedValue.indexOf(">")
          : Infinity,
        sanitizedValue.indexOf("</") !== -1
          ? sanitizedValue.indexOf("</")
          : Infinity,
        sanitizedValue.indexOf("SECTION") !== -1
          ? sanitizedValue.indexOf("SECTION")
          : Infinity,
      );

      sanitizedValue = sanitizedValue.substring(0, tagIndex).trim();
    }

    return sanitizedValue.trim().length >= 2 ? sanitizedValue.trim() : "";
  }

  /**
   * Create a cycle layout element
   */
  private createCycle(node: XMLNode): TCycleGroupElement {
    const cycleItems: TCycleItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const cycleItem: TCycleItemElement = {
          type: "cycle-item",
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children: this.processNodes(child.children) as Descendant[],
        };
        cycleItems.push(cycleItem);
      }
    }

    return {
      type: "cycle",
      ...node.attributes,
      children: cycleItems,
    } as TCycleGroupElement;
  }

  /**
   * Create a staircase layout element
   */
  private createStaircase(node: XMLNode): TStairGroupElement {
    const stairItems: TStairItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const stairItem: TStairItemElement = {
          type: "stair-item",
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children: this.processNodes(child.children) as Descendant[],
        };
        stairItems.push(stairItem);
      }
    }

    return {
      type: "staircase",
      ...node.attributes,
      children: stairItems,
    } as TStairGroupElement;
  }

  /**
   * Create a steps layout element
   */
  private createSteps(node: XMLNode): TStepsGroupElement {
    const stepsItems: TStepsItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const stepsItem: TStepsItemElement = {
          type: "steps-item",
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children: this.processNodes(child.children) as Descendant[],
        };
        stepsItems.push(stepsItem);
      }
    }

    return {
      type: "steps",
      ...node.attributes,
      children: stepsItems,
    } as TStepsGroupElement;
  }

  /**
   * Create an arrows layout element
   */
  private createArrowList(node: XMLNode): TArrowListElement {
    const arrowItems: TArrowListItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const itemChildren: Descendant[] = [];

        for (const divChild of child.children) {
          if (isTextNode(divChild)) {
            if (divChild.text.trim()) {
              itemChildren.push({
                text: divChild.text,
                ...(this.shouldHaveGeneratingMark(divChild.text)
                  ? { generating: true }
                  : {}),
              } as TText);
            }
          } else if (isElementNode(divChild)) {
            const processedChild = this.processNode(divChild);
            if (processedChild) {
              itemChildren.push(processedChild as Descendant);
            }
          }
        }

        if (itemChildren.length > 0) {
          arrowItems.push({
            type: "arrow-item",
            ...child.attributes,
            ...(icon ? { icon } : {}),
            children: itemChildren,
          } as TArrowListItemElement);
        }
      }
    }

    return {
      type: "arrows",
      ...node.attributes,
      children:
        arrowItems.length > 0
          ? arrowItems
          : ([{ text: "" } as TText] as Descendant[]),
    } as TArrowListElement;
  }

  /**
   * Create a pyramid layout element
   */
  private createPyramid(node: XMLNode): TPyramidGroupElement {
    const pyramidItems: TPyramidItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const pyramidItem: TPyramidItemElement = {
          type: "pyramid-item",
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children: this.processNodes(child.children) as Descendant[],
        };
        pyramidItems.push(pyramidItem);
      }
    }

    return {
      type: "pyramid",
      ...node.attributes,
      children: pyramidItems,
    } as TPyramidGroupElement;
  }

  /**
   * Create Boxes layout
   */
  private createBoxes(node: XMLNode): TBoxGroupElement {
    const items: TBoxItemElement[] = [];
    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        items.push({
          type: "box-item",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TBoxItemElement);
      }
    }
    return {
      type: "boxes",
      ...node.attributes,
      children: items,
    } as TBoxGroupElement;
  }

  /**
   * Create Compare layout
   */
  private createCompare(node: XMLNode): TCompareGroupElement {
    const sides: TCompareSideElement[] = [];
    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        sides.push({
          type: "compare-side",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TCompareSideElement);
      }
    }
    return {
      type: "compare",
      ...node.attributes,
      children: sides,
    } as TCompareGroupElement;
  }

  /**
   * Create Before/After layout
   */
  private createBeforeAfter(node: XMLNode): TBeforeAfterGroupElement {
    const sides: TBeforeAfterSideElement[] = [];
    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        sides.push({
          type: "before-after-side",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TBeforeAfterSideElement);
      }
    }
    return {
      type: "before-after",
      ...node.attributes,
      children: sides,
    } as TBeforeAfterGroupElement;
  }

  /**
   * Create Pros/Cons layout
   */
  private createProsCons(node: XMLNode): TProsConsGroupElement {
    const children: (TProsItemElement | TConsItemElement)[] = [];
    for (const child of node.children) {
      if (!isElementNode(child)) continue;

      if (child.tag.toUpperCase() === "PROS") {
        children.push({
          type: "pros-item",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TProsItemElement);
      } else if (child.tag.toUpperCase() === "CONS") {
        children.push({
          type: "cons-item",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TConsItemElement);
      } else if (child.tag.toUpperCase() === "DIV") {
        const isPros = children.length % 2 === 0;
        children.push({
          type: isPros ? "pros-item" : "cons-item",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as unknown as TProsItemElement);
      }
    }
    return {
      type: "pros-cons",
      ...node.attributes,
      children,
    } as TProsConsGroupElement;
  }

  /**
   * Create Vertical Arrow layout
   */
  private createArrowVertical(node: XMLNode): TSequenceArrowGroupElement {
    const items: TSequenceArrowItemElement[] = [];
    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        items.push({
          type: "arrow-vertical-item",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TSequenceArrowItemElement);
      }
    }
    return {
      type: "arrow-vertical",
      ...node.attributes,
      children: items,
    } as TSequenceArrowGroupElement;
  }

  /**
   * Create Stats layout for displaying metrics/KPIs
   */
  private createStats(node: XMLNode): TStatsGroupElement {
    const items: TStatsItemElement[] = [];
    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        items.push({
          type: "stats-item",
          stat: child.attributes.stat || "0",
          ...child.attributes,
          children: this.processNodes(child.children) as Descendant[],
        } as TStatsItemElement);
      }
    }
    return {
      type: "stats",
      statsType:
        (node.attributes.statstype as TStatsGroupElement["statsType"]) ||
        "plain",
      ...node.attributes,
      children: items,
    } as TStatsGroupElement;
  }

  /**
   * Create a simple Table layout
   */
  private createPlainTable(node: XMLNode): TTableElement {
    const rows: TTableRowElement[] = [];

    const parseRow = (rowNode: XMLNode): void => {
      if (!rowNode) return;
      const cells: TTableCellElement[] = [];

      for (const cellNode of rowNode.children) {
        if (!isElementNode(cellNode)) continue;

        const tag = cellNode.tag.toUpperCase();
        if (tag === "TD" || tag === "TH") {
          const isCellHeader = tag === "TH";

          const cellChildren = this.processNodes(
            cellNode.children,
          ) as Descendant[];

          const colSpanStr =
            cellNode.attributes.colspan || cellNode.attributes.colSpan;
          const rowSpanStr =
            cellNode.attributes.rowspan || cellNode.attributes.rowSpan;

          const colSpanVal = colSpanStr ? parseInt(colSpanStr, 10) : undefined;
          const rowSpanVal = rowSpanStr ? parseInt(rowSpanStr, 10) : undefined;

          const background =
            cellNode.attributes.background || cellNode.attributes.bg;

          const extraProps: {
            colSpan?: number;
            rowSpan?: number;
            background?: string;
          } = {};
          if (colSpanVal && colSpanVal > 1) extraProps.colSpan = colSpanVal;
          if (rowSpanVal && rowSpanVal > 1) extraProps.rowSpan = rowSpanVal;
          if (background) extraProps.background = background;

          const cell = {
            type: isCellHeader ? "th" : "td",
            ...cellNode.attributes,
            ...extraProps,
            children:
              cellChildren.length > 0
                ? cellChildren
                : ([
                    {
                      type: "p",
                      children: [
                        {
                          text: this.getTextContent(cellNode).trim() || "",
                        } as TText,
                      ],
                    },
                  ] as unknown as Descendant[]),
          } as unknown as TTableCellElement;

          cells.push(cell);
        }
      }

      rows.push({
        type: "tr",
        ...rowNode.attributes,
        children: cells,
      } as TTableRowElement);
    };

    for (const child of node.children) {
      if (!isElementNode(child)) continue;

      const tag = child.tag.toUpperCase();
      if (tag === "THEAD") {
        for (const row of child.children) {
          if (!isElementNode(row)) continue;
          const rowTag = row.tag.toUpperCase();
          if (rowTag === "TR" || rowTag === "ROW") parseRow(row);
        }
      }
    }

    const directRows: XMLNode[] = [];
    const bodyRows: XMLNode[] = [];
    for (const child of node.children) {
      if (!isElementNode(child)) continue;

      const tag = child.tag.toUpperCase();
      if (tag === "TBODY") {
        for (const row of child.children) {
          if (!isElementNode(row)) continue;
          const rowTag = row.tag.toUpperCase();
          if (rowTag === "TR" || rowTag === "ROW") bodyRows.push(row);
        }
      } else if (tag === "TR" || tag === "ROW") {
        directRows.push(child);
      }
    }

    const remainingRows: XMLNode[] = [...directRows, ...bodyRows];

    for (let i = 0; i < remainingRows.length; i++) {
      const row = remainingRows[i]!;
      parseRow(row);
    }

    return {
      type: "table",
      ...node.attributes,
      children: rows,
    } as TTableElement;
  }

  /**
   * Create a timeline layout element
   */
  private createTimeline(node: XMLNode): TTimelineGroupElement {
    const timelineItems: TTimelineItemElement[] = [];
    const orientation =
      parseOrientationAttribute(node.attributes.orientation) ?? "vertical";
    const sidedness =
      parseSidednessAttribute(node.attributes.sidedness) ?? "single";
    const numbered = parseBooleanAttribute(node.attributes.numbered) ?? true;
    const showLine = parseBooleanAttribute(node.attributes.showLine) ?? true;
    const alignment = parseAlignmentAttribute(node.attributes.alignment);
    const variant =
      node.attributes.variant === "boxes" ||
      node.attributes.variant === "default"
        ? node.attributes.variant
        : undefined;

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);
        const itemChildren: Descendant[] = [];

        for (const divChild of child.children) {
          if (isTextNode(divChild)) {
            if (divChild.text.trim()) {
              itemChildren.push({
                text: divChild.text,
                ...(this.shouldHaveGeneratingMark(divChild.text)
                  ? { generating: true }
                  : {}),
              } as TText);
            }
          } else if (isElementNode(divChild)) {
            const processedChild = this.processNode(divChild);
            if (processedChild) {
              itemChildren.push(processedChild as Descendant);
            }
          }
        }

        if (itemChildren.length > 0) {
          timelineItems.push({
            type: "timeline-item",
            ...child.attributes,
            ...(icon ? { icon } : {}),
            children: itemChildren,
          } as TTimelineItemElement);
        }
      }
    }

    return {
      type: "timeline",
      ...node.attributes,
      orientation,
      sidedness,
      numbered,
      showLine,
      ...(alignment ? { alignment } : {}),
      ...(variant ? { variant } : {}),
      children:
        timelineItems.length > 0
          ? timelineItems
          : ([{ text: "" } as TText] as Descendant[]),
    } as TTimelineGroupElement;
  }

  /**
   * Create a chart element
   */
  private createChart(node: XMLNode): PlateNode {
    const chartType = (node.attributes.charttype || "bar").toLowerCase();
    const options = this.parseJsonChild(node, "OPTIONS");
    const parsedData = this.parseChartDataRows(node);
    const elementType = getChartElementType(chartType);
    const attributeOptions = this.getOptionsFromAttributes(node, ["charttype"]);
    const structuredOptions = isRecord(options) ? options : {};

    return {
      type: elementType,
      ...attributeOptions,
      ...structuredOptions,
      data: parsedData,
      children: [{ text: "" } as TText],
    } as PlateNode;
  }

  private createPresentationTitle(node: XMLNode): TPresentationTitleElement {
    const alignment = parseAlignmentAttribute(node.attributes.alignment);
    const variant = parsePresentationTitleVariant(node.attributes.variant);
    const children = this.getTextDescendants(node);

    return {
      type: PRESENTATION_TITLE_ELEMENT,
      ...node.attributes,
      ...(alignment ? { alignment } : {}),
      variant,
      children,
    } as TPresentationTitleElement;
  }

  private createLabel(node: XMLNode): TLabelElement {
    const alignment = parseAlignmentAttribute(node.attributes.alignment);
    const children = this.getTextDescendants(node);

    return {
      type: LABEL_ELEMENT,
      ...node.attributes,
      ...(alignment ? { alignment } : {}),
      children,
    } as TLabelElement;
  }

  private createContributor(_node: XMLNode): TContributorElement {
    return {
      type: CONTRIBUTOR_ELEMENT,
      children: [{ text: "" } as TText],
    } as TContributorElement;
  }

  private createBlockquote(node: XMLNode): TElement {
    return {
      type: KEYS.blockquote,
      ...node.attributes,
      children: this.getTextDescendants(node),
    } as TElement;
  }

  private createCallout(node: XMLNode): TElement {
    const alignment = parseAlignmentAttribute(node.attributes.alignment);
    const children = this.processNodes(node.children) as Descendant[];
    const fallbackText = this.getTextContent(node).trim();
    const finalChildren =
      children.length > 0
        ? children
        : ([
            {
              type: KEYS.p,
              children: [{ text: fallbackText } as TText],
            },
          ] as unknown as Descendant[]);

    return {
      type: KEYS.callout,
      ...node.attributes,
      ...(alignment ? { alignment } : {}),
      children: finalChildren,
    } as TElement;
  }

  private createCodeBlock(node: XMLNode): TElement {
    const code = this.getTextContent(node).replace(/^\n+|\n+$/g, "");
    const lines = code.split(/\r?\n/);
    const language = node.attributes.language ?? node.attributes.lang;

    return {
      type: KEYS.codeBlock,
      ...(language ? { lang: language } : {}),
      children: lines.map(
        (line) =>
          ({
            type: KEYS.codeLine,
            children: [{ text: line } as TText],
          }) as TElement,
      ),
    } as TElement;
  }

  /**
   * Create a non-functional themed Button element
   */
  private createButton(node: XMLNode): PlateNode {
    const variantAttr = (node.attributes.variant || "").toLowerCase();
    const sizeAttr = (node.attributes.size || "").toLowerCase();

    const variant: "filled" | "outline" | "ghost" | undefined =
      variantAttr === "filled" ||
      variantAttr === "outline" ||
      variantAttr === "ghost"
        ? (variantAttr as "filled" | "outline" | "ghost")
        : undefined;

    const size: "sm" | "md" | "lg" | undefined =
      sizeAttr === "sm" || sizeAttr === "md" || sizeAttr === "lg"
        ? (sizeAttr as "sm" | "md" | "lg")
        : undefined;
    const alignment = parseAlignmentAttribute(node.attributes.alignment);

    const children = this.processNodes(node.children) as Descendant[];
    const fallback = this.getTextContent(node).trim() || "";
    const finalChildren =
      children.length > 0
        ? children
        : ([{ text: fallback }] as unknown as Descendant[]);

    return {
      type: "button",
      ...node.attributes,
      ...(variant ? { variant } : {}),
      ...(size ? { size } : {}),
      ...(alignment ? { alignment } : {}),
      children: finalChildren,
    } as unknown as PlateNode;
  }

  /**
   * Extract text descendants from a node, processing inline formatting
   * This is the KEY method that maintains order of text and elements
   */
  private getTextDescendants(node: XMLNode): Descendant[] {
    const descendants: Descendant[] = [];

    for (const child of node.children) {
      if (isTextNode(child)) {
        // Direct text node
        if (child.text) {
          descendants.push({
            text: child.text,
            ...(this.shouldHaveGeneratingMark(child.text)
              ? { generating: true }
              : {}),
          } as TText);
        }
      } else if (isElementNode(child)) {
        const childTag = child.tag.toUpperCase();

        // Handle inline formatting elements
        if (childTag === "B" || childTag === "STRONG") {
          const content = this.getTextContent(child);
          descendants.push({
            text: content,
            bold: true,
            ...(this.shouldHaveGeneratingMark(content)
              ? { generating: true }
              : {}),
          } as Descendant);
        } else if (childTag === "I" || childTag === "EM") {
          const content = this.getTextContent(child);
          descendants.push({
            text: content,
            italic: true,
            ...(this.shouldHaveGeneratingMark(content)
              ? { generating: true }
              : {}),
          } as Descendant);
        } else if (childTag === "U") {
          const content = this.getTextContent(child);
          descendants.push({
            text: content,
            underline: true,
            ...(this.shouldHaveGeneratingMark(content)
              ? { generating: true }
              : {}),
          } as Descendant);
        } else if (childTag === "S" || childTag === "STRIKE") {
          const content = this.getTextContent(child);
          descendants.push({
            text: content,
            strikethrough: true,
            ...(this.shouldHaveGeneratingMark(content)
              ? { generating: true }
              : {}),
          } as Descendant);
        } else {
          // For other elements, recursively process them
          const processedChild = this.processNode(child);
          if (processedChild) {
            descendants.push(processedChild as Descendant);
          }
        }
      }
    }

    // Return empty text node if no descendants
    return descendants.length > 0 ? descendants : [{ text: "" } as TText];
  }

  /**
   * Get the complete text content of a node (flattened)
   */
  private getTextContent(node: XMLNode): string {
    let text = "";

    for (const child of node.children) {
      if (isTextNode(child)) {
        text += child.text;
      } else if (isElementNode(child)) {
        text += this.getTextContent(child);
      }
    }

    return text;
  }

  private getDirectTextContent(node: XMLNode): string {
    return node.children
      .filter(isTextNode)
      .map((child) => child.text)
      .join("\n");
  }

  /**
   * Process a list of XMLNodes into Plate elements
   */
  private processNodes(nodes: Array<XMLNode | XMLTextNode>): PlateNode[] {
    const plateNodes: PlateNode[] = [];

    for (let i = 0; i < nodes.length; ) {
      const node = nodes[i];
      if (!node) {
        i += 1;
        continue;
      }

      // Skip text nodes at this level (they're handled by getTextDescendants)
      if (isTextNode(node)) {
        i += 1;
        continue;
      }

      const tag = node.tag.toUpperCase();

      // Group consecutive <LI> siblings
      if (tag === "LI") {
        const liNodes: XMLNode[] = [];
        let j = i;
        while (j < nodes.length) {
          const candidate = nodes[j];
          if (!candidate || !isElementNode(candidate)) break;
          if (candidate.tag.toUpperCase() !== "LI") break;
          liNodes.push(candidate);
          j += 1;
        }
        const listItems = this.createListItemsFromLiNodes(liNodes);
        for (const item of listItems) plateNodes.push(item);
        i = j;
        continue;
      }

      // Default: process normally
      const processedNode = this.processNode(node);
      if (processedNode) {
        plateNodes.push(processedNode);
      }
      i += 1;
    }

    return plateNodes;
  }

  /**
   * Process a single XMLNode into a Plate element
   */
  private processNode(node: XMLNode): PlateNode | null {
    const tag = node.tag.toUpperCase();

    switch (tag) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return this.createHeading(
          tag.toLowerCase() as "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
          node,
        );
      case "TITLE":
      case "PRESENTATION-TITLE":
      case "PRESENTATION_TITLE":
        return this.createPresentationTitle(node);
      case "LABEL":
        return this.createLabel(node);
      case "CONTRIBUTOR":
        return this.createContributor(node);
      case "BLOCKQUOTE":
        return this.createBlockquote(node);
      case "CALLOUT":
        return this.createCallout(node);
      case "CODE":
      case "CODE-BLOCK":
      case "CODE_BLOCK":
        return this.createCodeBlock(node);
      case "P":
        return this.createParagraph(node);
      case "IMG":
        return this.createImage(node);
      case "INFOGRAPHIC":
        return this.createInfographic(node, "nested");
      case "COLUMNS":
        return this.createColumns(node);
      case "DIV":
        return this.processDiv(node);
      case "BULLETS":
        return this.createBulletGroup(node);
      case "ICONS":
        return this.createIconList(node);
      case "CYCLE":
        return this.createCycle(node);
      case "STAIRCASE":
        return this.createStaircase(node);
      case "CHART":
        return this.createChart(node);
      case "ARROWS":
        return this.createArrowList(node);
      case "BOXES":
        return this.createBoxes(node);
      case "COMPARE":
        return this.createCompare(node);
      case "BEFORE-AFTER":
      case "BEFOREAFTER":
        return this.createBeforeAfter(node);
      case "PROS-CONS":
      case "PROSCONS":
        return this.createProsCons(node);
      case "LI":
        return this.createListItemsFromLiNodes([node])[0] ?? null;
      case "PYRAMID":
        return this.createPyramid(node);
      case "STEPS":
        return this.createSteps(node);
      case "TIMELINE":
        return this.createTimeline(node);
      case "STATS":
        return this.createStats(node);
      case "ARROW-SEQUENCE":
      case "ARROW_SEQUENCE":
      case "ARROW-VERTICAL":
      case "ARROW_VERTICAL":
      case "VERTICAL-ARROWS":
      case "VERTICAL_ARROWS":
        return this.createArrowVertical(node);
      case "ICON":
        return null;
      case "BUTTON":
        return this.createButton(node);
      case "QUOTE":
        return this.createQuote(node);
      case "SLOPE":
        return this.createSlope(node);
      case "CONNECTED-CIRCLES":
      case "CONNECTED_CIRCLES":
        return this.createConnectedCircles(node);
      case "CIRCULAR-GRID":
      case "CIRCULAR_GRID":
        return this.createCircularGrid(node);
      case "SNAKE":
        return this.createSnake(node);
      case "FUNNEL-FLOW":
      case "FUNNEL_FLOW":
        return this.createFunnelFlow(node);
      case "KPI-ROW":
      case "KPI_ROW":
        return this.createKpiRow(node);
      case "PROGRESS-RINGS":
      case "PROGRESS_RINGS":
        return this.createProgressRings(node);
      case "PICTOGRAM":
        return this.createPictogram(node);
      case "HARVEY-TABLE":
      case "HARVEY_TABLE":
        return this.createHarveyTable(node);
      case "MATRIX":
        return this.createMatrix(node);
      case "ORG-CHART":
      case "ORG_CHART":
        return this.createOrgChart(node);
      case "JOURNEY":
        return this.createJourney(node);
      case "VENN":
        return this.createVenn(node);
      case "ICEBERG":
        return this.createIceberg(node);
      case "FLOW":
        return this.createFlow(node);
      default:
        if (node.children.length > 0) {
          const children = this.processNodes(node.children);
          if (children.length > 0) {
            return {
              type: "p",
              ...node.attributes,
              children: children as Descendant[],
            } as ParagraphElement;
          }
        }
        return null;
    }
  }

  /**
   * Create a quote element
   */
  private createQuote(node: XMLNode): TQuoteElement {
    const variant =
      (node.attributes.variant as "large" | "sidequote-icon" | "sidequote") ??
      "large";
    const author = node.attributes.author ?? "";

    const text = this.getTextContent(node).trim();
    const children: Descendant[] = text
      ? [
          {
            text,
            ...(this.shouldHaveGeneratingMark(text)
              ? { generating: true }
              : {}),
          } as TText,
        ]
      : [{ text: "" } as TText];

    return {
      type: QUOTE_ELEMENT,
      ...node.attributes,
      variant,
      author,
      children,
    } as TQuoteElement;
  }

  /**
   * Convert <LI> nodes into Plate list paragraph elements
   */
  private createListItemsFromLiNodes(
    liNodes: XMLNode[],
    isOrdered = false,
  ): ParagraphElement[] {
    const items: ParagraphElement[] = [];

    for (const li of liNodes) {
      let itemChildren = this.processNodes(li.children) as Descendant[];
      const contentText = this.getTextContent(li).trim();

      if ((!itemChildren || itemChildren.length === 0) && contentText) {
        itemChildren = [
          {
            text: contentText,
            ...(this.shouldHaveGeneratingMark(contentText)
              ? { generating: true }
              : {}),
          } as TText,
        ] as unknown as Descendant[];
      }

      if (!itemChildren || itemChildren.length === 0) {
        itemChildren = [{ text: "" } as TText] as unknown as Descendant[];
      }

      items.push({
        type: "p",
        ...li.attributes,
        children: itemChildren,
        indent: 1,
        listStyleType: isOrdered ? "decimal" : "disc",
      } as unknown as ParagraphElement);
    }

    return items;
  }

  /**
   * Create a slope layout element
   */
  private createSlope(node: XMLNode): TSlopeGroupElement {
    const slopeItems: TSlopeItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = this.extractIconValue(child);

        // Slope items can ONLY hold headings of very small levels (e.g. H4) and NO description.
        // We extract text content and wrap it in a single h4 element, discarding any other tags.
        let textContent = "";
        for (const gc of child.children) {
          if (isTextNode(gc)) {
            textContent += gc.text;
          } else if (isElementNode(gc)) {
            const gcTag = gc.tag.toUpperCase();
            if (["H1", "H2", "H3", "H4", "H5", "H6", "P"].includes(gcTag)) {
              textContent += this.getTextContent(gc);
            }
          }
        }

        const titleText = textContent.trim();
        const headingNode: HeadingElement = {
          type: "h4",
          children: [
            {
              text: titleText,
              ...(this.shouldHaveGeneratingMark(titleText)
                ? { generating: true }
                : {}),
            } as TText,
          ],
        } as HeadingElement;

        const slopeItem: TSlopeItemElement = {
          type: SLOPE_ITEM,
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children: [headingNode],
        };
        slopeItems.push(slopeItem);
      }
    }

    return {
      type: SLOPE_GROUP,
      ...node.attributes,
      children: slopeItems,
    } as TSlopeGroupElement;
  }

  /**
   * Create a connected circles layout element
   */
  private createConnectedCircles(node: XMLNode): TConnectedCirclesGroupElement {
    const connectedCirclesItems: TConnectedCirclesItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const itemChildren = this.processNodes(child.children) as Descendant[];
        const connectedCirclesItem: TConnectedCirclesItemElement = {
          type: CONNECTED_CIRCLES_ITEM,
          ...child.attributes,
          children:
            itemChildren.length > 0 ? itemChildren : [{ text: "" } as TText],
        };
        connectedCirclesItems.push(connectedCirclesItem);
      }
    }

    return {
      type: CONNECTED_CIRCLES_GROUP,
      ...node.attributes,
      children: connectedCirclesItems,
    } as TConnectedCirclesGroupElement;
  }

  /**
   * Create a circular grid layout element
   */
  private createCircularGrid(node: XMLNode): TCircularGridGroupElement {
    const circularGridItems: TCircularGridItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const itemChildren = this.processNodes(child.children) as Descendant[];
        const circularGridItem: TCircularGridItemElement = {
          type: CIRCULAR_GRID_ITEM,
          ...child.attributes,
          children:
            itemChildren.length > 0 ? itemChildren : [{ text: "" } as TText],
        };
        circularGridItems.push(circularGridItem);
      }
    }

    const centerText =
      node.attributes.centertext ||
      node.attributes.centerText ||
      "Smart Diagram";

    return {
      type: CIRCULAR_GRID_GROUP,
      centerText,
      ...node.attributes,
      children: circularGridItems,
    } as TCircularGridGroupElement;
  }

  /**
   * Create a snake layout element
   */
  private createSnake(node: XMLNode): TSnakeGroupElement {
    const snakeItems: TSnakeItemElement[] = [];

    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const itemChildren = this.processNodes(child.children) as Descendant[];
        const snakeItem: TSnakeItemElement = {
          type: SNAKE_ITEM,
          ...child.attributes,
          children:
            itemChildren.length > 0 ? itemChildren : [{ text: "" } as TText],
        };
        snakeItems.push(snakeItem);
      }
    }

    return {
      type: SNAKE_GROUP,
      ...node.attributes,
      children: snakeItems,
    } as TSnakeGroupElement;
  }

  /* ================= P4-W4 native infographic components =================
     Each maps DIV items through the shared pattern (attributes spread onto
     the node, children via processNodes, [{text:""}] guard so Plate children
     are never empty). New tags only — existing golden output is untouched. */

  /** Shared DIV-item mapper for the flat infographic groups. */
  private createInfographicGroup(
    node: XMLNode,
    groupType: string,
    itemType: string,
    withIcon = false,
  ): TElement {
    const items: TElement[] = [];
    for (const child of node.children) {
      if (isElementNode(child) && child.tag.toUpperCase() === "DIV") {
        const icon = withIcon ? this.extractIconValue(child) : "";
        const itemChildren = this.processNodes(child.children) as Descendant[];
        items.push({
          type: itemType,
          ...child.attributes,
          ...(icon ? { icon } : {}),
          children:
            itemChildren.length > 0
              ? itemChildren
              : ([{ text: "" } as TText] as Descendant[]),
        } as TElement);
      }
    }
    return {
      type: groupType,
      ...node.attributes,
      children:
        items.length > 0
          ? items
          : ([{ text: "" } as TText] as Descendant[]),
    } as TElement;
  }

  /** <FUNNEL-FLOW showDrop="true"> with <DIV value="12400"><H3>…</H3></DIV>. */
  private createFunnelFlow(node: XMLNode): TElement {
    return this.createInfographicGroup(node, FUNNEL_FLOW_GROUP, FUNNEL_FLOW_ITEM);
  }

  /** <KPI-ROW> of self-closing <DIV label value delta dir good spark />. */
  private createKpiRow(node: XMLNode): TElement {
    return this.createInfographicGroup(node, KPI_ROW_GROUP, KPI_ROW_ITEM);
  }

  /** <PROGRESS-RINGS> with <DIV pct="78"><H3>…</H3></DIV>. */
  private createProgressRings(node: XMLNode): TElement {
    return this.createInfographicGroup(
      node,
      PROGRESS_RINGS_GROUP,
      PROGRESS_RING_ITEM,
    );
  }

  /** <PICTOGRAM total filled icon perRow> — icon resolves via the existing
      pipeline (walk.ts collectIconQueries reads node.icon → node.iconUrl). */
  private createPictogram(node: XMLNode): TElement {
    const icon = this.extractIconValue(node);
    const caption = this.processNodes(node.children) as Descendant[];
    return {
      type: PICTOGRAM_ELEMENT,
      ...node.attributes,
      ...(icon ? { icon } : {}),
      children:
        caption.length > 0
          ? caption
          : ([{ text: "" } as TText] as Descendant[]),
    } as TElement;
  }

  /** <HARVEY-TABLE> — TR/TH/TD parsing reused from TABLE; td ball="0..4"
      attributes survive via the attribute spread. */
  private createHarveyTable(node: XMLNode): TElement {
    const table = this.createPlainTable(node);
    return { ...table, type: HARVEY_TABLE_ELEMENT } as TElement;
  }

  /** <MATRIX xLabel yLabel xLow xHigh yLow yHigh> with quad/tone DIVs. */
  private createMatrix(node: XMLNode): TElement {
    return this.createInfographicGroup(node, MATRIX_GROUP, MATRIX_ITEM);
  }

  /** <JOURNEY> with <DIV stage mood icon><H3/><P/></DIV> items. */
  private createJourney(node: XMLNode): TElement {
    return this.createInfographicGroup(node, JOURNEY_GROUP, JOURNEY_ITEM, true);
  }

  /** <VENN overlapLabel> with 2-3 <DIV><H3>…</H3></DIV> sets. */
  private createVenn(node: XMLNode): TElement {
    return this.createInfographicGroup(node, VENN_GROUP, VENN_ITEM);
  }

  /**
   * <ORG-CHART> — nested <DIV name role> children (children of a DIV are its
   * reports).
   *
   * parseElement's closing-tag resync scans for the FIRST `</DIV>` after an
   * opening tag, so a non-self-closing DIV containing non-self-closing DIVs
   * makes the outer frame resync inside the subtree and re-parse trailing
   * content as duplicate SIBLINGS of the root. Those artifacts are exact
   * re-parses of content already captured inside an accepted root, so they
   * are dropped by subtree signature — without touching parseElement (whose
   * behavior is frozen by the golden fixtures).
   */
  private createOrgChart(node: XMLNode): TElement {
    const signature = (n: XMLNode): string => {
      const parts: string[] = [n.tag.toUpperCase()];
      for (const key of Object.keys(n.attributes).sort()) {
        parts.push(`${key}=${n.attributes[key]}`);
      }
      for (const c of n.children) {
        if (isElementNode(c)) parts.push(`(${signature(c)})`);
      }
      return parts.join("|");
    };
    const seen = new Set<string>();
    const collectDescendants = (n: XMLNode): void => {
      for (const c of n.children) {
        if (!isElementNode(c)) continue;
        seen.add(signature(c));
        collectDescendants(c);
      }
    };

    const roots: TElement[] = [];
    for (const child of node.children) {
      if (!isElementNode(child) || child.tag.toUpperCase() !== "DIV") continue;
      if (seen.has(signature(child))) continue; // resync artifact
      roots.push(this.createOrgChartPerson(child));
      collectDescendants(child);
    }

    return {
      type: ORG_CHART_GROUP,
      ...node.attributes,
      children:
        roots.length > 0
          ? roots
          : ([{ text: "" } as TText] as Descendant[]),
    } as TElement;
  }

  private createOrgChartPerson(child: XMLNode): TElement {
    const reports: TElement[] = [];
    for (const sub of child.children) {
      if (isElementNode(sub) && sub.tag.toUpperCase() === "DIV") {
        reports.push(this.createOrgChartPerson(sub));
      }
    }
    return {
      type: ORG_CHART_NODE,
      ...child.attributes,
      children:
        reports.length > 0
          ? reports
          : ([{ text: "" } as TText] as Descendant[]),
    } as TElement;
  }

  /** <ICEBERG> with <ABOVE> and <BELOW> children holding H3/LI content. */
  private createIceberg(node: XMLNode): TElement {
    const sides: TElement[] = [];
    for (const child of node.children) {
      if (!isElementNode(child)) continue;
      const tag = child.tag.toUpperCase();
      if (tag !== "ABOVE" && tag !== "BELOW") continue;
      const sideChildren = this.processNodes(child.children) as Descendant[];
      sides.push({
        type: ICEBERG_SIDE,
        ...child.attributes,
        side: tag === "ABOVE" ? "above" : "below",
        children:
          sideChildren.length > 0
            ? sideChildren
            : ([{ text: "" } as TText] as Descendant[]),
      } as TElement);
    }
    return {
      type: ICEBERG_ELEMENT,
      ...node.attributes,
      children:
        sides.length > 0
          ? sides
          : ([{ text: "" } as TText] as Descendant[]),
    } as TElement;
  }

  /** <FLOW direction="TB|LR"> — raw text DSL captured into node.syntax
      (mirrors how CODE captures its content); the renderer parses + lays
      out via src/lib/diagram/flow.ts. */
  private createFlow(node: XMLNode): TElement {
    const syntax = this.getTextContent(node).replace(/^\n+|\n+$/g, "");
    const direction = node.attributes.direction === "LR" ? "LR" : "TB";
    return {
      type: FLOW_DIAGRAM_ELEMENT,
      ...node.attributes,
      direction,
      syntax,
      children: [{ text: "" } as TText],
    } as TElement;
  }
}

// Example usage
export function parseSlideXml(xmlData: string): PlateSlide[] {
  const parser = new SlideParser();
  parser.parseChunk(xmlData);
  parser.finalize();
  return parser.getAllSlides();
}
