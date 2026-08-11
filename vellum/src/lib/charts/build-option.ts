/**
 * Chart node → ECharts option. Shared by the client renderer and the
 * server-side SVG exporter so charts look identical on screen and in
 * PPTX/PDF/DOCX. NOTHING here may depend on the DOM or text measurement.
 *
 * Chart-as-node approach derived from allweonedev/presentation-ai (MIT) —
 * see THIRD_PARTY_LICENSES.md. Option-building is vellum's own.
 */

import { SERIES_FALLBACK } from "@/lib/design/tokens";

export interface ChartPalette {
  text: string;
  heading: string;
  accent: string;
  muted: string;
  /** Slide background — used for annotation label chips. */
  bg?: string;
  series: string[];
}

export function paletteFromColors(colors: {
  text: string;
  heading: string;
  accent: string;
  primary?: string;
  background?: string;
}): ChartPalette {
  const base = [
    colors.accent,
    colors.primary ?? colors.heading,
    ...SERIES_FALLBACK,
  ];
  return {
    text: colors.text,
    heading: colors.heading,
    accent: colors.accent,
    muted: colors.text,
    bg: colors.background,
    series: [...new Set(base)],
  };
}

type Row = Record<string, string | number>;

/**
 * Node types with a real, purpose-built ECharts mapping. QA lint can flag
 * any chart-* type outside this set (only `chord` degrades to plain bars).
 */
export const SUPPORTED_CHART_TYPES: Set<string> = new Set(
  [
    "bar",
    "line",
    "area",
    "pie",
    "donut",
    "radar",
    "scatter",
    "bubble",
    "funnel",
    "cone-funnel",
    "pyramid",
    "radial-gauge",
    "linear-gauge",
    "heatmap",
    "waterfall",
    "treemap",
    "sunburst",
    "composed",
    "histogram",
    "nightingale",
    "candlestick",
    "ohlc",
    "box-plot",
    "radial-column",
    "radial-bar",
    "sankey",
    "slope",
    "lollipop",
    "dumbbell",
    "range-bar",
    "range-area",
  ].map((kind) => `chart-${kind}`),
);

export interface ChartBuildOptions {
  /** Rendered as the option title (fontSize 15, heading color) when present. */
  title?: string;
  /** "compact" abbreviates large plain numbers (12,400 → 12.4k). */
  numberFormat?: string;
  /**
   * Spotlight one category (bar/lollipop/slope/pie), or one series
   * (line/area), by label — case-insensitive — or by numeric index.
   * Everything else stays neutral gray.
   */
  focus?: string | number;
  /** Solid accent line at this value, labeled "Target {value}". */
  target?: number | string;
  /** Dashed average line over the last series, labeled "Avg {value}". */
  avg?: boolean | string;
  /** One annotated point: "max: text", "min: text", or bare text (at max). */
  callout?: string;
  /** Credit line "Source: …" rendered bottom-left. */
  source?: string;
  /** Unit subtitle under the title ("$m", "%", "hrs"). */
  unit?: string;
  /** Small multiples: one panel per series (line/area/bar, 2–6 series). */
  facet?: boolean | string;
}

/**
 * Unit pattern detected from original string cells ("$1,200", "3.4M", "85%",
 * "12k") so axes and value labels keep the unit the author wrote.
 */
export interface UnitFormat {
  prefix: string;
  suffix: string;
}

const UNIT_RE = /^\s*([$€£]?)\s*[-+]?\d[\d.,\s]*(%|[kKmMbB])?\s*$/;

export function detectUnitFormat(rows: Row[], field: string): UnitFormat {
  for (const row of rows) {
    const raw = row[field];
    if (typeof raw !== "string") continue;
    const m = UNIT_RE.exec(raw);
    if (m && (m[1] || m[2])) {
      return { prefix: m[1] ?? "", suffix: m[2] ?? "" };
    }
  }
  return { prefix: "", suffix: "" };
}

function trimNumber(v: number, digits: number): string {
  return v
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatPlain(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return trimNumber(v, Math.abs(v) < 10 ? 2 : 1);
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${trimNumber(v / 1e9, 1)}B`;
  if (abs >= 1e6) return `${trimNumber(v / 1e6, 1)}M`;
  if (abs >= 1e4) return `${trimNumber(v / 1e3, 1)}k`;
  return formatPlain(v);
}

/** Formatter factory: re-applies the detected unit; optionally compacts. */
export function makeValueFormatter(
  unit: UnitFormat,
  compact: boolean,
): (v: unknown) => string {
  return (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isFinite(n)) return String(v ?? "");
    const body = compact && !unit.suffix ? compactNumber(n) : formatPlain(n);
    return `${unit.prefix}${body}${unit.suffix}`;
  };
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fieldNames(rows: Row[]): string[] {
  return rows.length ? Object.keys(rows[0]) : [];
}

/** Case-insensitive field lookup for typed charts (open/close, source/…). */
function fieldLookup(rows: Row[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fieldNames(rows)) map.set(f.trim().toLowerCase(), f);
  return map;
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const frac = pos - lower;
  const lo = sorted[lower] ?? 0;
  const hi = sorted[upper] ?? lo;
  return lo + (hi - lo) * frac;
}

/** First column = category, remaining numeric columns = series. */
function splitColumns(rows: Row[]): {
  category: string;
  series: string[];
} {
  const fields = fieldNames(rows);
  if (fields.length === 0) return { category: "label", series: [] };
  return { category: fields[0], series: fields.slice(1) };
}

/** XML attributes arrive as strings — accept true and "true". */
function isTruthyFlag(v: unknown): boolean {
  return v === true || (typeof v === "string" && v.trim().toLowerCase() === "true");
}

/**
 * Resolve a focus value against a list of labels: case-insensitive label
 * match first, then numeric index. Returns -1 when nothing matches.
 */
function resolveFocus(
  focus: string | number | undefined,
  labels: string[],
): number {
  if (focus === undefined || focus === null) return -1;
  if (typeof focus === "number") {
    return Number.isInteger(focus) && focus >= 0 && focus < labels.length
      ? focus
      : -1;
  }
  const s = String(focus).trim().toLowerCase();
  if (!s) return -1;
  const byLabel = labels.findIndex((l) => l.trim().toLowerCase() === s);
  if (byLabel >= 0) return byLabel;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
}

/** Category labels flagged as forecast/estimate: "2026 (f)", "Q4 (E)", "2027 F". */
export const FORECAST_SUFFIX_RE = /\((?:f|e|F|E)\)$|\s(?:F|E)$/;

/** Ceil to two significant digits so shared facet axes land on clean ticks. */
function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.ceil(v / mag) * mag;
}

/**
 * Kinds that do NOT render a single vertical category-x / value-y grid —
 * the annotation layer (target line, forecast band) skips these.
 */
const NON_VERTICAL_KINDS = new Set([
  "pie",
  "donut",
  "radar",
  "scatter",
  "bubble",
  "funnel",
  "cone-funnel",
  "pyramid",
  "radial-gauge",
  "linear-gauge",
  "heatmap",
  "treemap",
  "sunburst",
  "nightingale",
  "sankey",
  "radial-column",
  "radial-bar",
  "slope",
  "range-bar",
  "dumbbell",
]);

/** Kinds whose last series is not a plain value series — avg/callout skip. */
const NO_SERIES_ANNOTATION_KINDS = new Set([
  "waterfall",
  "range-area",
  "candlestick",
  "ohlc",
  "box-plot",
]);

export function buildChartOption(
  nodeType: string,
  rows: Row[],
  palette: ChartPalette,
  opts: ChartBuildOptions = {},
): Record<string, unknown> {
  const kind = nodeType.replace(/^chart-/, "");
  const { category, series } = splitColumns(rows);
  const rawCategories = rows.map((r) => String(r[category] ?? ""));
  const byLower = fieldLookup(rows);

  const compact = opts.numberFormat === "compact";
  const unitDetected = detectUnitFormat(rows, series[0] ?? "value");
  const fmt = makeValueFormatter(unitDetected, compact);

  const neutral = `${palette.text}55`;
  const chipBg = palette.bg ?? "#ffffff";

  // ---- Layout modes & annotation applicability ---------------------------
  const facet =
    isTruthyFlag(opts.facet) &&
    (kind === "line" || kind === "area" || kind === "bar") &&
    series.length >= 2 &&
    series.length <= 6;
  // Positional annotations (target line, forecast band) fit any single-grid
  // vertical cartesian chart; series annotations (avg, callout) additionally
  // need the last series to be a plain value series.
  const positional = !facet && !NON_VERTICAL_KINDS.has(kind);
  const seriesAnnot = positional && !NO_SERIES_ANNOTATION_KINDS.has(kind);

  // Forecast categories: shade the band and strip the marker suffix.
  const forecastIdxs = positional
    ? rawCategories.reduce<number[]>(
        (acc, c, i) => (FORECAST_SUFFIX_RE.test(c.trim()) ? [...acc, i] : acc),
        [],
      )
    : [];
  const categories = forecastIdxs.length
    ? rawCategories.map((c) => c.trim().replace(FORECAST_SUFFIX_RE, "").trim())
    : rawCategories;

  // Focus: a category/row index (bars, slices, slope rows) or a series name
  // (multi-series line/area). Resolved against stripped, then raw, labels.
  let focusCat = resolveFocus(opts.focus, categories);
  if (focusCat < 0) focusCat = resolveFocus(opts.focus, rawCategories);
  const focusSeries = resolveFocus(opts.focus, series);

  // ---- Title block: title + unit subtitle + source credit ----------------
  const title = (opts.title ?? "").trim();
  const explicitUnit = (opts.unit ?? "").trim();
  const detectedUnit =
    unitDetected.prefix || unitDetected.suffix
      ? `${unitDetected.prefix}${unitDetected.suffix}`
      : "";
  // Auto-derived units only ride along under an explicit title; an explicit
  // opts.unit always shows.
  const unitText = explicitUnit || (title ? detectedUnit : "");
  const source = (opts.source ?? "").trim();
  const titleOffset = title ? (unitText ? 42 : 26) : unitText ? 18 : 0;

  const titleEntries: Array<Record<string, unknown>> = [];
  if (title || unitText) {
    titleEntries.push({
      text: title,
      ...(unitText
        ? {
            subtext: unitText,
            subtextStyle: {
              color: `${palette.text}a6`,
              fontSize: 11,
              fontFamily: "inherit",
            },
          }
        : {}),
      left: 4,
      top: 0,
      textStyle: {
        color: palette.heading,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: "inherit",
      },
    });
  }
  if (source) {
    titleEntries.push({
      text: `Source: ${source}`,
      left: 4,
      bottom: 0,
      textStyle: {
        color: `${palette.text}8c`,
        fontSize: 10,
        fontWeight: 400,
        fontFamily: "inherit",
      },
    });
  }

  // Direct value labels only while the chart stays readable.
  const showValueLabels =
    series.length >= 1 &&
    series.length <= 2 &&
    rows.length >= 1 &&
    rows.length <= 8;
  // Legend only for genuinely multi-series charts — never for one series.
  const hasLegend = series.length > 1;

  // ---- Explicit axis minimalism ------------------------------------------
  // Category axis: baseline on, no ticks, no gridlines. Value axis: no
  // baseline, hairline gridlines, few splits, unit-preserving labels.
  const catAxisStyle = {
    axisLabel: { color: palette.text, fontSize: 13, hideOverlap: true },
    axisLine: { lineStyle: { color: `${palette.text}55` } },
    axisTick: { show: false },
    splitLine: { show: false },
  };
  const valueAxisStyle = (formatter?: (v: unknown) => string) => ({
    axisLabel: {
      color: palette.text,
      fontSize: 13,
      ...(formatter ? { formatter } : {}),
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: `${palette.text}14`, width: 1 } },
    splitNumber: 4,
  });

  const gridFor = (legend: boolean) => ({
    left: 8,
    right: 16,
    top: titleOffset + (legend ? 36 : 16),
    bottom: source ? 22 : 8,
    containLabel: true,
  });
  const base: Record<string, unknown> = {
    color: palette.series,
    textStyle: { color: palette.text, fontFamily: "inherit" },
    ...(titleEntries.length ? { title: titleEntries } : {}),
    legend: hasLegend
      ? { textStyle: { color: palette.text }, top: titleOffset }
      : { show: false },
    grid: gridFor(hasLegend),
    tooltip: { trigger: "item" },
  };

  const catAxis = { type: "category", data: categories, ...catAxisStyle };
  const valAxis = { type: "value", ...valueAxisStyle(fmt) };

  const valueLabel = (position: "top" | "right"): Record<string, unknown> =>
    showValueLabels
      ? {
          label: {
            show: true,
            position,
            color: palette.text,
            fontSize: 12,
            formatter: (p: { value?: unknown }) => fmt(toNumber(p.value)),
          },
        }
      : {};

  // Per-item accent/neutral styling for single-series category charts.
  const focusItem = (i: number, value: number): Record<string, unknown> => ({
    value,
    itemStyle: { color: i === focusCat ? palette.accent : neutral },
    label: {
      color: i === focusCat ? palette.heading : `${palette.text}99`,
      ...(i === focusCat ? { fontWeight: 600 } : {}),
    },
  });

  // ---- Small multiples ---------------------------------------------------
  if (facet) {
    const n = series.length;
    const cols = n <= 3 ? n : Math.ceil(n / 2);
    const rowCount = n <= 3 ? 1 : 2;
    const allVals = rows.flatMap((r) => series.map((s) => toNumber(r[s])));
    const gMax = Math.max(...allVals, 0);
    const gMin = Math.min(...allVals, 0);
    // Shared scale on EVERY panel — small multiples are only honest when
    // panels are directly comparable.
    const yMax = niceMax(gMax * 1.1);
    const yMin = gMin < 0 ? Math.floor(gMin * 1.1) : 0;

    const topPct = title || unitText ? 14 : 6;
    const bottomPct = source ? 10 : 6;
    const leftPct = 7; // gutter for panel-0 y labels
    const rightPct = 2;
    const gapX = 4;
    const titleH = 6; // per-panel title strip
    const gapY = 8;
    const colW = (100 - leftPct - rightPct - gapX * (cols - 1)) / cols;
    const rowH = (100 - topPct - bottomPct - gapY * (rowCount - 1)) / rowCount;

    const grids: Array<Record<string, unknown>> = [];
    const xAxes: Array<Record<string, unknown>> = [];
    const yAxes: Array<Record<string, unknown>> = [];
    const panelTitles: Array<Record<string, unknown>> = [];
    const facetSeries: Array<Record<string, unknown>> = [];

    series.forEach((s, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const left = leftPct + c * (colW + gapX);
      const top = topPct + r * (rowH + gapY) + titleH;
      grids.push({
        left: `${left}%`,
        top: `${top}%`,
        width: `${colW}%`,
        height: `${rowH - titleH}%`,
      });
      panelTitles.push({
        text: s,
        left: `${left}%`,
        top: `${top - titleH}%`,
        textStyle: {
          color: palette.heading,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
        },
      });
      xAxes.push({
        gridIndex: i,
        type: "category",
        data: categories,
        axisLabel: {
          color: palette.text,
          fontSize: 10,
          hideOverlap: true,
          // x labels only under the bottom panel of each column.
          show: i + cols >= n,
        },
        axisLine: { lineStyle: { color: `${palette.text}55` } },
        axisTick: { show: false },
        splitLine: { show: false },
      });
      yAxes.push({
        gridIndex: i,
        type: "value",
        max: yMax,
        min: yMin,
        splitNumber: 3,
        axisLabel: {
          color: palette.text,
          fontSize: 10,
          formatter: fmt,
          show: i === 0, // y labels only on panel 0 — the scale is shared.
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: `${palette.text}14`, width: 1 } },
      });
      facetSeries.push(
        kind === "bar"
          ? {
              name: s,
              type: "bar",
              xAxisIndex: i,
              yAxisIndex: i,
              barMaxWidth: 22,
              itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
              data: rows.map((r2) => toNumber(r2[s])),
            }
          : {
              name: s,
              type: "line",
              xAxisIndex: i,
              yAxisIndex: i,
              smooth: true,
              symbol: "none",
              color: palette.accent,
              lineStyle: { width: 2 },
              areaStyle: { color: palette.accent, opacity: 0.14 },
              data: rows.map((r2) => toNumber(r2[s])),
            },
      );
    });

    return {
      color: palette.series,
      textStyle: { color: palette.text, fontFamily: "inherit" },
      title: [...titleEntries, ...panelTitles],
      legend: { show: false },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      tooltip: { trigger: "item" },
      series: facetSeries,
    };
  }

  // ---- Per-kind option ---------------------------------------------------
  const option = ((): Record<string, unknown> => {
    switch (kind) {
      case "pie":
      case "donut": {
        const valueField = series[0] ?? "value";
        return {
          ...base,
          series: [
            {
              type: "pie",
              radius: kind === "donut" ? ["45%", "72%"] : "72%",
              center: ["50%", title ? "55%" : "50%"],
              data: rows.map((r, i) => ({
                name: String(r[category] ?? ""),
                value: toNumber(r[valueField]),
                // Focused slice keeps full color; the rest recede.
                ...(focusCat >= 0 && i !== focusCat
                  ? { itemStyle: { opacity: 0.4 } }
                  : {}),
              })),
              label: { color: palette.text, fontSize: 13 },
              labelLine: { lineStyle: { color: `${palette.text}66` } },
            },
          ],
        };
      }
      case "line":
      case "area": {
        const multi = series.length > 1;
        const focusMode = multi && focusSeries >= 0;
        // Direct end-of-line labels replace the legend whenever they fit.
        const endLabels = multi && (focusMode || series.length <= 4);
        const labelNames = focusMode ? [series[focusSeries]] : series;
        const maxName = Math.max(...labelNames.map((s) => s.length), 0);
        const endPad = Math.min(140, Math.max(48, maxName * 7 + 16));
        return {
          ...base,
          ...(endLabels
            ? { legend: { show: false }, grid: { ...gridFor(false), right: endPad } }
            : {}),
          xAxis: catAxis,
          yAxis: valAxis,
          series: series.map((s, i) => {
            const focused = focusMode && i === focusSeries;
            const mutedLine = focusMode && !focused;
            return {
              name: s,
              type: "line",
              smooth: true,
              ...(focused
                ? {
                    color: palette.accent,
                    symbol: "circle",
                    symbolSize: 7,
                    lineStyle: { width: 3 },
                    z: 3,
                  }
                : mutedLine
                  ? {
                      color: `${palette.text}30`,
                      symbol: "none",
                      lineStyle: { width: 1.5 },
                      z: 2,
                    }
                  : { symbolSize: 7, lineStyle: { width: 3 } }),
              ...(kind === "area"
                ? { areaStyle: { opacity: mutedLine ? 0.06 : 0.25 } }
                : {}),
              ...(endLabels && !mutedLine
                ? {
                    endLabel: {
                      show: true,
                      distance: 8,
                      fontSize: 12,
                      formatter: () => s,
                      ...(focused
                        ? { color: palette.heading, fontWeight: 600 }
                        : { color: "inherit", fontWeight: 500 }),
                    },
                  }
                : {}),
              ...(mutedLine ? {} : valueLabel("top")),
              data: rows.map((r) => toNumber(r[s])),
            };
          }),
        };
      }
      case "slope": {
        // Two points in time, one line per row — ranking shifts at a glance.
        if (series.length !== 2) break;
        const [colA, colB] = series;
        const maxName = Math.max(...categories.map((c) => c.length), 0);
        const pad = Math.min(180, Math.max(64, maxName * 7 + 40));
        return {
          ...base,
          legend: { show: false },
          grid: { ...gridFor(false), left: pad, right: pad },
          xAxis: {
            type: "category",
            data: [colA, colB],
            boundaryGap: true,
            axisLabel: { color: palette.text, fontSize: 12, fontWeight: 600 },
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
          },
          yAxis: { type: "value", show: false, scale: true },
          series: rows.map((r, i) => {
            const a = toNumber(r[colA]);
            const b = toNumber(r[colB]);
            const focused = i === focusCat;
            const labelStyle = focused
              ? { color: palette.heading, fontWeight: 600 }
              : { color: `${palette.text}aa` };
            return {
              name: categories[i] || `#${i + 1}`,
              type: "line",
              smooth: false,
              symbol: "circle",
              symbolSize: focused ? 8 : 6,
              color: focused ? palette.accent : `${palette.text}38`,
              lineStyle: { width: focused ? 3 : 1.5 },
              z: focused ? 3 : 2,
              data: [
                {
                  value: a,
                  label: {
                    show: true,
                    position: "left",
                    fontSize: 12,
                    formatter: () => `${categories[i]} ${fmt(a)}`,
                    ...labelStyle,
                  },
                },
                {
                  value: b,
                  label: {
                    show: true,
                    position: "right",
                    fontSize: 12,
                    formatter: () => `${fmt(b)} ${categories[i]}`,
                    ...labelStyle,
                  },
                },
              ],
            };
          }),
        };
      }
      case "lollipop": {
        // Thin stem + dot: a bar chart with less ink.
        const valueField = series[0] ?? "value";
        return {
          ...base,
          legend: { show: false },
          grid: gridFor(false),
          xAxis: catAxis,
          yAxis: valAxis,
          series: [
            {
              name: valueField,
              type: "bar",
              barWidth: 2,
              silent: true,
              z: 1,
              itemStyle: { color: `${palette.text}44` },
              tooltip: { show: false },
              data: rows.map((r) => toNumber(r[valueField])),
            },
            {
              name: valueField,
              type: "scatter",
              symbolSize: 14,
              z: 2,
              ...valueLabel("top"),
              data: rows.map((r, i) => focusItem(i, toNumber(r[valueField]))),
            },
          ],
        };
      }
      case "dumbbell": {
        // Before/after per category: connecting line + two dots, horizontal.
        if (series.length < 2) break;
        const [colA, colB] = series;
        const pts = rows.map((r, i) => [i, toNumber(r[colA]), toNumber(r[colB])]);
        return {
          ...base,
          legend: { show: false },
          grid: { ...gridFor(false), right: 64 },
          xAxis: { type: "value", ...valueAxisStyle(fmt) },
          yAxis: { type: "category", data: categories, ...catAxisStyle },
          series: [
            {
              name: `${colA} → ${colB}`,
              type: "custom",
              encode: { x: [1, 2], y: 0 },
              tooltip: {
                formatter: (p: { value?: unknown }) => {
                  const v = Array.isArray(p.value) ? (p.value as number[]) : [];
                  return `${categories[v[0] ?? 0] ?? ""}: ${fmt(v[1] ?? 0)} → ${fmt(v[2] ?? 0)}`;
                },
              },
              renderItem: (
                params: unknown,
                api: {
                  value: (i: number) => number;
                  coord: (v: number[]) => number[];
                },
              ) => {
                const rowIdx = api.value(0);
                const v1 = api.value(1);
                const v2 = api.value(2);
                const p1 = api.coord([v1, rowIdx]);
                const p2 = api.coord([v2, rowIdx]);
                const xRight = Math.max(p1[0], p2[0]);
                // Fixed offsets only — this also runs in headless SVG export.
                return {
                  type: "group",
                  children: [
                    {
                      type: "line",
                      shape: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] },
                      style: { stroke: `${palette.text}44`, lineWidth: 2 },
                    },
                    {
                      type: "circle",
                      shape: { cx: p1[0], cy: p1[1], r: 6 },
                      style: { fill: `${palette.text}55` },
                    },
                    {
                      type: "circle",
                      shape: { cx: p2[0], cy: p2[1], r: 7 },
                      style: { fill: palette.accent },
                    },
                    {
                      type: "text",
                      style: {
                        text: fmt(v2),
                        x: xRight + 12,
                        y: p1[1],
                        fill: palette.text,
                        fontSize: 12,
                        textVerticalAlign: "middle",
                      },
                    },
                  ],
                };
              },
              data: pts,
            },
          ],
        };
      }
      case "range-bar": {
        // Horizontal floating bars between low and high.
        const lo = byLower.get("low");
        const hi = byLower.get("high");
        if (!lo || !hi) break; // → horizontal bar fallback
        const spans = rows.map((r) => {
          const a = toNumber(r[lo]);
          const b = toNumber(r[hi]);
          return { low: Math.min(a, b), high: Math.max(a, b) };
        });
        const rangeText = (i: number): string => {
          const s = spans[i];
          return s ? `${fmt(s.low)}–${fmt(s.high)}` : "";
        };
        return {
          ...base,
          legend: { show: false },
          grid: { ...gridFor(false), right: 84 },
          xAxis: { type: "value", ...valueAxisStyle(fmt) },
          yAxis: { type: "category", data: categories, ...catAxisStyle },
          series: [
            {
              name: "base",
              type: "bar",
              stack: "range",
              silent: true,
              barMaxWidth: 18,
              itemStyle: { color: "transparent" },
              emphasis: { itemStyle: { color: "transparent" } },
              tooltip: { show: false },
              data: spans.map((s) => s.low),
            },
            {
              name: `${lo}–${hi}`,
              type: "bar",
              stack: "range",
              barMaxWidth: 18,
              itemStyle: { color: `${palette.accent}cc`, borderRadius: 4 },
              label: {
                show: true,
                position: "right",
                color: palette.text,
                fontSize: 12,
                formatter: (p: { dataIndex?: number }) =>
                  rangeText(p.dataIndex ?? 0),
              },
              tooltip: {
                formatter: (p: { dataIndex?: number }) =>
                  `${categories[p.dataIndex ?? 0] ?? ""}: ${rangeText(p.dataIndex ?? 0)}`,
              },
              data: spans.map((s) => s.high - s.low),
            },
          ],
        };
      }
      case "range-area": {
        // Band between low and high, with an optional mid line.
        const lo = byLower.get("low");
        const hi = byLower.get("high");
        if (!lo || !hi) break; // → vertical bar fallback
        const mid = byLower.get("mid") ?? byLower.get("median");
        const lows = rows.map((r) => toNumber(r[lo]));
        const highs = rows.map((r) => toNumber(r[hi]));
        return {
          ...base,
          legend: { show: false },
          grid: gridFor(false),
          xAxis: catAxis,
          yAxis: { ...valAxis, scale: true },
          series: [
            {
              name: lo,
              type: "line",
              stack: "range",
              smooth: true,
              symbol: "none",
              silent: true,
              lineStyle: { opacity: 0 },
              tooltip: { show: false },
              data: lows,
            },
            {
              name: `${lo}–${hi}`,
              type: "line",
              stack: "range",
              smooth: true,
              symbol: "none",
              lineStyle: { opacity: 0 },
              areaStyle: { color: palette.accent, opacity: 0.18 },
              tooltip: {
                formatter: (p: { dataIndex?: number }) => {
                  const i = p.dataIndex ?? 0;
                  return `${categories[i] ?? ""}: ${fmt(lows[i] ?? 0)}–${fmt(highs[i] ?? 0)}`;
                },
              },
              data: highs.map((h, i) => Math.max(0, h - (lows[i] ?? 0))),
            },
            ...(mid
              ? [
                  {
                    name: mid,
                    type: "line",
                    smooth: true,
                    symbol: "none",
                    color: palette.accent,
                    lineStyle: { width: 2.5 },
                    z: 3,
                    data: rows.map((r) => toNumber(r[mid])),
                  },
                ]
              : []),
          ],
        };
      }
      case "scatter":
      case "bubble": {
        const fields = fieldNames(rows);
        const x = fields[0];
        const y = fields[1] ?? fields[0];
        const z = fields[2];
        return {
          ...base,
          xAxis: { type: "value", ...valueAxisStyle() },
          yAxis: valAxis,
          series: [
            {
              type: "scatter",
              symbolSize: z
                ? (v: number[]) => Math.max(8, Math.min(40, v[2]))
                : 12,
              data: rows.map((r) =>
                z
                  ? [toNumber(r[x]), toNumber(r[y]), toNumber(r[z])]
                  : [toNumber(r[x]), toNumber(r[y])],
              ),
            },
          ],
        };
      }
      case "radar": {
        const max = Math.max(
          ...rows.flatMap((r) => series.map((s) => toNumber(r[s]))),
          1,
        );
        return {
          ...base,
          radar: {
            indicator: categories.map((c) => ({ name: c, max: max * 1.15 })),
            axisName: { color: palette.text },
            splitLine: { lineStyle: { color: `${palette.text}33` } },
            splitArea: { show: false },
          },
          series: [
            {
              type: "radar",
              data: series.map((s) => ({
                name: s,
                value: rows.map((r) => toNumber(r[s])),
                areaStyle: { opacity: 0.2 },
              })),
            },
          ],
        };
      }
      case "funnel":
      case "cone-funnel":
      case "pyramid": {
        const valueField = series[0] ?? "value";
        return {
          ...base,
          series: [
            {
              type: "funnel",
              sort: kind === "pyramid" ? "ascending" : "descending",
              label: { color: palette.text, position: "inside" },
              data: rows.map((r) => ({
                name: String(r[category] ?? ""),
                value: toNumber(r[valueField]),
              })),
            },
          ],
        };
      }
      case "radial-gauge":
      case "linear-gauge": {
        const valueField = series[0] ?? "value";
        const v = toNumber(rows[0]?.[valueField]);
        return {
          ...base,
          series: [
            {
              type: "gauge",
              progress: { show: true, width: 14 },
              axisLine: {
                lineStyle: { width: 14, color: [[1, `${palette.text}22`]] },
              },
              axisTick: { show: false },
              splitLine: { show: false },
              axisLabel: { show: false },
              pointer: { show: kind === "radial-gauge" },
              detail: {
                color: palette.heading,
                fontSize: 34,
                formatter: fmt,
              },
              data: [{ value: v }],
            },
          ],
        };
      }
      case "heatmap": {
        const fields = fieldNames(rows);
        const [xf, yf, vf] = [fields[0], fields[1], fields[2] ?? "value"];
        const xs = [...new Set(rows.map((r) => String(r[xf])))];
        const ys = [...new Set(rows.map((r) => String(r[yf])))];
        const values = rows.map((r) => toNumber(r[vf]));
        const heatFmt = makeValueFormatter(detectUnitFormat(rows, vf), compact);
        return {
          ...base,
          xAxis: { type: "category", data: xs, ...catAxisStyle },
          yAxis: { type: "category", data: ys, ...catAxisStyle },
          visualMap: {
            min: Math.min(...values, 0),
            max: Math.max(...values, 1),
            show: false,
            inRange: { color: [`${palette.accent}22`, palette.accent] },
          },
          series: [
            {
              type: "heatmap",
              data: rows.map((r) => [
                xs.indexOf(String(r[xf])),
                ys.indexOf(String(r[yf])),
                toNumber(r[vf]),
              ]),
              label: {
                show: true,
                color: palette.text,
                formatter: (p: { value?: unknown }) => {
                  const cell = p.value;
                  return heatFmt(Array.isArray(cell) ? cell[2] : cell);
                },
              },
            },
          ],
        };
      }
      case "waterfall": {
        const valueField = series[0] ?? "value";
        let cum = 0;
        const baseData: number[] = [];
        const riseData: Array<Record<string, unknown>> = [];
        for (const r of rows) {
          const v = toNumber(r[valueField]);
          baseData.push(v >= 0 ? cum : cum + v);
          riseData.push({
            value: Math.abs(v),
            real: v,
            ...(v < 0
              ? { itemStyle: { color: palette.accent, opacity: 0.55 } }
              : {}),
          });
          cum += v;
        }
        return {
          ...base,
          legend: { show: false },
          grid: gridFor(false),
          xAxis: catAxis,
          yAxis: valAxis,
          series: [
            {
              name: "base",
              type: "bar",
              stack: "waterfall",
              silent: true,
              itemStyle: { color: "transparent" },
              emphasis: { itemStyle: { color: "transparent" } },
              tooltip: { show: false },
              data: baseData,
            },
            {
              name: valueField,
              type: "bar",
              stack: "waterfall",
              barMaxWidth: 46,
              itemStyle: { borderRadius: [4, 4, 0, 0] },
              ...(showValueLabels
                ? {
                    label: {
                      show: true,
                      position: "top",
                      color: palette.text,
                      fontSize: 12,
                      formatter: (p: { data?: unknown }) =>
                        fmt((p.data as { real?: number } | undefined)?.real ?? 0),
                    },
                  }
                : {}),
              data: riseData,
            },
          ],
        };
      }
      case "treemap": {
        const valueField = series[0] ?? "value";
        return {
          ...base,
          legend: { show: false },
          series: [
            {
              type: "treemap",
              left: 4,
              right: 4,
              top: titleOffset + 4,
              bottom: 4,
              roam: false,
              nodeClick: false,
              breadcrumb: { show: false },
              label: { show: true, fontSize: 13 },
              itemStyle: { gapWidth: 3, borderColor: "transparent" },
              data: rows.map((r) => ({
                name: String(r[category] ?? ""),
                value: toNumber(r[valueField]),
              })),
            },
          ],
        };
      }
      case "sunburst": {
        const valueField = series[0] ?? "value";
        return {
          ...base,
          legend: { show: false },
          series: [
            {
              type: "sunburst",
              radius: ["22%", "82%"],
              center: ["50%", title ? "55%" : "50%"],
              nodeClick: false,
              label: {
                color: palette.text,
                fontSize: 12,
                rotate: "radial",
                minAngle: 12,
              },
              itemStyle: { borderColor: "transparent", borderWidth: 2 },
              data: rows.map((r) => ({
                name: String(r[category] ?? ""),
                value: toNumber(r[valueField]),
              })),
            },
          ],
        };
      }
      case "composed":
        return {
          ...base,
          xAxis: catAxis,
          yAxis: valAxis,
          series: series.map((s, i) =>
            i === 0
              ? {
                  name: s,
                  type: "bar",
                  barMaxWidth: 46,
                  itemStyle: { borderRadius: [6, 6, 0, 0] },
                  ...valueLabel("top"),
                  data: rows.map((r) => toNumber(r[s])),
                }
              : {
                  name: s,
                  type: "line",
                  smooth: true,
                  symbolSize: 7,
                  lineStyle: { width: 3 },
                  ...valueLabel("top"),
                  data: rows.map((r) => toNumber(r[s])),
                },
          ),
        };
      case "histogram":
        return {
          ...base,
          xAxis: catAxis,
          yAxis: valAxis,
          series: (series.length ? series : ["value"]).map((s) => ({
            name: s,
            type: "bar",
            barCategoryGap: "0%",
            barGap: "0%",
            itemStyle: {
              borderRadius: [3, 3, 0, 0],
              borderWidth: 1,
              borderColor: `${palette.text}22`,
            },
            ...valueLabel("top"),
            data: rows.map((r) => toNumber(r[s])),
          })),
        };
      case "nightingale": {
        const valueField = series[0] ?? "value";
        return {
          ...base,
          legend: { show: false },
          series: [
            {
              type: "pie",
              roseType: "area",
              radius: ["12%", "72%"],
              center: ["50%", title ? "55%" : "50%"],
              itemStyle: { borderRadius: 5 },
              data: rows.map((r) => ({
                name: String(r[category] ?? ""),
                value: toNumber(r[valueField]),
              })),
              label: { color: palette.text, fontSize: 13 },
              labelLine: { lineStyle: { color: `${palette.text}66` } },
            },
          ],
        };
      }
      case "candlestick":
      case "ohlc": {
        const open = byLower.get("open");
        const close = byLower.get("close");
        const low = byLower.get("low");
        const high = byLower.get("high");
        if (!open || !close || !low || !high) break; // → bar fallback
        return {
          ...base,
          legend: { show: false },
          grid: gridFor(false),
          xAxis: catAxis,
          yAxis: { ...valAxis, scale: true },
          series: [
            {
              type: "candlestick",
              barMaxWidth: 22,
              itemStyle: {
                color: palette.accent,
                borderColor: palette.accent,
                color0: `${palette.text}55`,
                borderColor0: `${palette.text}99`,
                // OHLC reads as hollow candles.
                ...(kind === "ohlc"
                  ? { color: "transparent", color0: "transparent" }
                  : {}),
              },
              data: rows.map((r) => [
                toNumber(r[open]),
                toNumber(r[close]),
                toNumber(r[low]),
                toNumber(r[high]),
              ]),
            },
          ],
        };
      }
      case "box-plot": {
        const named = ["min", "q1", "median", "q3", "max"].map((k) =>
          byLower.get(k),
        );
        const hasNamed = named.every(Boolean);
        const data = rows.map((r) => {
          if (hasNamed) {
            return (named as string[]).map((f) => toNumber(r[f]));
          }
          // Five-number summary computed from the row's numeric columns.
          const sorted = series.map((s) => toNumber(r[s])).sort((a, b) => a - b);
          return [
            sorted[0] ?? 0,
            quantileSorted(sorted, 0.25),
            quantileSorted(sorted, 0.5),
            quantileSorted(sorted, 0.75),
            sorted[sorted.length - 1] ?? 0,
          ];
        });
        return {
          ...base,
          legend: { show: false },
          grid: gridFor(false),
          xAxis: catAxis,
          yAxis: { ...valAxis, scale: true },
          series: [
            {
              type: "boxplot",
              itemStyle: {
                color: `${palette.accent}33`,
                borderColor: palette.accent,
                borderWidth: 2,
              },
              data,
            },
          ],
        };
      }
      case "radial-column": {
        // Polar bars: categories around the angle axis, values radiate out.
        const valueField = series[0] ?? "value";
        return {
          ...base,
          legend: { show: false },
          polar: {
            radius: ["16%", "78%"],
            center: ["50%", title ? "55%" : "50%"],
          },
          angleAxis: {
            type: "category",
            data: categories,
            axisLabel: { color: palette.text, fontSize: 12 },
            axisLine: { lineStyle: { color: `${palette.text}33` } },
            splitLine: { show: false },
          },
          radiusAxis: {
            type: "value",
            axisLabel: { show: false },
            axisLine: { show: false },
            splitLine: { lineStyle: { color: `${palette.text}1a` } },
          },
          series: [
            {
              type: "bar",
              coordinateSystem: "polar",
              barMaxWidth: 30,
              itemStyle: { borderRadius: 4 },
              data: rows.map((r) => toNumber(r[valueField])),
            },
          ],
        };
      }
      case "radial-bar": {
        // Concentric arc bars: one ring per category.
        const valueField = series[0] ?? "value";
        return {
          ...base,
          legend: { show: false },
          polar: {
            radius: ["24%", "82%"],
            center: ["50%", title ? "55%" : "50%"],
          },
          angleAxis: {
            type: "value",
            startAngle: 90,
            axisLabel: { show: false },
            axisLine: { show: false },
            splitLine: { lineStyle: { color: `${palette.text}14` } },
          },
          radiusAxis: {
            type: "category",
            data: categories,
            axisLabel: { color: palette.text, fontSize: 12 },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          series: [
            {
              type: "bar",
              coordinateSystem: "polar",
              barCategoryGap: "35%",
              itemStyle: { borderRadius: 6 },
              data: rows.map((r) => toNumber(r[valueField])),
            },
          ],
        };
      }
      case "sankey": {
        const src = byLower.get("source") ?? byLower.get("from");
        const tgt = byLower.get("target") ?? byLower.get("to");
        const val =
          byLower.get("value") ?? byLower.get("size") ?? byLower.get("weight");
        if (!src || !tgt || !val) break; // → bar fallback
        const links = rows.map((r) => ({
          source: String(r[src] ?? ""),
          target: String(r[tgt] ?? ""),
          value: toNumber(r[val]),
        }));
        const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
        return {
          ...base,
          legend: { show: false },
          series: [
            {
              type: "sankey",
              left: 8,
              right: 48,
              top: titleOffset + 8,
              bottom: 8,
              nodeGap: 12,
              layoutIterations: 32,
              label: { color: palette.text, fontSize: 12 },
              lineStyle: { color: "gradient", opacity: 0.35 },
              itemStyle: { borderWidth: 0 },
              emphasis: { focus: "adjacency" },
              data: names.map((name) => ({ name })),
              links,
            },
          ],
        };
      }
    }

    // Everything else renders as (possibly horizontal) bars — an honest,
    // readable default for uncommon chart types, and the graceful landing for
    // typed charts whose expected columns are missing (candlestick/sankey/
    // range-bar/range-area/slope/dumbbell).
    const horizontal = kind === "range-bar" || kind === "dumbbell";
    const singleSeries = series.length <= 1;
    return {
      ...base,
      xAxis: horizontal ? valAxis : catAxis,
      yAxis: horizontal ? catAxis : valAxis,
      series: (series.length ? series : ["value"]).map((s) => ({
        name: s,
        type: "bar",
        barMaxWidth: 46,
        itemStyle: { borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] },
        ...valueLabel(horizontal ? "right" : "top"),
        // Start with gray: single-series bars are neutral; the accent is
        // spent only on the focused category. Multi-series keeps the palette.
        data: rows.map((r, i) =>
          singleSeries ? focusItem(i, toNumber(r[s])) : toNumber(r[s]),
        ),
      })),
    };
  })();

  // ---- Annotation layer --------------------------------------------------
  const seriesArr = Array.isArray(option.series)
    ? (option.series as Array<Record<string, unknown>>)
    : [];
  const last = seriesArr[seriesArr.length - 1];
  if (last && positional) {
    // Forecast band across the flagged categories.
    if (forecastIdxs.length) {
      const from = categories[forecastIdxs[0]];
      const to = categories[forecastIdxs[forecastIdxs.length - 1]];
      last.markArea = {
        silent: true,
        itemStyle: { color: `${palette.text}0f` },
        label: {
          show: true,
          position: "insideTop",
          color: `${palette.text}99`,
          fontSize: 10,
        },
        data: [[{ name: "Forecast", xAxis: from }, { xAxis: to }]],
      };
    }
    // Reference lines: dashed average + solid accent target. One markLine on
    // the LAST series only, so multi-series charts never duplicate lines.
    const lines: Array<Record<string, unknown>> = [];
    if (seriesAnnot && isTruthyFlag(opts.avg)) {
      lines.push({
        type: "average",
        name: "Avg",
        lineStyle: { type: "dashed", color: `${palette.text}66`, width: 1 },
        label: {
          show: true,
          position: "insideEndTop",
          fontSize: 11,
          color: `${palette.text}aa`,
          formatter: (p: { value?: unknown }) => `Avg ${fmt(p.value)}`,
        },
      });
    }
    const rawTarget = opts.target;
    const targetV =
      typeof rawTarget === "number"
        ? rawTarget
        : rawTarget !== undefined && /\d/.test(String(rawTarget))
          ? toNumber(rawTarget)
          : undefined;
    if (targetV !== undefined && Number.isFinite(targetV)) {
      lines.push({
        yAxis: targetV,
        lineStyle: { type: "solid", color: palette.accent, width: 1.5 },
        label: {
          show: true,
          position: "insideEndTop",
          fontSize: 11,
          fontWeight: 600,
          color: palette.accent,
          formatter: () => `Target ${fmt(targetV)}`,
        },
      });
    }
    if (lines.length) {
      last.markLine = { silent: true, symbol: "none", data: lines };
    }
    // Callout: never more than ONE annotated point.
    const callout = (opts.callout ?? "").trim();
    if (seriesAnnot && callout) {
      const m = /^(min|max)\s*:\s*(.*)$/i.exec(callout);
      const pointType = m ? m[1].toLowerCase() : "max";
      const text = (m ? m[2] : callout).trim() || (pointType === "min" ? "Low" : "Peak");
      last.markPoint = {
        silent: true,
        symbol: "circle",
        symbolSize: 9,
        itemStyle: {
          color: palette.accent,
          borderColor: "#ffffff",
          borderWidth: 2,
        },
        label: {
          show: true,
          position: "top",
          distance: 10,
          formatter: () => text,
          color: palette.heading,
          fontSize: 12,
          fontWeight: 600,
          backgroundColor: chipBg,
          borderRadius: 6,
          padding: [4, 8],
        },
        data: [{ type: pointType }],
      };
    }
  }
  return option;
}
