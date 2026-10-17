"use client";

import { createContext } from "react";

/**
 * True on a page that is captured rather than looked at — the print route
 * the PDF, PowerPoint and Word exports are made from. Charts there draw
 * their final frame at once.
 *
 * ECharts animates a chart in over about a second, and the exporter waits
 * for each chart's SVG to exist, not for its animation to end. A slope
 * chart's lines were still moving when the PDF was taken, so two exports of
 * one deck differed (measured: the SVG changed at 100, 500 and 1,000ms and
 * was identical across runs from 2s on), and a chart PowerPoint takes as a
 * picture could be caught half drawn. The editor and present mode keep the
 * animation.
 *
 * A module of its own so the print view can provide it without loading
 * ECharts, which the chart element imports.
 */
export const StaticChartsContext = createContext(false);
