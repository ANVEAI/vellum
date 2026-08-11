/**
 * P4-W4 native infographic tests: pure geometry helpers + a parser fixture
 * proving the new tags parse into the right node types with attributes
 * intact (golden fixtures untouched — these are NEW tags).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FUNNEL_FLOOR,
  antvTemplateId,
  conversionPercents,
  formatCompactValue,
  funnelHalfWidths,
  harveyWedge,
  layoutOrg,
  mapAntvItemsToNode,
  moodY,
  parseAntvItems,
  parseNumericValue,
  pictogramUnits,
  vennCenters,
  worstDropIndex,
  type OrgInput,
} from "@/components/slides/render/parts/infographic-math";
import {
  FlowDiagram,
  FunnelFlow,
  HarveyTable,
  Iceberg,
  Journey,
  KpiRow,
  MatrixQuad,
  OrgChart,
  Pictogram,
  ProgressRings,
  Venn,
} from "@/components/slides/render/parts/infographics";
import { parseSlideXml } from "@/lib/generation/parser/slide-parser";
import { collectIconQueries } from "@/lib/slides/walk";
import type { TElement } from "@/lib/slides/plate-shim";

/* ---------------- funnel ---------------- */

describe("funnel math", () => {
  it("applies the 0.18 width floor at value zero", () => {
    const hws = funnelHalfWidths([1000, 0], 200);
    expect(hws[0]).toBeCloseTo(200);
    expect(hws[1]).toBeCloseTo(200 * FUNNEL_FLOOR);
  });

  it("is monotonically non-increasing for descending values", () => {
    const hws = funnelHalfWidths([12400, 5200, 900, 900, 120], 210);
    for (let i = 1; i < hws.length; i += 1) {
      expect(hws[i]!).toBeLessThanOrEqual(hws[i - 1]!);
    }
    expect(hws[0]).toBeCloseTo(210);
  });

  it("guards a zero/absent leading value (flat funnel, no NaN)", () => {
    const hws = funnelHalfWidths([0, 0], 200);
    expect(hws).toEqual([200, 200]);
  });

  it("computes rounded conversion percents per boundary", () => {
    expect(conversionPercents([12400, 5200, 900])).toEqual([42, 17]);
  });

  it("selects the worst drop (lowest conversion), first on ties", () => {
    expect(worstDropIndex([1000, 800, 200, 150])).toBe(1);
    expect(worstDropIndex([1000, 250, 100, 25])).toBe(0); // 25% ties → first
    expect(worstDropIndex([100])).toBe(-1);
  });
});

/* ---------------- compact values ---------------- */

describe("compact value formatting", () => {
  it("formats thousands/millions/billions", () => {
    expect(formatCompactValue(12400)).toBe("12.4k");
    expect(formatCompactValue(1240000)).toBe("1.24M");
    expect(formatCompactValue(1500000000)).toBe("1.5B");
    expect(formatCompactValue(990)).toBe("990");
  });

  it("parses currency/comma/suffix strings", () => {
    expect(parseNumericValue("12,400")).toBe(12400);
    expect(parseNumericValue("$1.24M")).toBe(1240000);
    expect(parseNumericValue("78%")).toBe(78);
    expect(parseNumericValue("-1")).toBe(-1);
    expect(parseNumericValue("junk")).toBe(0);
  });
});

/* ---------------- harvey balls ---------------- */

describe("harvey wedge", () => {
  it("renders quarter wedges for ball 1..3", () => {
    const b1 = harveyWedge(1, 14, 14, 11);
    expect(b1.kind).toBe("wedge");
    expect(b1.kind === "wedge" && b1.d).toBe(
      "M 14 14 L 14 3 A 11 11 0 0 1 25 14 Z",
    );

    const b2 = harveyWedge(2, 14, 14, 11);
    expect(b2.kind === "wedge" && b2.d).toBe(
      "M 14 14 L 14 3 A 11 11 0 0 1 14 25 Z",
    );

    const b3 = harveyWedge(3, 14, 14, 11);
    expect(b3.kind === "wedge" && b3.d).toBe(
      "M 14 14 L 14 3 A 11 11 0 1 1 3 14 Z",
    );
  });

  it("ball=4 renders a plain full circle (the 360° arc degenerates)", () => {
    expect(harveyWedge(4, 14, 14, 11)).toEqual({ kind: "full" });
  });

  it("ball=0 renders empty; out-of-range values clamp", () => {
    expect(harveyWedge(0, 14, 14, 11)).toEqual({ kind: "empty" });
    expect(harveyWedge(-2, 14, 14, 11)).toEqual({ kind: "empty" });
    expect(harveyWedge(9, 14, 14, 11)).toEqual({ kind: "full" });
  });
});

/* ---------------- org chart ---------------- */

describe("org chart layout", () => {
  const TREE: OrgInput[] = [
    {
      name: "CEO",
      children: [
        {
          name: "VP1",
          children: [
            { name: "e1", children: [] },
            { name: "e2", children: [] },
          ],
        },
        { name: "VP2", children: [] },
      ],
    },
  ];

  it("gives leaves sequential slots and centers parents over children", () => {
    const layout = layoutOrg(TREE);
    const byName = new Map(layout.nodes.map((n) => [n.name, n]));
    expect(byName.get("e1")!.x).toBe(0.5);
    expect(byName.get("e2")!.x).toBe(1.5);
    expect(byName.get("VP2")!.x).toBe(2.5);
    // Parent x = mid of first and last child.
    expect(byName.get("VP1")!.x).toBe(1);
    expect(byName.get("CEO")!.x).toBe((1 + 2.5) / 2);
    expect(layout.slotCount).toBe(3);
    expect(layout.depthCount).toBe(3);
  });

  it("truncates beyond 3 levels", () => {
    const deep: OrgInput[] = [
      {
        name: "L0",
        children: [
          {
            name: "L1",
            children: [
              { name: "L2", children: [{ name: "L3", children: [] }] },
            ],
          },
        ],
      },
    ];
    const layout = layoutOrg(deep);
    expect(layout.nodes.map((n) => n.name)).toEqual(["L0", "L1", "L2"]);
    expect(layout.depthCount).toBe(3);
  });

  it("truncates beyond 12 nodes (pre-order)", () => {
    const wide: OrgInput[] = [
      {
        name: "root",
        children: Array.from({ length: 15 }, (_, i) => ({
          name: `c${i}`,
          children: [],
        })),
      },
    ];
    const layout = layoutOrg(wide);
    expect(layout.nodes).toHaveLength(12);
    expect(layout.nodes[0]!.name).toBe("root");
  });
});

/* ---------------- venn ---------------- */

describe("venn geometry", () => {
  it("places 2 sets at ±0.55R on the horizontal axis", () => {
    const centers = vennCenters(2, 300, 200, 100);
    expect(centers[0]![0]).toBeCloseTo(300 - 55);
    expect(centers[1]![0]).toBeCloseTo(300 + 55);
    expect(centers[0]![1]).toBeCloseTo(200);
    expect(centers[1]![1]).toBeCloseTo(200);
  });

  it("places 3 sets on an equilateral triangle of circumradius 0.62R", () => {
    const centers = vennCenters(3, 0, 0, 100);
    for (const [x, y] of centers) {
      expect(Math.hypot(x, y)).toBeCloseTo(62);
    }
    const d01 = Math.hypot(
      centers[0]![0] - centers[1]![0],
      centers[0]![1] - centers[1]![1],
    );
    const d12 = Math.hypot(
      centers[1]![0] - centers[2]![0],
      centers[1]![1] - centers[2]![1],
    );
    const d20 = Math.hypot(
      centers[2]![0] - centers[0]![0],
      centers[2]![1] - centers[0]![1],
    );
    expect(d01).toBeCloseTo(d12);
    expect(d12).toBeCloseTo(d20);
    // Side of an equilateral triangle = circumradius · √3.
    expect(d01).toBeCloseTo(62 * Math.sqrt(3));
  });
});

/* ---------------- pictogram ---------------- */

describe("pictogram units", () => {
  it("produces full/fractional/empty unit fills", () => {
    const units = pictogramUnits(10, 6.5);
    expect(units).toHaveLength(10);
    expect(units.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(units[6]).toBeCloseTo(0.5);
    expect(units.slice(7)).toEqual([0, 0, 0]);
  });

  it("caps total at 20 and clamps filled into range", () => {
    expect(pictogramUnits(50, 999)).toHaveLength(20);
    expect(pictogramUnits(50, 999).every((f) => f === 1)).toBe(true);
    expect(pictogramUnits(5, -3)).toEqual([0, 0, 0, 0, 0]);
  });
});

/* ---------------- journey ---------------- */

describe("journey mood mapping", () => {
  it("maps the mood range onto the vertical band (clamped)", () => {
    expect(moodY(2, 30, 210)).toBeCloseTo(30);
    expect(moodY(-2, 30, 210)).toBeCloseTo(210);
    expect(moodY(0, 30, 210)).toBeCloseTo(120);
    expect(moodY(99, 30, 210)).toBeCloseTo(30);
  });
});

/* ---------------- antv fallback mapping ---------------- */

describe("antv template mapping", () => {
  const SYNTAX = [
    "infographic sequence-steps-3",
    "theme",
    "data",
    "- label: Kickoff",
    "  desc: Align on scope",
    "  value: Week 1",
    "  icon: rocket",
    "- label: Build",
    "  desc: Ship increments",
  ].join("\n");

  it("extracts the template id and per-item value/icon fields", () => {
    expect(antvTemplateId(SYNTAX)).toBe("sequence-steps-3");
    const items = parseAntvItems(SYNTAX);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "Kickoff",
      desc: "Align on scope",
      value: "Week 1",
      icon: "rocket",
    });
  });

  it("maps sequence-* onto a timeline with value chips + icons", () => {
    const mapped = mapAntvItemsToNode("sequence-steps-3", parseAntvItems(SYNTAX));
    expect(mapped!.type).toBe("timeline");
    const items = mapped!.children as TElement[];
    expect(items[0]!.type).toBe("timeline-item");
    expect(items[0]!.icon).toBe("rocket");
    const chip = (items[0]!.children as TElement[]).find(
      (c) => c.type === "label",
    );
    expect(chip).toBeDefined();
  });

  it("maps hierarchy-* onto an org-chart with items under the first root", () => {
    const mapped = mapAntvItemsToNode("hierarchy-structure-1", [
      { title: "CEO" },
      { title: "Eng", desc: "VP" },
      { title: "Sales" },
    ]);
    expect(mapped!.type).toBe("org-chart");
    const root = (mapped!.children as TElement[])[0]!;
    expect(root.type).toBe("org-node");
    expect(root.name).toBe("CEO");
    expect((root.children as TElement[]).map((c) => c.name)).toEqual([
      "Eng",
      "Sales",
    ]);
  });

  it("maps quadrant-* onto matrix quads and relation-* onto circles", () => {
    const four = [
      { title: "A" },
      { title: "B" },
      { title: "C" },
      { title: "D" },
    ];
    const matrix = mapAntvItemsToNode("quadrant-grid", four);
    expect(matrix!.type).toBe("matrix");
    expect((matrix!.children as TElement[]).map((c) => c.quad)).toEqual([
      "tl",
      "tr",
      "bl",
      "br",
    ]);
    const relation = mapAntvItemsToNode("relation-map", four);
    expect(relation!.type).toBe("connected-circles");
  });

  it("keeps list/chart/unknown prefixes on boxes", () => {
    const mapped = mapAntvItemsToNode("list-grid-2", [{ title: "One" }]);
    expect(mapped!.type).toBe("boxes");
    expect(mapAntvItemsToNode("chart-bars", [{ title: "x" }])!.type).toBe(
      "boxes",
    );
    expect(mapAntvItemsToNode("anything", [])).toBeNull();
  });
});

/* ---------------- parser fixture ---------------- */

const DECK = `<PRESENTATION><SECTION layout="vertical"><H1>Metrics</H1><KPI-ROW><DIV label="MRR" value="$1.24M" delta="+12.4%" dir="up" good="up" spark="88,91,95,99,104,112" /><DIV label="Churn" value="2.1%" delta="-0.4%" dir="down" good="down" spark="3.1,2.9,2.6,2.4,2.1" /></KPI-ROW><FUNNEL-FLOW showDrop="true"><DIV value="12400"><H3>Visitors</H3></DIV><DIV value="5200"><H3>Signups</H3></DIV><DIV value="900"><H3>Paid</H3></DIV></FUNNEL-FLOW><FLOW direction="LR">
a[Ingest] --> b{Valid?}
b -->|yes| c[(Store)]
b -->|no| d[Reject]
</FLOW></SECTION><SECTION layout="left"><H1>Team</H1><PICTOGRAM total="10" filled="7" icon="user" perRow="5"><H3>7 of 10 seats filled</H3></PICTOGRAM><ORG-CHART><DIV name="Dana" role="CEO"><DIV name="Ravi" role="VP Eng"><DIV name="Ana" role="Platform" /><DIV name="Li" role="Apps" /></DIV><DIV name="Sam" role="VP Sales" /></DIV></ORG-CHART><HARVEY-TABLE><TR><TH>Option</TH><TH>Cost</TH><TH>Speed</TH></TR><TR><TH>Build</TH><TD ball="2" /><TD ball="4" /></TR></HARVEY-TABLE></SECTION></PRESENTATION>`;

describe("parser fixture: new infographic tags", () => {
  const slides = parseSlideXml(DECK);
  const first = slides[0]!;
  const second = slides[1]!;
  const byType = (slide: { content: unknown[] }, type: string): TElement =>
    (slide.content as TElement[]).find((n) => n.type === type)!;

  it("parses both sections", () => {
    expect(slides).toHaveLength(2);
  });

  it("parses KPI-ROW items with attributes intact", () => {
    const kpi = byType(first, "kpi-row");
    expect(kpi).toBeDefined();
    const items = kpi.children as TElement[];
    expect(items).toHaveLength(2);
    expect(items[0]!.type).toBe("kpi-item");
    expect(items[0]!.label).toBe("MRR");
    expect(items[0]!.value).toBe("$1.24M");
    expect(items[0]!.delta).toBe("+12.4%");
    expect(items[0]!.dir).toBe("up");
    expect(items[0]!.good).toBe("up");
    expect(items[0]!.spark).toBe("88,91,95,99,104,112");
    expect(items[1]!.dir).toBe("down");
  });

  it("parses FUNNEL-FLOW stages with values and headings", () => {
    const funnel = byType(first, "funnel-flow");
    expect(funnel).toBeDefined();
    expect(funnel.showDrop).toBe("true");
    const items = funnel.children as TElement[];
    expect(items.map((i) => i.type)).toEqual([
      "funnel-flow-item",
      "funnel-flow-item",
      "funnel-flow-item",
    ]);
    expect(items.map((i) => i.value)).toEqual(["12400", "5200", "900"]);
    const h3 = (items[0]!.children as TElement[])[0]!;
    expect(h3.type).toBe("h3");
  });

  it("captures FLOW syntax + direction for the renderer", () => {
    const flow = byType(first, "flow-diagram");
    expect(flow).toBeDefined();
    expect(flow.direction).toBe("LR");
    const syntax = String(flow.syntax);
    expect(syntax).toContain("a[Ingest] --> b{Valid?}");
    expect(syntax).toContain("-->|yes|");
    expect(syntax.startsWith("\n")).toBe(false);
  });

  it("parses PICTOGRAM and exposes its icon to the icon pipeline", () => {
    const picto = byType(second, "pictogram");
    expect(picto).toBeDefined();
    expect(picto.total).toBe("10");
    expect(picto.filled).toBe("7");
    expect(picto.icon).toBe("user");
    // walk.ts collects it exactly like other icon-bearing nodes.
    expect(collectIconQueries(slides)).toContain("user");
  });

  it("parses nested ORG-CHART DIVs and dedups resync artifacts", () => {
    const org = byType(second, "org-chart");
    expect(org).toBeDefined();
    const roots = (org.children as TElement[]).filter(
      (c) => c.type === "org-node",
    );
    expect(roots).toHaveLength(1); // duplicate siblings dropped
    const dana = roots[0]!;
    expect(dana.name).toBe("Dana");
    const reports = (dana.children as TElement[]).filter(
      (c) => c.type === "org-node",
    );
    expect(reports.map((r) => r.name)).toEqual(["Ravi", "Sam"]);
    const ravi = reports[0]!;
    expect(
      (ravi.children as TElement[])
        .filter((c) => c.type === "org-node")
        .map((r) => r.name),
    ).toEqual(["Ana", "Li"]);
  });

  it("parses HARVEY-TABLE rows with ball attributes on cells", () => {
    const harvey = byType(second, "harvey-table");
    expect(harvey).toBeDefined();
    const rows = harvey.children as TElement[];
    expect(rows).toHaveLength(2);
    const dataCells = (rows[1]!.children as TElement[]).filter(
      (c) => c.type === "td",
    );
    expect(dataCells.map((c) => c.ball)).toEqual(["2", "4"]);
  });

  it("assigns stable element ids to the new nodes", () => {
    const again = parseSlideXml(DECK);
    const ids = (slide: { content: unknown[] }): string[] =>
      (slide.content as TElement[]).map((n) => String(n.id));
    expect(ids(first).every((id) => id.length > 0)).toBe(true);
    expect(ids(again[0]!)).toEqual(ids(first));
  });
});

/* ---------------- component render smoke (SSR, no DOM) ---------------- */

const EXTRA_DECK = `<PRESENTATION><SECTION><H1>Extras</H1><PROGRESS-RINGS><DIV pct="78"><H3>Q3 target</H3></DIV><DIV pct="45"><H3>Hiring</H3></DIV><DIV pct="92"><H3>Uptime</H3></DIV></PROGRESS-RINGS><MATRIX xLabel="Effort" yLabel="Impact" xLow="Low" xHigh="High" yLow="Low" yHigh="High"><DIV quad="tl" tone="positive"><H3>Quick wins</H3><LI>Ship dark mode</LI></DIV><DIV quad="tr"><H3>Big bets</H3></DIV><DIV quad="bl" tone="neutral"><H3>Fill-ins</H3></DIV><DIV quad="br" tone="negative"><H3>Money pits</H3></DIV></MATRIX><JOURNEY><DIV stage="Discover" mood="1"><H3>Curious</H3><P>Finds the tool.</P></DIV><DIV stage="Onboard" mood="-1"><H3>Friction</H3><P>Setup stalls.</P></DIV><DIV stage="Habit" mood="2"><H3>Daily use</H3><P>Sticky at last.</P></DIV></JOURNEY><VENN overlapLabel="Sweet spot"><DIV><H3>Fast</H3></DIV><DIV><H3>Cheap</H3></DIV><DIV><H3>Good</H3></DIV></VENN><ICEBERG><ABOVE><H3>Visible costs</H3><LI>Licenses</LI></ABOVE><BELOW><H3>Hidden costs</H3><LI>Migration</LI><LI>Training</LI></BELOW></ICEBERG></SECTION></PRESENTATION>`;

describe("component render smoke (renderToStaticMarkup)", () => {
  const main = parseSlideXml(DECK);
  const extras = parseSlideXml(EXTRA_DECK)[0]!;
  const nodeOf = (slide: { content: unknown[] }, type: string): TElement =>
    (slide.content as TElement[]).find((n) => n.type === type)!;

  it("renders every component from parsed nodes without crashing", () => {
    const cases: Array<[string, React.ReactElement]> = [
      ["v-fnl-stage", React.createElement(FunnelFlow, { node: nodeOf(main[0]!, "funnel-flow") })],
      ["v-kpi-value", React.createElement(KpiRow, { node: nodeOf(main[0]!, "kpi-row") })],
      ["v-flow-node", React.createElement(FlowDiagram, { node: nodeOf(main[0]!, "flow-diagram") })],
      ["v-picto-dot-dim", React.createElement(Pictogram, { node: nodeOf(main[1]!, "pictogram") })],
      ["v-org-card", React.createElement(OrgChart, { node: nodeOf(main[1]!, "org-chart") })],
      ["v-harvey-ball", React.createElement(HarveyTable, { node: nodeOf(main[1]!, "harvey-table") })],
      ["v-ring-arc", React.createElement(ProgressRings, { node: nodeOf(extras, "progress-rings") })],
      ["v-matrix-quad", React.createElement(MatrixQuad, { node: nodeOf(extras, "matrix") })],
      ["v-journey-dot", React.createElement(Journey, { node: nodeOf(extras, "journey") })],
      ["v-venn-circle", React.createElement(Venn, { node: nodeOf(extras, "venn") })],
      ["v-iceberg-below", React.createElement(Iceberg, { node: nodeOf(extras, "iceberg") })],
    ];
    for (const [marker, element] of cases) {
      const html = renderToStaticMarkup(element);
      expect(html, `expected ${marker} in markup`).toContain(marker);
    }
  });

  it("funnel marks the worst drop and formats compact values", () => {
    const html = renderToStaticMarkup(
      React.createElement(FunnelFlow, { node: nodeOf(main[0]!, "funnel-flow") }),
    );
    // 12400→5200 = 42%, 5200→900 = 17% (worst → accent/bold class)
    expect(html).toContain("↓ 42%");
    expect(html).toContain("↓ 17%");
    expect(html).toContain("v-fnl-drop--worst");
    expect(html).toContain("12.4k");
    expect(html).toContain("900");
  });

  it("kpi deltas color by dir vs good", () => {
    const html = renderToStaticMarkup(
      React.createElement(KpiRow, { node: nodeOf(main[0]!, "kpi-row") }),
    );
    // up/up and down/down are both positive.
    expect(html.match(/v-kpi-delta--pos/g)).toHaveLength(2);
    expect(html).not.toContain("v-kpi-delta--neg");
    expect(html).toContain("▲");
    expect(html).toContain("▼");
  });

  it("harvey renders a full circle for ball=4 and a wedge path for ball=2", () => {
    const html = renderToStaticMarkup(
      React.createElement(HarveyTable, { node: nodeOf(main[1]!, "harvey-table") }),
    );
    expect(html).toContain('<path class="v-harvey-fill"');
    expect(html).toContain('<circle class="v-harvey-fill"');
  });

  it("progress rings highlight only the highest pct", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProgressRings, { node: nodeOf(extras, "progress-rings") }),
    );
    expect(html.match(/v-ring-arc--top/g)).toHaveLength(1);
    expect(html).toContain("92%");
  });

  it("journey dims nothing but marks negative moods as lows", () => {
    const html = renderToStaticMarkup(
      React.createElement(Journey, { node: nodeOf(extras, "journey") }),
    );
    expect(html.match(/v-journey-dot--low/g)).toHaveLength(1);
    expect(html).toContain("Onboard");
  });

  it("flow renders decision/store/terminal shapes and edge label chips", () => {
    const html = renderToStaticMarkup(
      React.createElement(FlowDiagram, { node: nodeOf(main[0]!, "flow-diagram") }),
    );
    expect(html).toContain("v-flow-node--decision");
    expect(html).toContain("v-flow-node--store");
    expect(html).toContain("v-flow-chip-text");
    expect(html).toContain("yes");
    expect(html).toContain("marker-end");
  });
});
