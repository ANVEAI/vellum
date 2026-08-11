/**
 * P4-W4 native infographic components — pure SVG/CSS render of the parsed
 * infographic nodes. Deterministic: no measurement, no hooks, no randomness;
 * geometry comes from parts/infographic-math.ts and lib/diagram/flow.ts.
 *
 * These are NEW class families (outside the frozen export contract) so PPTX
 * export captures them as screenshots — everything renders in normal block
 * flow (relative containers with absolutely-positioned children inside).
 *
 * Deliberately does NOT import from ../renderer (no cycles): a small local
 * ItemContent renderer covers the constrained child vocabulary these
 * components carry (headings / paragraphs / labels / text), reusing the
 * same v-h3 / v-h4 / v-p / v-label classes so typography matches.
 */
import React from "react";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import {
  FUNNEL_MAX_STAGES,
  conversionPercents,
  formatCompactValue,
  funnelHalfWidths,
  harveyWedge,
  journeyPath,
  layoutOrg,
  moodY,
  parseNumericValue,
  pictogramUnits,
  sparkPoints,
  vennCenters,
  worstDropIndex,
  type OrgInput,
} from "./infographic-math";
import {
  layoutFlow,
  parseFlow,
  polylineMidpoint,
  roundedElbowPath,
  type FlowDirection,
  type PositionedFlowNode,
} from "@/lib/diagram/flow";

/* ---------- local helpers (mirrors of the renderer's tiny utilities) ---------- */

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

function groupItems(node: TElement): TElement[] {
  return (node.children ?? []).filter((c): c is TElement => !isText(c));
}

/** Attribute lookup tolerant of lowercased authoring (xLabel vs xlabel). */
function attrOf(node: TElement, name: string): string | undefined {
  const exact = node[name];
  if (typeof exact === "string" && exact !== "") return exact;
  const lower = node[name.toLowerCase()];
  if (typeof lower === "string" && lower !== "") return lower;
  return undefined;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…` : t;
}

const HEADING_TYPES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function firstHeadingText(item: TElement): string {
  const heading = (item.children ?? []).find(
    (c) => !isText(c) && HEADING_TYPES.has(String((c as TElement).type)),
  ) as TElement | undefined;
  return heading ? textOf(heading.children).trim() : "";
}

/** Children minus the first heading (used when the heading became a label). */
function withoutFirstHeading(item: TElement): Descendant[] {
  const children = item.children ?? [];
  const idx = children.findIndex(
    (c) => !isText(c) && HEADING_TYPES.has(String((c as TElement).type)),
  );
  if (idx === -1) return children;
  return children.filter((_, i) => i !== idx);
}

/** Minimal renderer for the constrained child vocabulary of these blocks. */
function MiniNode({ node }: { node: TElement }) {
  const type = String(node.type);
  if (type === "h3" || type === "h1" || type === "h2") {
    return (
      <h3 className="v-h3">
        <MiniChildren nodes={node.children} />
      </h3>
    );
  }
  if (HEADING_TYPES.has(type)) {
    return (
      <h4 className="v-h4">
        <MiniChildren nodes={node.children} />
      </h4>
    );
  }
  if (type === "label") {
    return (
      <div className="v-label">
        <MiniChildren nodes={node.children} />
      </div>
    );
  }
  // Paragraphs (including LI-derived ones, which carry listStyleType).
  const isListItem = typeof node.listStyleType === "string";
  return (
    <p className={cx("v-p", isListItem && "v-ig-li")}>
      <MiniChildren nodes={node.children} />
    </p>
  );
}

function MiniChildren({ nodes }: { nodes: Descendant[] | undefined }) {
  if (!nodes) return null;
  return (
    <>
      {nodes.map((node, i) =>
        isText(node) ? (
          <span key={i}>{node.text}</span>
        ) : (
          <MiniNode key={i} node={node as TElement} />
        ),
      )}
    </>
  );
}

function ItemContent({ nodes }: { nodes: Descendant[] | undefined }) {
  return (
    <div className="v-item-body">
      <MiniChildren nodes={nodes} />
    </div>
  );
}

/** Masked glyph span (theme accent colors the Phosphor SVG via CSS mask). */
function maskStyle(url: string): React.CSSProperties {
  return {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
  };
}

function domId(node: TElement, prefix: string): string {
  const raw = typeof node.id === "string" ? node.id : "x";
  return `${prefix}-${raw.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ================= 1. FUNNEL-FLOW ================= */

export function FunnelFlow({ node }: { node: TElement }) {
  const items = groupItems(node).slice(0, FUNNEL_MAX_STAGES);
  const n = items.length;
  if (n === 0) return null;

  const values = items.map((item) => parseNumericValue(item.value));
  const showDrop = (attrOf(node, "showDrop") ?? "true") !== "false";

  const W = 720;
  const H = 400;
  const cx0 = 250;
  const half = 205;
  const gutterX = 540;
  const stageH = H / n;
  const hws = funnelHalfWidths(values, half);
  const percents = conversionPercents(values);
  const worst = worstDropIndex(values);
  const denom = Math.max(1, n - 1);

  return (
    <div className="v-fnl">
      <svg className="v-fnl-svg" viewBox={`0 0 ${W} ${H}`} role="img">
        {items.map((item, i) => {
          const hwTop = hws[i]!;
          const hwBottom = hws[i + 1] ?? hws[i]!;
          const yTop = i * stageH + 2;
          const yBottom = (i + 1) * stageH - 2;
          const label = truncate(firstHeadingText(item) || `Stage ${i + 1}`, 26);
          const midY = (yTop + yBottom) / 2;
          return (
            <g key={i}>
              <polygon
                className="v-fnl-stage"
                style={{ fillOpacity: 0.18 + (i / denom) * 0.3 }}
                points={`${(cx0 - hwTop).toFixed(2)},${yTop.toFixed(2)} ${(cx0 + hwTop).toFixed(2)},${yTop.toFixed(2)} ${(cx0 + hwBottom).toFixed(2)},${yBottom.toFixed(2)} ${(cx0 - hwBottom).toFixed(2)},${yBottom.toFixed(2)}`}
              />
              <text className="v-fnl-label" x={cx0} y={midY - 6} textAnchor="middle">
                {label}
              </text>
              <text className="v-fnl-value" x={cx0} y={midY + 18} textAnchor="middle">
                {formatCompactValue(values[i]!)}
              </text>
            </g>
          );
        })}
        {showDrop &&
          percents.map((pct, i) => (
            <text
              key={i}
              className={cx(
                "v-fnl-drop",
                i === worst && "v-fnl-drop--worst",
              )}
              x={gutterX}
              y={(i + 1) * stageH}
              dy="0.35em"
            >
              {`↓ ${pct}%`}
            </text>
          ))}
      </svg>
    </div>
  );
}

/* ================= 2. KPI-ROW ================= */

export function KpiRow({ node }: { node: TElement }) {
  const items = groupItems(node);
  if (items.length === 0) return null;
  return (
    <div className="v-kpi">
      {items.map((item, i) => {
        const dir = String(item.dir ?? "up") === "down" ? "down" : "up";
        const good = String(item.good ?? "up") === "down" ? "down" : "up";
        const positive = dir === good;
        const delta = typeof item.delta === "string" ? item.delta : "";
        const pts = sparkPoints(String(item.spark ?? ""));
        const last = pts[pts.length - 1];
        return (
          <div key={i} className="v-kpi-cell v-card">
            <span className="v-kpi-label">{String(item.label ?? "")}</span>
            <span className="v-kpi-value">{String(item.value ?? "")}</span>
            {delta && (
              <span
                className={cx(
                  "v-kpi-delta",
                  positive ? "v-kpi-delta--pos" : "v-kpi-delta--neg",
                )}
              >
                <span className="v-kpi-delta-glyph" aria-hidden>
                  {dir === "down" ? "▼" : "▲"}
                </span>
                {delta}
              </span>
            )}
            {pts.length > 1 && (
              <svg className="v-kpi-spark" viewBox="0 0 96 30" aria-hidden>
                <polyline
                  className="v-kpi-spark-line"
                  points={pts.map((p) => p.join(",")).join(" ")}
                />
                {last && (
                  <circle
                    className="v-kpi-spark-dot"
                    cx={last[0]}
                    cy={last[1]}
                    r={3}
                  />
                )}
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================= 3. PROGRESS-RINGS ================= */

const RING_R = 48;
const RING_C = 2 * Math.PI * RING_R;

export function ProgressRings({ node }: { node: TElement }) {
  const items = groupItems(node);
  if (items.length === 0) return null;
  const pcts = items.map((item) => clamp(parseNumericValue(item.pct), 0, 100));
  const top = pcts.indexOf(Math.max(...pcts));
  return (
    <div className="v-rings">
      {items.map((item, i) => {
        const p = pcts[i]!;
        const offset = RING_C * (1 - p / 100);
        return (
          <div key={i} className="v-ring">
            <svg className="v-ring-svg" viewBox="0 0 120 120" role="img">
              <circle className="v-ring-track" cx={60} cy={60} r={RING_R} />
              <circle
                className={cx("v-ring-arc", i === top && "v-ring-arc--top")}
                cx={60}
                cy={60}
                r={RING_R}
                strokeDasharray={RING_C.toFixed(2)}
                strokeDashoffset={offset.toFixed(2)}
                transform="rotate(-90 60 60)"
              />
              <text
                className="v-ring-pct"
                x={60}
                y={60}
                dy="0.35em"
                textAnchor="middle"
              >
                {`${Math.round(p)}%`}
              </text>
            </svg>
            <div className="v-ring-caption">
              <ItemContent nodes={item.children} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================= 4. PICTOGRAM ================= */

export function Pictogram({ node }: { node: TElement }) {
  const total = parseNumericValue(attrOf(node, "total") ?? 10);
  const filled = parseNumericValue(attrOf(node, "filled") ?? 0);
  const perRow = clamp(
    Math.round(parseNumericValue(attrOf(node, "perRow") ?? 5)) || 5,
    1,
    20,
  );
  const units = pictogramUnits(total, filled);
  const iconUrl = typeof node.iconUrl === "string" ? node.iconUrl : "";
  const clipBase = domId(node, "vpicto");

  return (
    <div className="v-picto">
      <div
        className="v-picto-grid"
        style={{ gridTemplateColumns: `repeat(${perRow}, max-content)` }}
      >
        {units.map((frac, i) =>
          iconUrl ? (
            <span key={i} className="v-picto-unit">
              <span
                className="v-picto-glyph v-picto-glyph--dim"
                style={maskStyle(iconUrl)}
              />
              {frac > 0 && (
                <span
                  className="v-picto-glyph v-picto-glyph--fill"
                  style={{
                    ...maskStyle(iconUrl),
                    clipPath: `inset(0 ${((1 - frac) * 100).toFixed(1)}% 0 0)`,
                  }}
                />
              )}
            </span>
          ) : (
            <svg key={i} className="v-picto-unit" viewBox="0 0 28 28" aria-hidden>
              <circle className="v-picto-dot-dim" cx={14} cy={14} r={11} />
              {frac > 0 && (
                <>
                  <defs>
                    <clipPath id={`${clipBase}-${i}`}>
                      <rect
                        x={3}
                        y={3}
                        width={(22 * frac).toFixed(2)}
                        height={22}
                      />
                    </clipPath>
                  </defs>
                  <circle
                    className="v-picto-dot-fill"
                    cx={14}
                    cy={14}
                    r={11}
                    clipPath={`url(#${clipBase}-${i})`}
                  />
                </>
              )}
            </svg>
          ),
        )}
      </div>
      <div className="v-picto-caption">
        <ItemContent nodes={node.children} />
      </div>
    </div>
  );
}

/* ================= 5. HARVEY-TABLE ================= */

export function HarveyTable({ node }: { node: TElement }) {
  const rows = groupItems(node);
  if (rows.length === 0) return null;

  // First data column: the lowest cell index holding a td across all rows.
  let firstDataCol = Infinity;
  for (const row of rows) {
    groupItems(row).forEach((cell, ci) => {
      if (cell.type === "td" && ci < firstDataCol) firstDataCol = ci;
    });
  }

  return (
    <table className="v-table v-harvey">
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {groupItems(row).map((cell, ci) => {
              if (cell.type === "th") {
                return (
                  <th key={ci}>
                    <MiniChildren nodes={cell.children} />
                  </th>
                );
              }
              const ballRaw = attrOf(cell, "ball");
              if (ballRaw !== undefined) {
                const wedge = harveyWedge(parseNumericValue(ballRaw), 14, 14, 11);
                return (
                  <td key={ci} className="v-harvey-cell">
                    <svg
                      className={cx(
                        "v-harvey-ball",
                        ci === firstDataCol && "v-harvey-ball--accent",
                      )}
                      viewBox="0 0 28 28"
                      role="img"
                    >
                      <circle className="v-harvey-track" cx={14} cy={14} r={11} />
                      {wedge.kind === "full" && (
                        <circle className="v-harvey-fill" cx={14} cy={14} r={11} />
                      )}
                      {wedge.kind === "wedge" && (
                        <path className="v-harvey-fill" d={wedge.d} />
                      )}
                    </svg>
                  </td>
                );
              }
              return (
                <td key={ci}>
                  <MiniChildren nodes={cell.children} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ================= 6. MATRIX ================= */

const QUAD_ORDER = ["tl", "tr", "bl", "br"] as const;
type Quad = (typeof QUAD_ORDER)[number];

export function MatrixQuad({ node }: { node: TElement }) {
  const items = groupItems(node);
  const byQuad: Record<Quad, TElement[]> = { tl: [], tr: [], bl: [], br: [] };
  let autoSlot = 0;
  for (const item of items) {
    const q = String(item.quad ?? "").toLowerCase() as Quad;
    if ((QUAD_ORDER as readonly string[]).includes(q)) {
      byQuad[q].push(item);
    } else {
      byQuad[QUAD_ORDER[autoSlot % 4]!].push(item);
      autoSlot += 1;
    }
  }
  const toneClass = (quadItems: TElement[]): string | undefined => {
    const tone = String(quadItems[0]?.tone ?? "");
    if (tone === "positive") return "v-matrix-quad--pos";
    if (tone === "negative") return "v-matrix-quad--neg";
    if (tone === "neutral") return "v-matrix-quad--neutral";
    return undefined;
  };

  return (
    <div className="v-matrix">
      <div className="v-matrix-grid">
        {QUAD_ORDER.map((q) => (
          <div key={q} className={cx("v-matrix-quad", toneClass(byQuad[q]))}>
            {byQuad[q].map((item, i) => (
              <div key={i} className="v-matrix-item">
                <ItemContent nodes={item.children} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className="v-matrix-rail v-matrix-rail--x" aria-hidden />
      <span className="v-matrix-rail v-matrix-rail--y" aria-hidden />
      <span className="v-matrix-corner v-matrix-corner--xlow">
        {attrOf(node, "xLow") ?? ""}
      </span>
      <span className="v-matrix-corner v-matrix-corner--xhigh">
        {attrOf(node, "xHigh") ?? ""}
      </span>
      <span className="v-matrix-corner v-matrix-corner--ylow">
        {attrOf(node, "yLow") ?? ""}
      </span>
      <span className="v-matrix-corner v-matrix-corner--yhigh">
        {attrOf(node, "yHigh") ?? ""}
      </span>
      <span className="v-matrix-axis v-matrix-axis--x">
        {attrOf(node, "xLabel") ?? ""}
      </span>
      <span className="v-matrix-axis v-matrix-axis--y">
        {attrOf(node, "yLabel") ?? ""}
      </span>
    </div>
  );
}

/* ================= 7. ORG-CHART ================= */

function buildOrgInput(el: TElement): OrgInput {
  return {
    name: String(el.name ?? ""),
    ...(typeof el.role === "string" && el.role ? { role: el.role } : {}),
    children: groupItems(el)
      .filter((c) => c.type === "org-node")
      .map(buildOrgInput),
  };
}

export function OrgChart({ node }: { node: TElement }) {
  const roots = groupItems(node)
    .filter((c) => c.type === "org-node")
    .map(buildOrgInput);
  const layout = layoutOrg(roots);
  if (layout.nodes.length === 0) return null;

  const xPct = (x: number): number => (x / layout.slotCount) * 100;
  const yPct = (depth: number): number =>
    ((depth + 0.5) / layout.depthCount) * 100;

  return (
    <div className="v-org">
      <svg
        className="v-org-edges"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {layout.nodes.map((n, i) => {
          if (n.parent < 0) return null;
          const p = layout.nodes[n.parent]!;
          const px = xPct(p.x).toFixed(2);
          const py = yPct(p.depth).toFixed(2);
          const cxx = xPct(n.x).toFixed(2);
          const cy = yPct(n.depth).toFixed(2);
          const midY = ((yPct(p.depth) + yPct(n.depth)) / 2).toFixed(2);
          return (
            <path
              key={i}
              className="v-org-edge"
              d={`M ${px} ${py} L ${px} ${midY} L ${cxx} ${midY} L ${cxx} ${cy}`}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {layout.nodes.map((n, i) => (
        <div
          key={i}
          className="v-org-card v-card"
          style={{ left: `${xPct(n.x).toFixed(2)}%`, top: `${yPct(n.depth).toFixed(2)}%` }}
        >
          <span className="v-org-name">{n.name}</span>
          {n.role && <span className="v-org-role">{n.role}</span>}
        </div>
      ))}
    </div>
  );
}

/* ================= 8. JOURNEY ================= */

export function Journey({ node }: { node: TElement }) {
  const items = groupItems(node);
  const n = items.length;
  if (n === 0) return null;

  const moods = items.map((item) => clamp(parseNumericValue(item.mood), -2, 2));
  const curvePts: Array<[number, number]> = items.map((_, i) => [
    ((i + 0.5) * 1000) / n,
    moodY(moods[i]!, 30, 210),
  ]);
  const cols: React.CSSProperties = {
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
  };

  return (
    <div className="v-journey">
      <div className="v-journey-row v-journey-stages" style={cols}>
        {items.map((item, i) => {
          const stage =
            (typeof item.stage === "string" && item.stage) ||
            firstHeadingText(item) ||
            `${i + 1}`;
          const iconUrl = typeof item.iconUrl === "string" ? item.iconUrl : "";
          return (
            <div key={i} className="v-journey-stage">
              {iconUrl && (
                <span
                  className="v-journey-icon"
                  style={maskStyle(iconUrl)}
                  aria-hidden
                />
              )}
              <span className="v-journey-stage-name">{stage}</span>
            </div>
          );
        })}
      </div>
      <div className="v-journey-plot">
        <svg
          className="v-journey-svg"
          viewBox="0 0 1000 240"
          preserveAspectRatio="none"
          aria-hidden
        >
          <line className="v-journey-mid" x1={0} y1={120} x2={1000} y2={120} />
          <path
            className="v-journey-path"
            d={journeyPath(curvePts)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {curvePts.map((p, i) => (
          <span
            key={i}
            className={cx("v-journey-dot", moods[i]! < 0 && "v-journey-dot--low")}
            style={{
              left: `${(p[0] / 10).toFixed(2)}%`,
              top: `${((p[1] / 240) * 100).toFixed(2)}%`,
            }}
          />
        ))}
      </div>
      <div className="v-journey-row v-journey-bodies" style={cols}>
        {items.map((item, i) => {
          const usedHeadingAsStage =
            !(typeof item.stage === "string" && item.stage) &&
            firstHeadingText(item) !== "";
          return (
            <div key={i} className="v-journey-body">
              <ItemContent
                nodes={
                  usedHeadingAsStage ? withoutFirstHeading(item) : item.children
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= 9. VENN ================= */

export function Venn({ node }: { node: TElement }) {
  const items = groupItems(node).slice(0, 3);
  const n = items.length;
  if (n === 0) return null;

  const CX = 300;
  const CY = 200;
  const R = 120; // 3-set circumradius 0.62R keeps every circle inside 600×400
  const centers: Array<[number, number]> =
    n === 1 ? [[CX, CY]] : vennCenters(n, CX, CY, R);
  const centroid: [number, number] = [
    centers.reduce((a, c) => a + c[0], 0) / centers.length,
    centers.reduce((a, c) => a + c[1], 0) / centers.length,
  ];
  const overlapLabel = attrOf(node, "overlapLabel") ?? "";

  const labelPos = (c: [number, number]): [number, number] => {
    const dx = c[0] - centroid[0];
    const dy = c[1] - centroid[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return [c[0], c[1] - R - 16];
    const push = 0.55 * R;
    return [c[0] + (dx / len) * push, c[1] + (dy / len) * push];
  };

  return (
    <div className="v-venn">
      <svg className="v-venn-svg" viewBox="0 0 600 400" role="img">
        {centers.map((c, i) => (
          <circle
            key={i}
            className={`v-venn-circle v-venn-c${i + 1}`}
            cx={c[0].toFixed(2)}
            cy={c[1].toFixed(2)}
            r={R}
          />
        ))}
        {items.map((item, i) => {
          const [lx, ly] = labelPos(centers[i]!);
          return (
            <text
              key={i}
              className="v-venn-label"
              x={lx.toFixed(2)}
              y={ly.toFixed(2)}
              dy="0.35em"
              textAnchor="middle"
            >
              {truncate(firstHeadingText(item) || textOf(item.children), 22)}
            </text>
          );
        })}
        {overlapLabel && (
          <text
            className="v-venn-overlap"
            x={centroid[0].toFixed(2)}
            y={centroid[1].toFixed(2)}
            dy="0.35em"
            textAnchor="middle"
          >
            {truncate(overlapLabel, 18)}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ================= 10. ICEBERG ================= */

const ICEBERG_WATERLINE = 160; // 32% of the 500-tall viewBox

function icebergWave(): string {
  const segments: string[] = [`M 0 ${ICEBERG_WATERLINE} Q 15 ${ICEBERG_WATERLINE - 7} 30 ${ICEBERG_WATERLINE}`];
  for (let x = 60; x <= 600; x += 30) {
    segments.push(`T ${x} ${ICEBERG_WATERLINE}`);
  }
  return segments.join(" ");
}

export function Iceberg({ node }: { node: TElement }) {
  const sides = groupItems(node);
  const above = sides.find((s) => s.side === "above");
  const below = sides.find((s) => s.side === "below");

  return (
    <div className="v-iceberg">
      <svg className="v-iceberg-svg" viewBox="0 0 600 500" role="img">
        <rect
          className="v-iceberg-sea"
          x={0}
          y={ICEBERG_WATERLINE}
          width={600}
          height={500 - ICEBERG_WATERLINE}
        />
        <polygon
          className="v-iceberg-above"
          points="300,36 356,84 396,160 204,160 244,92"
        />
        <polygon
          className="v-iceberg-below"
          points="204,160 396,160 448,268 372,414 300,472 216,392 156,262"
        />
        <line
          className="v-iceberg-line"
          x1={0}
          y1={ICEBERG_WATERLINE}
          x2={600}
          y2={ICEBERG_WATERLINE}
        />
        <path className="v-iceberg-wave" d={icebergWave()} />
      </svg>
      <div className="v-iceberg-panels">
        <div className="v-iceberg-panel v-iceberg-panel--above">
          {above && <ItemContent nodes={above.children} />}
        </div>
        <div className="v-iceberg-panel v-iceberg-panel--below">
          {below && <ItemContent nodes={below.children} />}
        </div>
      </div>
    </div>
  );
}

/* ================= 11. FLOW ================= */

function FlowShapeEl({ n }: { n: PositionedFlowNode }) {
  const cls = `v-flow-node v-flow-node--${n.shape}`;
  const l = n.x - n.w / 2;
  const t = n.y - n.h / 2;
  if (n.shape === "decision") {
    const points = `${n.x},${t} ${n.x + n.w / 2},${n.y} ${n.x},${t + n.h} ${l},${n.y}`;
    return <polygon className={cls} points={points} />;
  }
  if (n.shape === "terminal") {
    return (
      <ellipse className={cls} cx={n.x} cy={n.y} rx={n.w / 2} ry={n.h / 2} />
    );
  }
  if (n.shape === "store") {
    const ry = 9;
    const body = `M ${l} ${t + ry} L ${l} ${t + n.h - ry} A ${n.w / 2} ${ry} 0 0 0 ${l + n.w} ${t + n.h - ry} L ${l + n.w} ${t + ry}`;
    return (
      <g>
        <path className={cls} d={body} />
        <ellipse className={cls} cx={n.x} cy={t + ry} rx={n.w / 2} ry={ry} />
      </g>
    );
  }
  const rx = n.shape === "rounded" ? 14 : 6;
  return (
    <rect className={cls} x={l} y={t} width={n.w} height={n.h} rx={rx} />
  );
}

export function FlowDiagram({ node }: { node: TElement }) {
  const syntax = typeof node.syntax === "string" ? node.syntax : "";
  const direction: FlowDirection = node.direction === "LR" ? "LR" : "TB";
  const graph = parseFlow(syntax);
  if (graph.nodes.length === 0) return null;
  const layout = layoutFlow(graph, direction);
  const markerId = domId(node, "vflow-arrow");

  return (
    <div className="v-flow">
      <svg
        className="v-flow-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path className="v-flow-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {layout.edges.map((e, i) => (
          <path
            key={i}
            className="v-flow-edge"
            d={roundedElbowPath(e.points, 6)}
            markerEnd={`url(#${markerId})`}
          />
        ))}
        {layout.edges.map((e, i) => {
          if (!e.label) return null;
          const [mx, my] = polylineMidpoint(e.points);
          const label = truncate(e.label, 16);
          const w = Math.max(30, label.length * 7 + 14);
          return (
            <g key={`label-${i}`} className="v-flow-chip">
              <rect
                className="v-flow-chip-bg"
                x={(mx - w / 2).toFixed(2)}
                y={my - 11}
                width={w}
                height={22}
                rx={11}
              />
              <text
                className="v-flow-chip-text"
                x={mx}
                y={my}
                dy="0.35em"
                textAnchor="middle"
              >
                {label}
              </text>
            </g>
          );
        })}
        {layout.nodes.map((n) => (
          <g key={n.id}>
            <FlowShapeEl n={n} />
            <text className="v-flow-label" x={n.x} y={n.y} textAnchor="middle">
              {n.lines.length === 1 ? (
                <tspan x={n.x} dy="0.35em">
                  {n.lines[0]}
                </tspan>
              ) : (
                <>
                  <tspan x={n.x} dy="-0.28em">
                    {n.lines[0]}
                  </tspan>
                  <tspan x={n.x} dy="1.15em">
                    {n.lines[1]}
                  </tspan>
                </>
              )}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
