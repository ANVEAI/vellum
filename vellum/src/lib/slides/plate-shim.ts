/**
 * Structural stand-ins for the Plate editor types/constants the slide parser
 * depends on, so generation + tests run headless without the editor installed.
 * Plate is structurally typed — nodes are plain JSON — so the editor (added in
 * a later phase) consumes these exact same shapes.
 *
 * Element type strings and interfaces derived from allweonedev/presentation-ai
 * (MIT) — see THIRD_PARTY_LICENSES.md.
 */

export interface TText {
  text: string;
  [key: string]: unknown;
}

export interface TElement {
  type: string;
  children: Descendant[];
  [key: string]: unknown;
}

export type Descendant = TElement | TText;

// Plate structural aliases (loose on purpose; tightened editor-side later).
export type TColumnElement = TElement;
export type TColumnGroupElement = TElement;
export type TTableCellElement = TElement;
export type TTableElement = TElement;
export type TTableRowElement = TElement;

// Subset of platejs KEYS used by the parser.
export const KEYS = {
  p: "p",
  blockquote: "blockquote",
  callout: "callout",
  codeBlock: "code_block",
  codeLine: "code_line",
} as const;

export const ColumnPlugin = { key: "column_group" } as const;
export const ColumnItemPlugin = { key: "column" } as const;

// ---- Element type constants (values must match the ported editor plugins) ----
export const BULLET_ITEM = "bullet";
export const BULLET_GROUP = "bullets";
export const STAIR_ITEM = "stair-item";
export const STAIRCASE_GROUP = "staircase";
export const CYCLE_ITEM = "cycle-item";
export const CYCLE_GROUP = "cycle";
export const ICON_ELEMENT = "icon";
export const ICON_LIST_ITEM = "icon-item";
export const ICON_LIST = "icons";
export const ARROW_LIST = "arrows";
export const ARROW_LIST_ITEM = "arrow-item";
export const PYRAMID_GROUP = "pyramid";
export const PYRAMID_ITEM = "pyramid-item";
export const TIMELINE_GROUP = "timeline";
export const TIMELINE_ITEM = "timeline-item";
export const BOX_GROUP = "boxes";
export const BOX_ITEM = "box-item";
export const COLUMN_GROUP = "column_group";
export const COLUMN_ITEM = "column";
export const COMPARE_GROUP = "compare";
export const COMPARE_SIDE = "compare-side";
export const BEFORE_AFTER_GROUP = "before-after";
export const BEFORE_AFTER_SIDE = "before-after-side";
export const PROS_CONS_GROUP = "pros-cons";
export const PROS_ITEM = "pros-item";
export const CONS_ITEM = "cons-item";
export const SEQUENCE_ARROW_GROUP = "arrow-vertical";
export const SEQUENCE_ARROW_ITEM = "arrow-vertical-item";
export const STATS_GROUP = "stats";
export const STATS_ITEM = "stats-item";
export const FLEX_BOX = "flex_box";
export const SLOPE_GROUP = "slope";
export const SLOPE_ITEM = "slope-item";
export const CONNECTED_CIRCLES_GROUP = "connected-circles";
export const CONNECTED_CIRCLES_ITEM = "connected-circle-item";
export const CIRCULAR_GRID_GROUP = "circular-grid";
export const CIRCULAR_GRID_ITEM = "circular-grid-item";
export const CIRCULAR_GRID_MAX_ITEMS = 6;
export const SNAKE_GROUP = "snake";
export const SNAKE_ITEM = "snake-item";
export const STEPS_GROUP = "steps";
export const STEPS_ITEM = "steps-item";
export const QUOTE_ELEMENT = "quote" as const;

export const PIE_CHART_ELEMENT = "chart-pie" as const;
export const BAR_CHART_ELEMENT = "chart-bar" as const;
export const AREA_CHART_ELEMENT = "chart-area" as const;
export const RADAR_CHART_ELEMENT = "chart-radar" as const;
export const SCATTER_CHART_ELEMENT = "chart-scatter" as const;
export const LINE_CHART_ELEMENT = "chart-line" as const;
export const RADIAL_BAR_CHART_ELEMENT = "chart-radial-bar" as const;
export const COMPOSED_CHART_ELEMENT = "chart-composed" as const;
export const TREEMAP_CHART_ELEMENT = "chart-treemap" as const;
export const BUBBLE_CHART_ELEMENT = "chart-bubble" as const;
export const DONUT_CHART_ELEMENT = "chart-donut" as const;
export const HISTOGRAM_CHART_ELEMENT = "chart-histogram" as const;
export const HEATMAP_CHART_ELEMENT = "chart-heatmap" as const;
export const RANGE_BAR_CHART_ELEMENT = "chart-range-bar" as const;
export const RANGE_AREA_CHART_ELEMENT = "chart-range-area" as const;
export const WATERFALL_CHART_ELEMENT = "chart-waterfall" as const;
export const BOX_PLOT_CHART_ELEMENT = "chart-box-plot" as const;
export const CANDLESTICK_CHART_ELEMENT = "chart-candlestick" as const;
export const OHLC_CHART_ELEMENT = "chart-ohlc" as const;
export const NIGHTINGALE_CHART_ELEMENT = "chart-nightingale" as const;
export const RADIAL_COLUMN_CHART_ELEMENT = "chart-radial-column" as const;
export const SUNBURST_CHART_ELEMENT = "chart-sunburst" as const;
export const SANKEY_CHART_ELEMENT = "chart-sankey" as const;
export const CHORD_CHART_ELEMENT = "chart-chord" as const;
export const FUNNEL_CHART_ELEMENT = "chart-funnel" as const;
export const CONE_FUNNEL_CHART_ELEMENT = "chart-cone-funnel" as const;
export const PYRAMID_CHART_ELEMENT = "chart-pyramid" as const;
export const RADIAL_GAUGE_ELEMENT = "chart-radial-gauge" as const;
export const LINEAR_GAUGE_ELEMENT = "chart-linear-gauge" as const;

export const BUTTON_ELEMENT = "button" as const;
export const CONTRIBUTOR_ELEMENT = "contributor" as const;
export const LABEL_ELEMENT = "label" as const;
export const PRESENTATION_TITLE_ELEMENT = "presentation-title" as const;
export const ANTV_INFOGRAPHIC = "antv-infographic" as const;

// ---- P4-W4 native infographic components ----
export const FUNNEL_FLOW_GROUP = "funnel-flow";
export const FUNNEL_FLOW_ITEM = "funnel-flow-item";
export const KPI_ROW_GROUP = "kpi-row";
export const KPI_ROW_ITEM = "kpi-item";
export const PROGRESS_RINGS_GROUP = "progress-rings";
export const PROGRESS_RING_ITEM = "progress-ring-item";
export const PICTOGRAM_ELEMENT = "pictogram";
export const HARVEY_TABLE_ELEMENT = "harvey-table";
export const MATRIX_GROUP = "matrix";
export const MATRIX_ITEM = "matrix-item";
export const ORG_CHART_GROUP = "org-chart";
export const ORG_CHART_NODE = "org-node";
export const JOURNEY_GROUP = "journey";
export const JOURNEY_ITEM = "journey-item";
export const VENN_GROUP = "venn";
export const VENN_ITEM = "venn-item";
export const ICEBERG_ELEMENT = "iceberg";
export const ICEBERG_SIDE = "iceberg-side";
export const FLOW_DIAGRAM_ELEMENT = "flow-diagram";

// ---- Plugin element types (structural aliases for the headless phase) ----
export type TAntvInfographicElement = TElement;
export type TArrowListElement = TElement;
export type TArrowListItemElement = TElement;
export type TBeforeAfterGroupElement = TElement;
export type TBeforeAfterSideElement = TElement;
export type TBoxGroupElement = TElement;
export type TBoxItemElement = TElement;
export type TBulletGroupElement = TElement;
export type TBulletItemElement = TElement;
export type TButtonElement = TElement;
export type TCompareGroupElement = TElement;
export type TCompareSideElement = TElement;
export type TCycleGroupElement = TElement;
export type TCycleItemElement = TElement;
export type TCircularGridGroupElement = TElement;
export type TCircularGridItemElement = TElement;
export type TConnectedCirclesGroupElement = TElement;
export type TConnectedCirclesItemElement = TElement;
export type TSlopeGroupElement = TElement;
export type TSlopeItemElement = TElement;
export type TSnakeGroupElement = TElement;
export type TSnakeItemElement = TElement;
export type TIconListElement = TElement;
export type TIconListItemElement = TElement;
export type TIconElement = TElement;
export type TConsItemElement = TElement;
export type TProsConsGroupElement = TElement;
export type TProsItemElement = TElement;
export type TPyramidGroupElement = TElement;
export type TPyramidItemElement = TElement;
export type TQuoteElement = TElement;
export type TSequenceArrowGroupElement = TElement;
export type TSequenceArrowItemElement = TElement;
export type TStairGroupElement = TElement;
export type TStairItemElement = TElement;
export type TStatsGroupElement = TElement;
export type TStatsItemElement = TElement;
export type TStepsGroupElement = TElement;
export type TStepsItemElement = TElement;
export type TTimelineGroupElement = TElement;
export type TTimelineItemElement = TElement;
export type TContributorElement = TElement;
export type TLabelElement = TElement;
export type TPresentationTitleElement = TElement;
// P4-W4 infographic structural aliases.
export type TFunnelFlowGroupElement = TElement;
export type TFunnelFlowItemElement = TElement;
export type TKpiRowGroupElement = TElement;
export type TKpiRowItemElement = TElement;
export type TProgressRingsGroupElement = TElement;
export type TProgressRingItemElement = TElement;
export type TPictogramElement = TElement;
export type THarveyTableElement = TElement;
export type TMatrixGroupElement = TElement;
export type TMatrixItemElement = TElement;
export type TOrgChartGroupElement = TElement;
export type TOrgChartNodeElement = TElement;
export type TJourneyGroupElement = TElement;
export type TJourneyItemElement = TElement;
export type TVennGroupElement = TElement;
export type TVennItemElement = TElement;
export type TIcebergElement = TElement;
export type TIcebergSideElement = TElement;
export type TFlowDiagramElement = TElement;

export type PresentationStockImageProvider = "unsplash" | "pixabay" | "google";

// ---- utils/types.ts equivalents ----
export interface GeneratingText extends TText {
  text: string;
  generating?: boolean;
}

export interface ImageCropSettings {
  objectFit: "cover" | "contain" | "fill" | "none" | "scale-down";
  objectPosition: { x: number; y: number };
  zoom?: number;
}

export type ParagraphElement = TElement & { type: "p" };
export type HeadingElement = TElement & {
  type: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
};
export type ImageElement = TElement & {
  type: "img";
  url: string;
  query: string;
};
export type TChartElement = TElement & {
  type: "chart";
  chartType: "horizontal-bar" | "vertical-bar" | "pie" | "line";
  data: Array<{ label: string; value: number }>;
};
