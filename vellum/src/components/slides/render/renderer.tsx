/**
 * Static renderer for PlateNode trees. Pure function of (nodes, theme CSS
 * vars on an ancestor) — used by the live generation view, the editor's
 * read-only surface, present mode, and the print/export route.
 *
 * Element vocabulary derived from allweonedev/presentation-ai (MIT License)
 * — see THIRD_PARTY_LICENSES.md. Visual implementation is vellum's own.
 */
import React from "react";
import dynamic from "next/dynamic";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import { Contributor } from "./slide-meta";
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
} from "./parts/infographics";
import {
  antvTemplateId,
  mapAntvItemsToNode,
  parseAntvItems,
} from "./parts/infographic-math";

function isText(node: Descendant): node is TText {
  return typeof (node as TText).text === "string" && !(node as TElement).type;
}

function textOf(nodes: Descendant[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => (isText(n) ? n.text : textOf((n as TElement).children)))
    .join("");
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Parsed `alignment` attribute → utility class (left/start is the base). */
function alignClass(node: TElement): string | undefined {
  const a = node.alignment;
  if (a === "center") return "v-align-center";
  if (a === "right" || a === "end") return "v-align-right";
  return undefined;
}

/** Leaf text with typewriter support for `generating: true` marks. */
function Leaf({ leaf }: { leaf: TText }) {
  return (
    <span className={cx(Boolean(leaf.generating) && "vellum-generating")}>
      {leaf.text}
    </span>
  );
}

function Children({ nodes }: { nodes: Descendant[] | undefined }) {
  if (!nodes) return null;
  return (
    <>
      {nodes.map((node, i) =>
        isText(node) ? (
          <Leaf key={i} leaf={node} />
        ) : (
          <Node key={(node as TElement).id as string | undefined ?? i} node={node as TElement} />
        ),
      )}
    </>
  );
}

/* ---------- shared bits ---------- */

function ItemIcon({ node, index }: { node: TElement; index?: number }) {
  const icon = node.icon as string | undefined;
  const iconNode = (node.children ?? []).find(
    (c) => !isText(c) && (c as TElement).type === "icon",
  ) as TElement | undefined;
  const query = icon ?? (iconNode?.query as string | undefined);
  const url =
    (node.iconUrl as string | undefined) ??
    (iconNode?.url as string | undefined);
  if (url) {
    // Masked span (not <img>) so the theme accent colors the glyph — the
    // Phosphor SVGs are currentColor fills.
    return (
      <span className="v-icon">
        <span
          className="v-icon-glyph"
          style={{
            WebkitMaskImage: `url(${url})`,
            maskImage: `url(${url})`,
          }}
        />
      </span>
    );
  }
  if (!query && index === undefined) return null;
  return (
    <span className="v-icon v-icon-mono" aria-hidden>
      {query ? query.slice(0, 1).toUpperCase() : (index ?? 0) + 1}
    </span>
  );
}

function nonIconChildren(node: TElement): Descendant[] {
  return (node.children ?? []).filter(
    (c) => isText(c) || (c as TElement).type !== "icon",
  );
}

function ItemBody({ node }: { node: TElement }) {
  return (
    <div className="v-item-body">
      <Children nodes={nonIconChildren(node)} />
    </div>
  );
}

function groupItems(node: TElement): TElement[] {
  return (node.children ?? []).filter(
    (c): c is TElement => !isText(c),
  );
}

/* ---------- smart layout components ---------- */

function Bullets({ node }: { node: TElement }) {
  const items = groupItems(node);
  const bulletType = (node.bulletType as string) ?? "basic";
  return (
    <div className="v-bullets">
      {items.map((item, i) => (
        <div key={i} className="v-bullet">
          <span className="v-bullet-marker">
            {bulletType === "numbered" ? (
              <span className="v-num">{i + 1}</span>
            ) : bulletType === "arrow" ? (
              <span className="v-arrowhead">→</span>
            ) : (
              <span className="v-dot" />
            )}
          </span>
          <ItemBody node={item} />
        </div>
      ))}
    </div>
  );
}

function IconList({ node }: { node: TElement }) {
  const items = groupItems(node);
  const orientation = (node.orientation as string) ?? "side";
  return (
    <div
      className={cx(
        "v-icons",
        orientation === "top" ? "v-icons-top" : "v-icons-side",
      )}
    >
      {items.map((item, i) => (
        <div key={i} className="v-icons-item">
          <ItemIcon node={item} index={i} />
          <ItemBody node={item} />
        </div>
      ))}
    </div>
  );
}

/**
 * boxType collapse table (13 authored values → 6 visual treatments).
 * Values are ADDITIVE modifier classes on `.v-box` — the base class set is a
 * frozen export contract. Unknown values fall back to the base card.
 */
const BOX_VARIANT: Record<string, string> = {
  outline: "v-box--outline",
  solid: "v-box--solid",
  sideline: "v-box--sideline",
  "top-label": "v-box--label",
  "side-label": "v-box--label",
  labeled: "v-box--label",
  "top-circle": "v-box--circle",
  "joined-icon": "v-box--circle",
  icon: "v-box--circle",
  leaf: "v-box--leaf",
  "quote-box": "v-box--leaf",
  "speech-bubble": "v-box--leaf",
  joined: "v-box--leaf",
  alternating: "v-box--leaf",
};

function Boxes({ node }: { node: TElement }) {
  const items = groupItems(node);
  const numbered = String(node.numbered) === "true";
  const boxType =
    typeof node.boxType === "string"
      ? node.boxType
      : typeof node.boxtype === "string"
        ? node.boxtype
        : undefined;
  const variant = boxType ? BOX_VARIANT[boxType] : undefined;
  const circle = variant === "v-box--circle";
  return (
    <div className="v-boxes">
      {items.map((item, i) => (
        <div key={i} className={cx("v-box v-card", variant)}>
          {(numbered || circle || Boolean(item.icon)) && (
            <div className="v-box-head">
              {numbered ? (
                <span className="v-num">{i + 1}</span>
              ) : (
                <ItemIcon node={item} index={i} />
              )}
            </div>
          )}
          <ItemBody node={item} />
        </div>
      ))}
    </div>
  );
}

function Arrows({ node }: { node: TElement }) {
  const items = groupItems(node);
  return (
    <div className="v-arrows">
      {items.map((item, i) => (
        <div key={i} className="v-arrow-item">
          <div className="v-arrow-shape v-card">
            <ItemBody node={item} />
          </div>
          {i < items.length - 1 && <span className="v-arrow-sep">→</span>}
        </div>
      ))}
    </div>
  );
}

function SequenceArrows({ node }: { node: TElement }) {
  const items = groupItems(node);
  return (
    <div className="v-seq">
      {items.map((item, i) => (
        <div key={i} className="v-seq-item">
          <span className="v-num">{i + 1}</span>
          <div className="v-seq-body v-card">
            <ItemBody node={item} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Steps({ node }: { node: TElement }) {
  const items = groupItems(node);
  // variant="box" → step bodies get the shared card treatment; "arrow" and
  // unknown values keep the open base look.
  const boxed = node.variant === "box";
  return (
    <div className={cx("v-steps", boxed && "v-steps--box")}>
      {items.map((item, i) => (
        <div key={i} className="v-step">
          <div className="v-step-head">
            <span className="v-num">{i + 1}</span>
            {i < items.length - 1 && <span className="v-step-line" />}
          </div>
          <div className={cx("v-step-body", boxed && "v-card")}>
            <ItemIcon node={item} />
            <ItemBody node={item} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ node }: { node: TElement }) {
  const items = groupItems(node);
  // Parser-normalized attributes (booleans are real booleans, but tolerate
  // string forms for hand-built nodes).
  const horizontal = node.orientation === "horizontal";
  const double = !horizontal && node.sidedness === "double";
  const numbered = node.numbered === true || node.numbered === "true";
  const hideLine = node.showLine === false || node.showLine === "false";
  return (
    <div
      className={cx(
        "v-timeline",
        horizontal && "v-timeline--h",
        double && "v-timeline--double",
        numbered && "v-timeline--numbered",
        hideLine && "v-timeline--noline",
      )}
    >
      {/* Line stays in the DOM in every mode (export contract); the
          --noline modifier hides it so PPTX measurement skips it too. */}
      <span className="v-timeline-line" />
      {items.map((item, i) => (
        <div key={i} className="v-timeline-item">
          {numbered ? (
            <span className="v-timeline-dot v-num">{i + 1}</span>
          ) : (
            <span className="v-timeline-dot" />
          )}
          <div className="v-timeline-body v-card">
            <ItemBody node={item} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Cycle({ node }: { node: TElement }) {
  const items = groupItems(node);
  const n = items.length || 1;
  // Circular placement on a 100x100 coordinate system.
  const radius = 38;
  // variant="flower" → accent-tinted petal circles behind the cards.
  // "ring"/"circle"/unknown keep the base dashed-ring look.
  const flower = node.variant === "flower";
  return (
    <div className={cx("v-cycle", flower && "v-cycle--flower")}>
      <div className="v-cycle-ring" />
      {items.map((item, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const x = 50 + radius * Math.cos(angle);
        const y = 50 + radius * Math.sin(angle);
        return (
          <div
            key={i}
            className="v-cycle-item v-card"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <ItemBody node={item} />
          </div>
        );
      })}
    </div>
  );
}

function Pyramid({ node }: { node: TElement }) {
  const items = groupItems(node);
  const n = items.length || 1;
  const isFunnel = String(node.isFunnel) === "true";
  return (
    <div
      className={cx("v-pyramid", node.variant === "inside" && "v-pyramid--inside")}
    >
      {items.map((item, i) => {
        const level = isFunnel ? i : n - 1 - i;
        const width = 38 + (level / Math.max(1, n - 1)) * 58;
        return (
          <div key={i} className="v-pyramid-row" style={{ width: `${width}%` }}>
            <div className="v-pyramid-band">
              <span className="v-pyramid-label">
                <ItemBody node={item} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Staircase({ node }: { node: TElement }) {
  const items = groupItems(node);
  const n = items.length || 1;
  return (
    <div
      className={cx("v-stairs", node.variant === "inside" && "v-stairs--inside")}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="v-stair"
          style={{ marginLeft: `${(i / n) * 34}%` }}
        >
          <span className="v-num">{i + 1}</span>
          <div className="v-stair-body v-card">
            <ItemBody node={item} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TwoSide({
  node,
  kind,
}: {
  node: TElement;
  kind: "compare" | "before-after";
}) {
  const sides = groupItems(node);
  return (
    <div className={cx("v-twoside", kind === "before-after" && "v-ba")}>
      {sides.map((side, i) => (
        <div
          key={i}
          className={cx("v-side v-card", i === 0 ? "v-side-a" : "v-side-b")}
        >
          <ItemBody node={side} />
        </div>
      ))}
      <span className="v-vs">{kind === "compare" ? "VS" : "→"}</span>
    </div>
  );
}

function ProsCons({ node }: { node: TElement }) {
  const sides = groupItems(node);
  return (
    <div className="v-twoside v-proscons">
      {sides.map((side, i) => {
        const isPros = side.type === "pros-item" || i === 0;
        return (
          <div
            key={i}
            className={cx("v-side v-card", isPros ? "v-pros" : "v-cons")}
          >
            <ItemBody node={side} />
          </div>
        );
      })}
    </div>
  );
}

/** statstype collapse table (7 authored values → 4 visual treatments). */
const STATS_VARIANT: Record<string, "plain" | "circle" | "bar"> = {
  plain: "plain",
  circle: "circle",
  "circle-bold": "circle",
  bar: "bar",
  // dot-grid / dot-line / star → base card look (absent from the map).
};

/** Width for the `bar` stat treatment: numeric % in the stat, else 70. */
function statBarPercent(stat: string): number {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(stat);
  if (!m) return 70;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, v));
}

function Stats({ node }: { node: TElement }) {
  const items = groupItems(node);
  const rawType =
    typeof node.statsType === "string"
      ? node.statsType
      : typeof node.statstype === "string"
        ? node.statstype
        : undefined;
  const variant = rawType ? STATS_VARIANT[rawType] : undefined;
  return (
    <div
      className={cx(
        "v-stats",
        variant === "plain" && "v-stats--plain",
        variant === "circle" && "v-stats--circle",
        rawType === "circle-bold" && "v-stats--circle-bold",
        variant === "bar" && "v-stats--bar",
      )}
    >
      {items.map((item, i) => {
        const stat = String(item.stat ?? "");
        return (
          <div key={i} className="v-stat v-card">
            <span className="v-stat-value">{stat}</span>
            {variant === "bar" && (
              <span className="v-stat-bar">
                <span
                  className="v-stat-bar-fill"
                  style={{ width: `${statBarPercent(stat)}%` }}
                />
              </span>
            )}
            <ItemBody node={item} />
          </div>
        );
      })}
    </div>
  );
}

function ColumnsGroup({ node }: { node: TElement }) {
  const cols = groupItems(node);
  return (
    <div className="v-columns" style={{ ["--v-cols" as string]: cols.length }}>
      {cols.map((col, i) => (
        <div key={i} className="v-column">
          <Children nodes={col.children} />
        </div>
      ))}
    </div>
  );
}

/* ---------- relationship components (P3-A2) ----------
   New class families (.v-slope/.v-ccircles/.v-cgrid/.v-snake/.v-antv) sit
   outside the frozen export contract; they export as screenshots. */

/** Rising accent line with labeled points — maturity/growth narratives. */
function Slope({ node }: { node: TElement }) {
  const items = groupItems(node);
  const n = items.length || 1;
  return (
    <div className="v-slope">
      <div className="v-slope-plot">
        <svg
          className="v-slope-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <line
            className="v-slope-line"
            x1="0"
            y1="92"
            x2="100"
            y2="8"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {items.map((item, i) => {
          const t = (i + 0.5) / n;
          const x = t * 100;
          const y = 92 - 84 * t; // stays on the line: y = 92 - 84·(x/100)
          return (
            <div
              key={i}
              className="v-slope-point"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className="v-slope-dot" />
              <div className="v-slope-label">
                <ItemBody node={item} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** N accent-tinted circles on a hairline, item text under each. */
function ConnectedCircles({ node }: { node: TElement }) {
  const items = groupItems(node);
  return (
    <div className="v-ccircles">
      {items.length > 1 && <span className="v-ccircles-line" aria-hidden />}
      {items.map((item, i) => (
        <div key={i} className="v-ccircles-item">
          <span className="v-ccircles-circle">{i + 1}</span>
          <ItemBody node={item} />
        </div>
      ))}
    </div>
  );
}

/** Items as circles in a ring around an optional centerText circle. */
function CircularGrid({ node }: { node: TElement }) {
  const items = groupItems(node);
  const n = items.length || 1;
  const centerText =
    typeof node.centerText === "string" ? node.centerText.trim() : "";
  const radius = 38;
  return (
    <div className="v-cgrid">
      {centerText && <div className="v-cgrid-center">{centerText}</div>}
      {items.map((item, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const x = 50 + radius * Math.cos(angle);
        const y = 50 + radius * Math.sin(angle);
        return (
          <div
            key={i}
            className="v-cgrid-item"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <ItemBody node={item} />
          </div>
        );
      })}
    </div>
  );
}

/** Boustrophedon 3-per-row grid: rows alternate direction, numbered badges,
    connector elbows drawn with CSS borders. */
function Snake({ node }: { node: TElement }) {
  const items = groupItems(node);
  const perRow = 3;
  const rows: TElement[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  let idx = 0;
  return (
    <div className="v-snake">
      {rows.map((row, r) => (
        <div
          key={r}
          className={cx("v-snake-row", r % 2 === 1 && "v-snake-row--rev")}
        >
          {row.map((item) => {
            const i = idx++;
            return (
              <div key={i} className="v-snake-cell v-card">
                <span className="v-num">{i + 1}</span>
                <ItemBody node={item} />
              </div>
            );
          })}
          {/* Ghost cells keep the column rhythm on the last row. */}
          {row.length < perRow &&
            Array.from({ length: perRow - row.length }).map((_, g) => (
              <div key={`g${g}`} className="v-snake-cell v-snake-cell--ghost" />
            ))}
        </div>
      ))}
    </div>
  );
}

/** Structured fallback for antv-infographic nodes. Template-id prefixes map
    onto REAL components (sequence-→Timeline, compare-→Compare/ProsCons,
    hierarchy-→OrgChart, quadrant-→Matrix, relation-→ConnectedCircles,
    list-/chart-/unknown→Boxes) with per-item value chips and icon fields;
    the prompt card remains the last resort — never a run-on paragraph. */
function AntvInfographic({ node }: { node: TElement }) {
  // Structured element children win when present (future-proofing).
  const structural = groupItems(node).filter(
    (c) => textOf(c.children).trim().length > 0,
  );
  const syntax = typeof node.syntax === "string" ? node.syntax : "";
  const prompt =
    typeof node.generationPrompt === "string" ? node.generationPrompt.trim() : "";

  let body: React.ReactNode = null;
  if (structural.length > 0) {
    body = <Boxes node={{ type: "boxes", children: structural }} />;
  } else if (syntax.trim()) {
    const mapped = mapAntvItemsToNode(
      antvTemplateId(syntax),
      parseAntvItems(syntax),
    );
    if (mapped) body = <Node node={mapped} />;
  }
  if (!body && !prompt) return null;
  return (
    <div className="v-antv">
      <div className="v-antv-label">Infographic</div>
      {body ?? (
        <div className="v-card v-antv-prompt">
          <p className="v-p">{prompt}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- media + content blocks ---------- */

function Img({ node }: { node: TElement }) {
  const url = (node.url as string) || "";
  const query = (node.query as string) || "";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="v-img" src={url} alt={query} />
    );
  }
  return (
    <div className="v-img v-img-pending" title={query}>
      <span>{query ? "Generating image…" : "Image"}</span>
    </div>
  );
}

function Quote({ node }: { node: TElement }) {
  const author = node.author as string | undefined;
  // `large` → centered display treatment; sidequote/sidequote-icon and
  // unknown values keep the base left-border look.
  const large = node.variant === "large";
  return (
    <figure className={cx("v-quote", large && "v-quote--large")}>
      {large && (
        <span className="v-quote-glyph" aria-hidden>
          &ldquo;
        </span>
      )}
      <blockquote>
        <Children nodes={node.children} />
      </blockquote>
      {author && <figcaption>— {author}</figcaption>}
    </figure>
  );
}

function Callout({ node }: { node: TElement }) {
  const variant = (node.variant as string) ?? "note";
  return (
    <div className={cx("v-callout", `v-callout-${variant}`)}>
      <Children nodes={node.children} />
    </div>
  );
}

function CodeBlock({ node }: { node: TElement }) {
  return (
    <pre className="v-code">
      <code>
        <Children nodes={node.children} />
      </code>
    </pre>
  );
}

function Table({ node }: { node: TElement }) {
  const rows = groupItems(node);
  return (
    <table className="v-table">
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {groupItems(row).map((cell, ci) =>
              cell.type === "th" ? (
                <th key={ci}>
                  <Children nodes={cell.children} />
                </th>
              ) : (
                <td key={ci}>
                  <Children nodes={cell.children} />
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ChartElement = dynamic(
  () => import("./chart-element").then((m) => m.ChartElement),
  {
    ssr: false,
    loading: () => <div className="v-chart-pending v-card">Loading chart…</div>,
  },
);

/* ---------- dispatcher ---------- */

export function Node({ node }: { node: TElement }) {
  const type = String(node.type);
  switch (type) {
    case "presentation-title":
      return (
        <h1 className={cx("v-title", alignClass(node))}>
          <Children nodes={node.children} />
        </h1>
      );
    case "h1":
      return (
        <h1 className={cx("v-h1", alignClass(node))}>
          <Children nodes={node.children} />
        </h1>
      );
    case "h2":
      return (
        <h2 className={cx("v-h2", alignClass(node))}>
          <Children nodes={node.children} />
        </h2>
      );
    case "h3":
      return (
        <h3 className="v-h3">
          <Children nodes={node.children} />
        </h3>
      );
    case "h4":
    case "h5":
    case "h6":
      return (
        <h4 className="v-h4">
          <Children nodes={node.children} />
        </h4>
      );
    case "p": {
      // The model sometimes nests a block (img, stats, callout, another p)
      // inside a paragraph. <p> may not contain those: the browser silently
      // closes the paragraph early, so React's tree and the real DOM diverge
      // and hydration errors. A div carries the same v-p class and the same
      // [data-block-idx] position, so the export contract is untouched.
      const hasBlockChild = (node.children ?? []).some(
        (child) => typeof (child as TElement).type === "string",
      );
      const Tag = hasBlockChild ? "div" : "p";
      return (
        // A wrapper holding blocks must not impose paragraph typography on
        // them — an image or stat block was inheriting body leading and 92%
        // opacity purely because the model happened to nest it.
        <Tag className={cx("v-p", hasBlockChild && "v-p--wrap", alignClass(node))}>
          <Children nodes={node.children} />
        </Tag>
      );
    }
    case "label":
      return (
        <div className={cx("v-label", alignClass(node))}>
          <Children nodes={node.children} />
        </div>
      );
    case "contributor":
      return <Contributor />;
    case "img":
      return <Img node={node} />;
    case "quote":
      return <Quote node={node} />;
    case "callout":
      return <Callout node={node} />;
    case "code_block":
      return <CodeBlock node={node} />;
    case "code_line":
      return (
        <span className="v-code-line">
          <Children nodes={node.children} />
          {"\n"}
        </span>
      );
    case "blockquote":
      return <Quote node={node} />;
    case "table":
      return <Table node={node} />;
    case "bullets":
      return <Bullets node={node} />;
    case "icons":
      return <IconList node={node} />;
    case "boxes":
      return <Boxes node={node} />;
    case "arrows":
      return <Arrows node={node} />;
    case "arrow-vertical":
      return <SequenceArrows node={node} />;
    case "steps":
      return <Steps node={node} />;
    case "timeline":
      return <Timeline node={node} />;
    case "cycle":
      return <Cycle node={node} />;
    case "pyramid":
      return <Pyramid node={node} />;
    case "staircase":
      return <Staircase node={node} />;
    case "slope":
      return <Slope node={node} />;
    case "connected-circles":
      return <ConnectedCircles node={node} />;
    case "circular-grid":
      return <CircularGrid node={node} />;
    case "snake":
      return <Snake node={node} />;
    case "antv-infographic":
      return <AntvInfographic node={node} />;
    case "funnel-flow":
      return <FunnelFlow node={node} />;
    case "kpi-row":
      return <KpiRow node={node} />;
    case "progress-rings":
      return <ProgressRings node={node} />;
    case "pictogram":
      return <Pictogram node={node} />;
    case "harvey-table":
      return <HarveyTable node={node} />;
    case "matrix":
      return <MatrixQuad node={node} />;
    case "org-chart":
      return <OrgChart node={node} />;
    case "journey":
      return <Journey node={node} />;
    case "venn":
      return <Venn node={node} />;
    case "iceberg":
      return <Iceberg node={node} />;
    case "flow-diagram":
      return <FlowDiagram node={node} />;
    case "compare":
      return <TwoSide node={node} kind="compare" />;
    case "before-after":
      return <TwoSide node={node} kind="before-after" />;
    case "pros-cons":
      return <ProsCons node={node} />;
    case "stats":
      return <Stats node={node} />;
    case "column_group":
      return <ColumnsGroup node={node} />;
    case "column":
      return (
        <div className="v-column">
          <Children nodes={node.children} />
        </div>
      );
    case "li":
      return (
        <li className="v-li">
          <Children nodes={node.children} />
        </li>
      );
    default:
      if (type.startsWith("chart-")) return <ChartElement node={node} />;
      // Unknown types degrade to paragraphs — same spirit as the parser.
      return (
        <p className="v-p">
          <Children nodes={node.children} />
        </p>
      );
  }
}

/**
 * Slide body. `focusIndex` enables focus mode: every top-level node gets a
 * wrapper div and non-focused wrappers dim (opacity/saturation transition via
 * .v-focus-wrap--dim). When focusIndex is undefined the DOM stays
 * wrapper-free — the export contract depends on the unwrapped structure.
 */
export function SlideContent({
  nodes,
  focusIndex,
  contentRef,
  atFloor,
}: {
  nodes: Descendant[];
  focusIndex?: number;
  contentRef?: React.Ref<HTMLDivElement>;
  /** Autofit bottomed out: stop centring so the heading is never clipped. */
  atFloor?: boolean;
}) {
  return (
    <div
      ref={contentRef}
      className={cx("v-content", atFloor && "v-content--overflow")}
      data-slide-content="true"
    >
      {focusIndex === undefined ? (
        <Children nodes={nodes} />
      ) : (
        nodes.map((node, i) => (
          <div
            key={
              (!isText(node) &&
                ((node as TElement).id as string | undefined)) ||
              i
            }
            className={cx(
              "v-focus-wrap",
              i !== focusIndex && "v-focus-wrap--dim",
            )}
          >
            {isText(node) ? (
              <Leaf leaf={node} />
            ) : (
              <Node node={node as TElement} />
            )}
          </div>
        ))
      )}
    </div>
  );
}

export { textOf };
