"use client";

/**
 * Client ECharts renderer for chart-* nodes. Colors come from the resolved
 * theme via context so charts restyle with the deck.
 */
import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { TElement } from "@/lib/slides/plate-shim";
import { useSlideTheme } from "@/components/slides/theme-scope";
import {
  buildChartOption,
  paletteFromColors,
} from "@/lib/charts/build-option";

export function ChartElement({ node }: { node: TElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useSlideTheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "svg" });
    const rows = Array.isArray(node.data)
      ? (node.data as Array<Record<string, string | number>>)
      : [];
    const title =
      typeof node.chartTitle === "string" && node.chartTitle.trim()
        ? node.chartTitle
        : typeof node.title === "string"
          ? node.title
          : undefined;
    // The parser spreads XML attributes onto the node, so premium chart
    // attrs (focus/target/avg/callout/source/unit/facet) arrive here as-is.
    const str = (v: unknown): string | undefined =>
      typeof v === "string" ? v : undefined;
    const option = buildChartOption(
      String(node.type),
      rows,
      paletteFromColors(theme.colors),
      {
        title,
        numberFormat: str(node.numberFormat),
        focus:
          typeof node.focus === "string" || typeof node.focus === "number"
            ? node.focus
            : undefined,
        target:
          typeof node.target === "string" || typeof node.target === "number"
            ? node.target
            : undefined,
        avg:
          typeof node.avg === "string" || typeof node.avg === "boolean"
            ? node.avg
            : undefined,
        callout: str(node.callout),
        source: str(node.source),
        unit: str(node.unit),
        facet:
          typeof node.facet === "string" || typeof node.facet === "boolean"
            ? node.facet
            : undefined,
      },
    );
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [node, theme]);

  return <div ref={ref} className="v-chart" />;
}
