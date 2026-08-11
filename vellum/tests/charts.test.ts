import { describe, expect, it } from "vitest";
import {
  FORECAST_SUFFIX_RE,
  SUPPORTED_CHART_TYPES,
  buildChartOption,
  detectUnitFormat,
  makeValueFormatter,
  paletteFromColors,
} from "@/lib/charts/build-option";

type AnyRec = Record<string, unknown>;

const palette = paletteFromColors({
  text: "#333333",
  heading: "#111111",
  accent: "#0055FF",
  background: "#FAFAF7",
});

const seriesOf = (o: AnyRec) => o.series as AnyRec[];

const rows3 = [
  { label: "Alpha", value: 10 },
  { label: "Beta", value: 24 },
  { label: "Gamma", value: 17 },
];

describe("unit format", () => {
  it("detects currency prefixes and %/magnitude suffixes", () => {
    expect(detectUnitFormat([{ label: "a", value: "$1,200" }], "value")).toEqual(
      { prefix: "$", suffix: "" },
    );
    expect(detectUnitFormat([{ label: "a", value: "85%" }], "value")).toEqual({
      prefix: "",
      suffix: "%",
    });
    expect(detectUnitFormat([{ label: "a", value: "3.4M" }], "value")).toEqual({
      prefix: "",
      suffix: "M",
    });
    expect(detectUnitFormat([{ label: "a", value: "12k" }], "value")).toEqual({
      prefix: "",
      suffix: "k",
    });
    expect(detectUnitFormat([{ label: "a", value: 42 }], "value")).toEqual({
      prefix: "",
      suffix: "",
    });
  });

  it("re-applies units and compacts plain numbers", () => {
    expect(makeValueFormatter({ prefix: "$", suffix: "" }, false)(1200)).toBe(
      "$1200",
    );
    expect(makeValueFormatter({ prefix: "$", suffix: "" }, true)(12400)).toBe(
      "$12.4k",
    );
    expect(makeValueFormatter({ prefix: "", suffix: "%" }, true)(85)).toBe(
      "85%",
    );
  });
});

describe("focus", () => {
  it("focuses a bar by category label, case-insensitively", () => {
    const o = buildChartOption("chart-bar", rows3, palette, { focus: "beta" });
    const data = seriesOf(o)[0].data as AnyRec[];
    expect((data[1].itemStyle as AnyRec).color).toBe("#0055FF");
    expect((data[0].itemStyle as AnyRec).color).toBe("#33333355");
    expect((data[2].itemStyle as AnyRec).color).toBe("#33333355");
    expect((data[1].label as AnyRec).fontWeight).toBe(600);
    expect((data[1].label as AnyRec).color).toBe("#111111");
  });

  it("accepts a numeric row index as focus", () => {
    const o = buildChartOption("chart-bar", rows3, palette, { focus: "2" });
    const data = seriesOf(o)[0].data as AnyRec[];
    expect((data[2].itemStyle as AnyRec).color).toBe("#0055FF");
  });

  it("renders single-series bars all-neutral without focus", () => {
    const o = buildChartOption("chart-bar", rows3, palette);
    for (const d of seriesOf(o)[0].data as AnyRec[]) {
      expect((d.itemStyle as AnyRec).color).toBe("#33333355");
    }
  });

  it("keeps palette colors for multi-series bars", () => {
    const rows = [
      { q: "Q1", a: 1, b: 2 },
      { q: "Q2", a: 3, b: 4 },
    ];
    const o = buildChartOption("chart-bar", rows, palette);
    expect(seriesOf(o)).toHaveLength(2);
    expect(seriesOf(o)[0].data).toEqual([1, 3]);
  });

  it("focuses a line series by name and mutes the rest", () => {
    const rows = [
      { m: "Jan", Us: 4, Them: 9, Other: 5 },
      { m: "Feb", Us: 6, Them: 8, Other: 5 },
    ];
    const o = buildChartOption("chart-line", rows, palette, { focus: "us" });
    const s = seriesOf(o);
    expect(s[0].color).toBe("#0055FF");
    expect((s[0].lineStyle as AnyRec).width).toBe(3);
    expect(s[0].z).toBe(3);
    expect((s[0].endLabel as AnyRec).show).toBe(true);
    expect(s[1].color).toBe("#33333330");
    expect((s[1].lineStyle as AnyRec).width).toBe(1.5);
    expect(s[1].symbol).toBe("none");
    expect(s[1].endLabel).toBeUndefined();
    expect((o.legend as AnyRec).show).toBe(false);
  });

  it("fades non-focused pie slices to 40% opacity", () => {
    const o = buildChartOption("chart-pie", rows3, palette, { focus: "Gamma" });
    const data = seriesOf(o)[0].data as AnyRec[];
    expect((data[0].itemStyle as AnyRec).opacity).toBe(0.4);
    expect(data[2].itemStyle).toBeUndefined();
  });
});

describe("direct labeling", () => {
  it("replaces the legend with end labels for 2-4 series lines", () => {
    const rows = [
      { m: "Jan", a: 1, b: 2, c: 3 },
      { m: "Feb", a: 2, b: 3, c: 4 },
    ];
    const o = buildChartOption("chart-line", rows, palette);
    expect((o.legend as AnyRec).show).toBe(false);
    for (const s of seriesOf(o)) {
      expect((s.endLabel as AnyRec).show).toBe(true);
    }
  });

  it("keeps the legend for 5+ series lines", () => {
    const rows = [
      { m: "Jan", a: 1, b: 2, c: 3, d: 4, e: 5 },
      { m: "Feb", a: 2, b: 3, c: 4, d: 5, e: 6 },
    ];
    const o = buildChartOption("chart-line", rows, palette);
    expect((o.legend as AnyRec).show ?? true).toBe(true);
    for (const s of seriesOf(o)) expect(s.endLabel).toBeUndefined();
  });
});

describe("annotations", () => {
  it("attaches avg and target as one markLine on the last series only", () => {
    const rows = [
      { m: "Jan", a: 1, b: 2 },
      { m: "Feb", a: 2, b: 3 },
    ];
    const o = buildChartOption("chart-line", rows, palette, {
      avg: "true",
      target: "2.5",
    });
    const s = seriesOf(o);
    expect(s[0].markLine).toBeUndefined();
    const data = (s[1].markLine as AnyRec).data as AnyRec[];
    expect(data).toHaveLength(2);
    expect(data[0].type).toBe("average");
    expect((data[0].lineStyle as AnyRec).type).toBe("dashed");
    expect(data[1].yAxis).toBe(2.5);
    expect((data[1].lineStyle as AnyRec).color).toBe("#0055FF");
  });

  it("renders a single callout markPoint with chip styling", () => {
    const o = buildChartOption("chart-bar", rows3, palette, {
      callout: "min: Bottom",
    });
    const mp = seriesOf(o)[0].markPoint as AnyRec;
    const data = mp.data as AnyRec[];
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("min");
    const label = mp.label as AnyRec;
    expect((label.formatter as () => string)()).toBe("Bottom");
    expect(label.backgroundColor).toBe("#FAFAF7");
    expect(mp.symbolSize).toBe(9);
  });

  it("defaults bare callouts to the max point", () => {
    const o = buildChartOption("chart-bar", rows3, palette, {
      callout: "Peak quarter",
    });
    const mp = seriesOf(o)[0].markPoint as AnyRec;
    expect((mp.data as AnyRec[])[0].type).toBe("max");
    expect(((mp.label as AnyRec).formatter as () => string)()).toBe(
      "Peak quarter",
    );
  });

  it("skips annotations on non-cartesian charts", () => {
    const o = buildChartOption("chart-pie", rows3, palette, {
      avg: "true",
      target: 5,
      callout: "x",
    });
    expect(seriesOf(o)[0].markLine).toBeUndefined();
    expect(seriesOf(o)[0].markPoint).toBeUndefined();
  });
});

describe("forecast shading", () => {
  it("matches (f)/(e) and trailing F/E category markers", () => {
    for (const c of [
      "2025 (f)",
      "2025 (e)",
      "2025 (F)",
      "2025 (E)",
      "2025 F",
      "2025 E",
    ]) {
      expect(FORECAST_SUFFIX_RE.test(c)).toBe(true);
    }
    for (const c of ["2025", "Fine", "CAFE", "Estimate"]) {
      expect(FORECAST_SUFFIX_RE.test(c)).toBe(false);
    }
  });

  it("shades the forecast band and strips marker suffixes", () => {
    const rows = [
      { y: "2023", v: 10 },
      { y: "2024", v: 12 },
      { y: "2025 (f)", v: 14 },
      { y: "2026 F", v: 16 },
    ];
    const o = buildChartOption("chart-bar", rows, palette);
    expect((o.xAxis as AnyRec).data).toEqual(["2023", "2024", "2025", "2026"]);
    const ma = seriesOf(o)[0].markArea as AnyRec;
    const [pair] = ma.data as Array<AnyRec[]>;
    expect(pair[0].xAxis).toBe("2025");
    expect(pair[1].xAxis).toBe("2026");
    expect(pair[0].name).toBe("Forecast");
  });

  it("leaves plain categories untouched", () => {
    const o = buildChartOption("chart-bar", rows3, palette);
    expect(seriesOf(o)[0].markArea).toBeUndefined();
    expect((o.xAxis as AnyRec).data).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("unit subtitle and source line", () => {
  it("renders unit subtext and a bottom source credit", () => {
    const o = buildChartOption("chart-line", rows3, palette, {
      title: "Revenue",
      unit: "$m",
      source: "IMF, 2026",
    });
    const titles = o.title as AnyRec[];
    expect(titles).toHaveLength(2);
    expect(titles[0].subtext).toBe("$m");
    expect(titles[1].text).toBe("Source: IMF, 2026");
    expect((o.grid as AnyRec).bottom).toBe(22);
  });

  it("derives the unit from data only when a title exists", () => {
    const rows = [
      { label: "A", value: "$120" },
      { label: "B", value: "$140" },
    ];
    const titled = buildChartOption("chart-bar", rows, palette, {
      title: "Cost",
    });
    expect((titled.title as AnyRec[])[0].subtext).toBe("$");
    const untitled = buildChartOption("chart-bar", rows, palette);
    expect(untitled.title).toBeUndefined();
  });
});

describe("chart-slope", () => {
  const rows = [
    { region: "North", FY19: 10, FY24: 30 },
    { region: "South", FY19: 20, FY24: 12 },
  ];

  it("draws one line per row between the two period points", () => {
    const o = buildChartOption("chart-slope", rows, palette, {
      focus: "North",
    });
    const s = seriesOf(o);
    expect(s).toHaveLength(2);
    expect((o.xAxis as AnyRec).data).toEqual(["FY19", "FY24"]);
    expect((o.yAxis as AnyRec).show).toBe(false);
    expect((o.yAxis as AnyRec).scale).toBe(true);
    expect(s[0].color).toBe("#0055FF");
    expect(s[1].color).toBe("#33333338");
    const d = s[0].data as AnyRec[];
    expect((d[0].label as AnyRec).position).toBe("left");
    expect((d[1].label as AnyRec).position).toBe("right");
    expect(((d[0].label as AnyRec).formatter as () => string)()).toBe(
      "North 10",
    );
    expect(((d[1].label as AnyRec).formatter as () => string)()).toBe(
      "30 North",
    );
  });

  it("falls back to bars without exactly two value columns", () => {
    const o = buildChartOption(
      "chart-slope",
      [{ name: "A", a: 1, b: 2, c: 3 }],
      palette,
    );
    expect(seriesOf(o)[0].type).toBe("bar");
  });
});

describe("chart-lollipop", () => {
  it("pairs a thin stem with dots and puts annotations on the dots", () => {
    const o = buildChartOption("chart-lollipop", rows3, palette, { avg: true });
    const [stem, dots] = seriesOf(o);
    expect(stem.type).toBe("bar");
    expect(stem.barWidth).toBe(2);
    expect((stem.itemStyle as AnyRec).color).toBe("#33333344");
    expect(dots.type).toBe("scatter");
    expect(dots.symbolSize).toBe(14);
    expect(stem.markLine).toBeUndefined();
    expect((dots.markLine as AnyRec).data as AnyRec[]).toHaveLength(1);
  });

  it("spends accent only on the focused dot", () => {
    const o = buildChartOption("chart-lollipop", rows3, palette, {
      focus: "Beta",
    });
    const dots = seriesOf(o)[1].data as AnyRec[];
    expect((dots[1].itemStyle as AnyRec).color).toBe("#0055FF");
    expect((dots[0].itemStyle as AnyRec).color).toBe("#33333355");
  });
});

describe("chart-dumbbell", () => {
  it("renders a custom horizontal series with fixed-offset drawing", () => {
    const rows = [
      { dept: "Sales", before: 40, after: 62 },
      { dept: "Ops", before: 55, after: 58 },
    ];
    const o = buildChartOption("chart-dumbbell", rows, palette);
    const s = seriesOf(o)[0];
    expect(s.type).toBe("custom");
    expect((o.xAxis as AnyRec).type).toBe("value");
    expect((o.yAxis as AnyRec).type).toBe("category");
    const render = s.renderItem as (
      p: unknown,
      api: {
        value: (i: number) => number;
        coord: (v: number[]) => number[];
      },
    ) => AnyRec;
    const out = render(null, {
      value: (i) => [0, 40, 62][i],
      coord: ([x, y]) => [x * 2, y * 10 + 5],
    });
    const children = out.children as AnyRec[];
    expect(children).toHaveLength(4);
    expect((children[1].style as AnyRec).fill).toBe("#33333355");
    expect((children[2].style as AnyRec).fill).toBe("#0055FF");
    expect((children[3].style as AnyRec).text).toBe("62");
    expect((children[3].style as AnyRec).x).toBe(62 * 2 + 12);
  });
});

describe("chart-range-bar", () => {
  it("floats horizontal bars from low to high with range labels", () => {
    const rows = [
      { role: "Design", low: 80, high: 120 },
      { role: "Eng", low: 95, high: 150 },
    ];
    const o = buildChartOption("chart-range-bar", rows, palette);
    const [invisible, span] = seriesOf(o);
    expect((invisible.itemStyle as AnyRec).color).toBe("transparent");
    expect(invisible.silent).toBe(true);
    expect(invisible.data).toEqual([80, 95]);
    expect(span.data).toEqual([40, 55]);
    expect((span.itemStyle as AnyRec).color).toBe("#0055FFcc");
    const label = (span.label as AnyRec).formatter as (p: {
      dataIndex?: number;
    }) => string;
    expect(label({ dataIndex: 0 })).toBe("80–120");
    expect((o.yAxis as AnyRec).type).toBe("category");
  });

  it("degrades to horizontal bars when low/high are missing", () => {
    const o = buildChartOption("chart-range-bar", rows3, palette);
    const s = seriesOf(o);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("bar");
    expect((o.xAxis as AnyRec).type).toBe("value");
  });
});

describe("chart-range-area", () => {
  const rows = [
    { m: "Jan", low: 4, high: 9, mid: 6 },
    { m: "Feb", low: 5, high: 11, mid: 8 },
  ];

  it("builds base + band + mid line, banding at 18% accent", () => {
    const o = buildChartOption("chart-range-area", rows, palette);
    const s = seriesOf(o);
    expect(s).toHaveLength(3);
    expect(s[0].data).toEqual([4, 5]);
    expect(s[1].data).toEqual([5, 6]);
    expect((s[1].areaStyle as AnyRec).opacity).toBe(0.18);
    expect(s[2].data).toEqual([6, 8]);
    expect(s[2].color).toBe("#0055FF");
  });

  it("takes target lines but skips series-bound annotations", () => {
    const o = buildChartOption("chart-range-area", rows, palette, {
      target: 10,
    });
    const s = seriesOf(o);
    expect(s[2].markLine).toBeDefined();
    expect(s[0].markLine).toBeUndefined();
    const o2 = buildChartOption("chart-range-area", rows, palette, {
      avg: true,
      callout: "x",
    });
    expect(seriesOf(o2)[2].markLine).toBeUndefined();
    expect(seriesOf(o2)[2].markPoint).toBeUndefined();
  });
});

describe("small multiples", () => {
  it("splits 2-6 series into panels with one shared y max", () => {
    const rows = [
      { m: "Jan", a: 10, b: 20, c: 30 },
      { m: "Feb", a: 20, b: 10, c: 40 },
    ];
    const o = buildChartOption("chart-line", rows, palette, { facet: "true" });
    const grids = o.grid as AnyRec[];
    const yAxes = o.yAxis as AnyRec[];
    const s = seriesOf(o);
    expect(grids).toHaveLength(3);
    expect(yAxes).toHaveLength(3);
    const max = yAxes[0].max as number;
    expect(max).toBeGreaterThanOrEqual(40 * 1.1);
    for (const y of yAxes) expect(y.max).toBe(max);
    expect((yAxes[0].axisLabel as AnyRec).show).toBe(true);
    expect((yAxes[1].axisLabel as AnyRec).show).toBe(false);
    expect((o.legend as AnyRec).show).toBe(false);
    expect(s[2].xAxisIndex).toBe(2);
    expect((s[0].areaStyle as AnyRec).opacity).toBe(0.14);
    const titles = o.title as AnyRec[];
    expect(titles.map((t) => t.text)).toEqual(["a", "b", "c"]);
  });

  it("ignores facet beyond six series", () => {
    const wide = [
      { m: "Jan", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 },
      { m: "Feb", a: 2, b: 3, c: 4, d: 5, e: 6, f: 7, g: 8 },
    ];
    const o = buildChartOption("chart-line", wide, palette, { facet: "true" });
    expect(Array.isArray(o.grid)).toBe(false);
    expect((o.legend as AnyRec).show ?? true).toBe(true);
  });
});

describe("supported chart types", () => {
  it("includes the five premium additions and still excludes chord", () => {
    for (const t of [
      "chart-slope",
      "chart-lollipop",
      "chart-dumbbell",
      "chart-range-bar",
      "chart-range-area",
    ]) {
      expect(SUPPORTED_CHART_TYPES.has(t)).toBe(true);
    }
    expect(SUPPORTED_CHART_TYPES.has("chart-chord")).toBe(false);
    expect(SUPPORTED_CHART_TYPES.size).toBe(31);
  });
});

describe("robustness", () => {
  it("never throws on empty or one-row data for any supported type", () => {
    const fullOpts = {
      title: "T",
      numberFormat: "compact",
      focus: "A",
      target: "5",
      avg: "true",
      callout: "max: hi",
      source: "X",
      unit: "$",
      facet: "true",
    };
    for (const type of SUPPORTED_CHART_TYPES) {
      expect(() => buildChartOption(type, [], palette)).not.toThrow();
      expect(() =>
        buildChartOption(type, [{ label: "A", value: 1 }], palette),
      ).not.toThrow();
      expect(() =>
        buildChartOption(type, [{ label: "A", value: 1 }], palette, fullOpts),
      ).not.toThrow();
    }
  });
});
