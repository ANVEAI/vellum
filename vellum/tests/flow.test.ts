/**
 * FLOW diagram DSL tests: lenient parsing, cycle tolerance, deterministic
 * layout, and the TB↔LR axis swap.
 */
import { describe, expect, it } from "vitest";
import {
  FLOW_CANVAS_H,
  FLOW_CANVAS_W,
  layoutFlow,
  nodeWidth,
  parseFlow,
  polylineMidpoint,
  roundedElbowPath,
  wrapLabel,
} from "@/lib/diagram/flow";

describe("parseFlow", () => {
  it("parses all five node shapes", () => {
    const graph = parseFlow(
      [
        "a[Process step]",
        "b(Rounded step)",
        "c{Decision?}",
        "d[(Data store)]",
        "e((Done))",
      ].join("\n"),
    );
    expect(graph.nodes).toEqual([
      { id: "a", label: "Process step", shape: "process" },
      { id: "b", label: "Rounded step", shape: "rounded" },
      { id: "c", label: "Decision?", shape: "decision" },
      { id: "d", label: "Data store", shape: "store" },
      { id: "e", label: "Done", shape: "terminal" },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("parses edges with labels in both positions", () => {
    const graph = parseFlow(
      ["a[Start]", "b[End]", "a -->|yes| b", "a --> b |no|"].join("\n"),
    );
    expect(graph.edges).toEqual([
      { from: "a", to: "b", label: "yes" },
      { from: "a", to: "b", label: "no" },
    ]);
  });

  it("auto-creates endpoints referenced only by edges", () => {
    const graph = parseFlow("a --> b");
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(graph.nodes[0]!.shape).toBe("process");
    expect(graph.edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("accepts inline shape definitions inside edge lines and chains", () => {
    const graph = parseFlow("a[Start] --> b{Check} -->|ok| c((Done))");
    expect(graph.nodes).toEqual([
      { id: "a", label: "Start", shape: "process" },
      { id: "b", label: "Check", shape: "decision" },
      { id: "c", label: "Done", shape: "terminal" },
    ]);
    expect(graph.edges).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c", label: "ok" },
    ]);
  });

  it("upgrades an implicit node when defined later", () => {
    const graph = parseFlow(["a --> b", "b{Really a decision}"].join("\n"));
    expect(graph.nodes.find((n) => n.id === "b")).toEqual({
      id: "b",
      label: "Really a decision",
      shape: "decision",
    });
  });

  it("skips junk lines without throwing (lenient contract)", () => {
    const graph = parseFlow(
      [
        "flowchart TD",
        "%% a comment",
        "just some prose that is not a node",
        "a[Start]",
        "??? --> ???[",
        "-->",
        "a --> b",
        "",
      ].join("\n"),
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(graph.edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("never throws on garbage input", () => {
    expect(() => parseFlow("")).not.toThrow();
    expect(() => parseFlow("<<<>>> ||| ---> [[[")).not.toThrow();
    expect(parseFlow("").nodes).toEqual([]);
  });
});

describe("wrapLabel / nodeWidth", () => {
  it("keeps short labels on one line", () => {
    expect(wrapLabel("Short label")).toEqual(["Short label"]);
  });

  it("wraps long labels at the space nearest the middle", () => {
    const lines = wrapLabel("A fairly long node label that wraps");
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe("A fairly long node label that wraps");
  });

  it("hard-splits unbroken strings", () => {
    const lines = wrapLabel("x".repeat(40));
    expect(lines).toEqual(["x".repeat(28), "x".repeat(12)]);
  });

  it("clamps node width into [120, 260]", () => {
    expect(nodeWidth("ab")).toBe(120);
    expect(nodeWidth("x".repeat(100))).toBe(260);
    expect(nodeWidth("a".repeat(20))).toBeCloseTo(20 * 8.5 + 24);
  });
});

describe("layoutFlow", () => {
  const CHAIN = "a[Start] --> b{Check} --> c[Finish]";

  it("lays a chain into consecutive layers (TB: shared x, increasing y)", () => {
    const layout = layoutFlow(parseFlow(CHAIN), "TB");
    const [a, b, c] = layout.nodes;
    expect(layout.nodes.map((n) => n.layer)).toEqual([0, 1, 2]);
    expect(a!.x).toBe(b!.x);
    expect(b!.x).toBe(c!.x);
    expect(a!.y).toBeLessThan(b!.y);
    expect(b!.y).toBeLessThan(c!.y);
    expect(layout.width).toBe(FLOW_CANVAS_W);
    expect(layout.height).toBe(FLOW_CANVAS_H);
  });

  it("swaps axes for LR (shared y, increasing x)", () => {
    const layout = layoutFlow(parseFlow(CHAIN), "LR");
    const [a, b, c] = layout.nodes;
    expect(a!.y).toBe(b!.y);
    expect(b!.y).toBe(c!.y);
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
  });

  it("tolerates cycles: back edge keeps all nodes layered", () => {
    const layout = layoutFlow(parseFlow("a --> b\nb --> c\nc --> a"), "TB");
    expect(layout.nodes.map((n) => n.layer)).toEqual([0, 1, 2]);
    // The back edge (c → a) still routes — through the side channel.
    const back = layout.edges.find((e) => e.from === "c" && e.to === "a");
    expect(back).toBeDefined();
    expect(back!.points.length).toBeGreaterThanOrEqual(2);
  });

  it("routes self-loops without collapsing", () => {
    const layout = layoutFlow(parseFlow("a[Loop]\na --> a"), "TB");
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]!.points).toHaveLength(4);
  });

  it("is deterministic: identical JSON across independent runs", () => {
    const text = [
      "start((Kickoff)) --> triage{Severity?}",
      "triage -->|high| page[Page on-call]",
      "triage -->|low| ticket[(Ticket queue)]",
      "page --> fix[Ship fix]",
      "ticket --> fix",
      "fix --> verify(Verify in prod)",
      "verify -->|regression| triage",
    ].join("\n");
    const one = layoutFlow(parseFlow(text), "TB");
    const two = layoutFlow(parseFlow(text), "TB");
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(two).toEqual(one);
  });

  it("matches the canonical graph snapshot", () => {
    const layout = layoutFlow(
      parseFlow(
        [
          "a[Ingest] --> b{Valid?}",
          "b -->|yes| c[(Store)]",
          "b -->|no| d[Reject]",
          "c --> e((Done))",
        ].join("\n"),
      ),
      "TB",
    );
    expect(layout).toMatchSnapshot();
  });

  it("forward edges leave the exit face and enter the entry face (TB)", () => {
    const layout = layoutFlow(parseFlow("a[One] --> b[Two]"), "TB");
    const edge = layout.edges[0]!;
    const [a, b] = layout.nodes;
    expect(edge.points[0]![1]).toBeCloseTo(a!.y + a!.h / 2);
    expect(edge.points[edge.points.length - 1]![1]).toBeCloseTo(b!.y - b!.h / 2);
  });
});

describe("path helpers", () => {
  it("roundedElbowPath emits quadratic corners for elbows", () => {
    const d = roundedElbowPath(
      [
        [0, 0],
        [0, 50],
        [80, 50],
      ],
      6,
    );
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("Q 0 50");
    expect(d.endsWith("L 80 50")).toBe(true);
  });

  it("polylineMidpoint picks the middle segment midpoint", () => {
    expect(
      polylineMidpoint([
        [0, 0],
        [0, 10],
        [20, 10],
        [20, 20],
      ]),
    ).toEqual([10, 10]);
  });
});
