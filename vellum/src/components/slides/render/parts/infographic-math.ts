/**
 * Pure, deterministic geometry/data helpers for the P4-W4 native infographic
 * components. No DOM, no measurement — everything is arithmetic on the
 * authored attributes, so tests can assert exact values and the static
 * renderer stays render-identical across passes.
 */
import type { TElement, TText } from "@/lib/slides/plate-shim";

/* ---------------- number parsing + compact formatting ---------------- */

/** "12,400" | "$1.2M" | "78%" | 42 → number (best effort, NaN-safe → 0). */
export function parseNumericValue(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const text = raw.trim().toLowerCase();
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*([kmb])?/.exec(text.replace(/[$€£%\s]/g, ""));
  if (!m) return 0;
  const base = Number.parseFloat(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return base * mult;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 12400 → "12.4k", 1240000 → "1.24M", 990 → "990". */
export function formatCompactValue(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const scale = (base: number, suffix: string): string => {
    const x = abs / base;
    const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
    return `${sign}${trimZeros(x.toFixed(digits))}${suffix}`;
  };
  if (abs >= 1e9) return scale(1e9, "B");
  if (abs >= 1e6) return scale(1e6, "M");
  if (abs >= 1e3) return scale(1e3, "k");
  return `${sign}${trimZeros(abs.toFixed(abs >= 100 || Number.isInteger(abs) ? 0 : 1))}`;
}

/* ---------------- funnel-flow ---------------- */

export const FUNNEL_MIN_STAGES = 2;
export const FUNNEL_MAX_STAGES = 7;
export const FUNNEL_FLOOR = 0.18;

/**
 * Half-width per stage boundary: hw[i] = halfWidth · (0.18 + 0.82·v[i]/v[0]).
 * Guards: v[0] ≤ 0 → every stage renders at full width (flat funnel).
 */
export function funnelHalfWidths(values: number[], halfWidth: number): number[] {
  const v0 = values[0] ?? 0;
  return values.map((v) => {
    const ratio = v0 > 0 ? Math.max(0, Math.min(1, v / v0)) : 1;
    return halfWidth * (FUNNEL_FLOOR + (1 - FUNNEL_FLOOR) * ratio);
  });
}

/** Rounded conversion % for each boundary i→i+1 (0 when v[i] ≤ 0). */
export function conversionPercents(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length - 1; i += 1) {
    const a = values[i] ?? 0;
    const b = values[i + 1] ?? 0;
    out.push(a > 0 ? Math.round((b / a) * 100) : 0);
  }
  return out;
}

/** Boundary index with the worst (lowest) conversion; -1 for <2 stages. */
export function worstDropIndex(values: number[]): number {
  const percents = conversionPercents(values);
  if (percents.length === 0) return -1;
  let worst = 0;
  for (let i = 1; i < percents.length; i += 1) {
    if (percents[i]! < percents[worst]!) worst = i;
  }
  return worst;
}

/* ---------------- harvey balls ---------------- */

export type HarveyWedge =
  | { kind: "empty" }
  | { kind: "full" }
  | { kind: "wedge"; d: string };

/**
 * Quarter-fill wedge for ball ∈ 0..4 at 90° per step. ball=4 must render a
 * plain full circle — the 360° arc degenerates (start == end point).
 */
export function harveyWedge(
  ball: number,
  cx: number,
  cy: number,
  r: number,
): HarveyWedge {
  const b = Math.max(0, Math.min(4, Math.round(Number.isFinite(ball) ? ball : 0)));
  if (b === 0) return { kind: "empty" };
  if (b === 4) return { kind: "full" };
  const theta = (b * Math.PI) / 2;
  const x = cx + r * Math.sin(theta);
  const y = cy - r * Math.cos(theta);
  const largeArc = b * 90 > 180 ? 1 : 0;
  const fmt = (n: number): string => String(Math.round(n * 100) / 100);
  return {
    kind: "wedge",
    d: `M ${fmt(cx)} ${fmt(cy)} L ${fmt(cx)} ${fmt(cy - r)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 1 ${fmt(x)} ${fmt(y)} Z`,
  };
}

/* ---------------- org chart ---------------- */

export const ORG_MAX_DEPTH = 3;
export const ORG_MAX_NODES = 12;

export interface OrgInput {
  name: string;
  role?: string;
  children: OrgInput[];
}

export interface OrgPlacedNode {
  name: string;
  role?: string;
  depth: number;
  /** Center position in leaf-slot units (leaf i sits at i + 0.5). */
  x: number;
  /** Index of the parent in the returned nodes array, -1 for roots. */
  parent: number;
}

export interface OrgLayout {
  nodes: OrgPlacedNode[];
  slotCount: number;
  depthCount: number;
}

/**
 * Recursive slot layout: leaves get sequential slots, a parent centers over
 * the midpoint of its first and last child. Truncates to ≤maxDepth levels and
 * ≤maxNodes nodes (pre-order).
 */
export function layoutOrg(
  roots: OrgInput[],
  maxDepth = ORG_MAX_DEPTH,
  maxNodes = ORG_MAX_NODES,
): OrgLayout {
  const nodes: OrgPlacedNode[] = [];
  interface Frame {
    input: OrgInput;
    depth: number;
    parent: number;
    index: number;
  }

  // Pre-order admission under the caps.
  const admitted: Frame[] = [];
  const admit = (input: OrgInput, depth: number, parent: number): number => {
    if (depth >= maxDepth || admitted.length >= maxNodes) return -1;
    const index = admitted.length;
    admitted.push({ input, depth, parent, index });
    for (const child of input.children) {
      admit(child, depth + 1, index);
    }
    return index;
  };
  for (const root of roots) admit(root, 0, -1);

  const childrenOf: number[][] = admitted.map(() => []);
  for (const f of admitted) {
    if (f.parent >= 0) childrenOf[f.parent]!.push(f.index);
  }

  let nextSlot = 0;
  const xOf = new Array<number>(admitted.length).fill(0);
  const place = (i: number): number => {
    const kids = childrenOf[i]!;
    if (kids.length === 0) {
      xOf[i] = nextSlot + 0.5;
      nextSlot += 1;
      return xOf[i]!;
    }
    const first = place(kids[0]!);
    let last = first;
    for (let k = 1; k < kids.length; k += 1) last = place(kids[k]!);
    xOf[i] = (first + last) / 2;
    return xOf[i]!;
  };
  for (const f of admitted) {
    if (f.parent === -1) place(f.index);
  }

  let depthCount = 0;
  for (const f of admitted) {
    depthCount = Math.max(depthCount, f.depth + 1);
    nodes.push({
      name: f.input.name,
      ...(f.input.role ? { role: f.input.role } : {}),
      depth: f.depth,
      x: xOf[f.index]!,
      parent: f.parent,
    });
  }

  return { nodes, slotCount: Math.max(1, nextSlot), depthCount: Math.max(1, depthCount) };
}

/* ---------------- venn ---------------- */

export const VENN_TWO_OFFSET = 0.55;
export const VENN_THREE_CIRCUMRADIUS = 0.62;

/** Fixed venn geometry: 2 circles at ±0.55R, 3 on a 0.62R circumradius. */
export function vennCenters(
  n: number,
  cx: number,
  cy: number,
  r: number,
): Array<[number, number]> {
  if (n <= 2) {
    return [
      [cx - VENN_TWO_OFFSET * r, cy],
      [cx + VENN_TWO_OFFSET * r, cy],
    ];
  }
  const rr = VENN_THREE_CIRCUMRADIUS * r;
  const angles = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
  return angles.map((a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
}

/* ---------------- pictogram ---------------- */

export const PICTOGRAM_CAP = 20;

/**
 * Per-unit fill fractions: unit i fills clamp(filled − i, 0, 1). Total capped
 * at PICTOGRAM_CAP; filled clamped into [0, total].
 */
export function pictogramUnits(
  total: number,
  filled: number,
  cap = PICTOGRAM_CAP,
): number[] {
  const t = Math.max(1, Math.min(cap, Math.round(Number.isFinite(total) ? total : 0) || 1));
  const f = Math.max(0, Math.min(t, Number.isFinite(filled) ? filled : 0));
  return Array.from({ length: t }, (_, i) =>
    Math.max(0, Math.min(1, f - i)),
  );
}

/* ---------------- journey ---------------- */

/** mood ∈ [-2, 2] → y between top (mood 2) and bottom (mood −2). */
export function moodY(mood: number, top: number, bottom: number): number {
  const m = Math.max(-2, Math.min(2, Number.isFinite(mood) ? mood : 0));
  const mid = (top + bottom) / 2;
  const halfSpan = (bottom - top) / 2;
  return mid - (m / 2) * halfSpan;
}

/** Cardinal spline through points: c1 = p[i] + (p[i+1] − p[i−1])/6, etc. */
export function journeyPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  const fmt = (n: number): string => String(Math.round(n * 100) / 100);
  if (points.length === 1) {
    return `M ${fmt(points[0]![0])} ${fmt(points[0]![1])}`;
  }
  let d = `M ${fmt(points[0]![0])} ${fmt(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/* ---------------- kpi sparkline ---------------- */

/** "88,91,95" → points normalized into a w×h box with pad. */
export function sparkPoints(
  raw: string,
  w = 96,
  h = 30,
  pad = 3,
): Array<[number, number]> {
  const values = (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n));
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  if (values.length === 1) {
    return [[r2(w / 2), r2(h / 2)]];
  }
  return values.map((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
    const t = span > 0 ? (v - min) / span : 0.5;
    const y = h - pad - t * (h - 2 * pad);
    return [r2(x), r2(y)];
  });
}

/* ---------------- antv-infographic template mapping ---------------- */

export interface AntvItem {
  title?: string;
  desc?: string;
  value?: string;
  icon?: string;
}

/** First line `infographic <template-id>` → template id (lowercased). */
export function antvTemplateId(syntax: string): string {
  const first = (syntax ?? "").trim().split(/\r?\n/)[0] ?? "";
  const m = /^infographic\s+(\S+)/i.exec(first.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/** Tolerant line-oriented item mining from the AntV infographic DSL. */
export function parseAntvItems(syntax: string, max = 8): AntvItem[] {
  const clean = (s: string): string => s.trim().replace(/^["']+|["',]+$/g, "");
  const items: AntvItem[] = [];
  let current: AntvItem | null = null;
  const flush = (): void => {
    if (current && (current.title || current.desc) && items.length < max) {
      items.push(current);
    }
    current = null;
  };
  for (const raw of (syntax ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^-\s*/, "");
    const title = /^(?:label|title|name)\s*[:=]\s*(.+)$/i.exec(line);
    if (title) {
      flush();
      current = { title: clean(title[1]!) };
      continue;
    }
    const desc = /^(?:desc|description|detail)\s*[:=]\s*(.+)$/i.exec(line);
    if (desc && current && !current.desc) {
      current.desc = clean(desc[1]!);
      continue;
    }
    const value = /^value\s*[:=]\s*(.+)$/i.exec(line);
    if (value && current && !current.value) {
      current.value = clean(value[1]!);
      continue;
    }
    const icon = /^icon\s*[:=]\s*(.+)$/i.exec(line);
    if (icon && current && !current.icon) {
      current.icon = clean(icon[1]!);
    }
  }
  flush();
  return items;
}

function textNode(text: string): TText {
  return { text };
}

function itemChildren(item: AntvItem): TElement[] {
  const children: TElement[] = [];
  if (item.title) {
    children.push({ type: "h3", children: [textNode(item.title)] });
  }
  if (item.value) {
    // Stat chip — renders through the existing v-label treatment.
    children.push({ type: "label", children: [textNode(item.value)] });
  }
  if (item.desc) {
    children.push({ type: "p", children: [textNode(item.desc)] });
  }
  return children;
}

function retype(items: AntvItem[], type: string): TElement[] {
  return items.map((item) => ({
    type,
    ...(item.icon ? { icon: item.icon } : {}),
    children: itemChildren(item),
  }));
}

/**
 * Map an antv template-id prefix onto a REAL component node tree. Returns
 * null when there is no item content (caller falls back to the prompt card).
 *   sequence-* → timeline    compare-* → compare / pros-cons
 *   hierarchy-* → org-chart  quadrant-* → matrix
 *   relation-* → connected-circles   list- / chart- / unknown → boxes
 */
export function mapAntvItemsToNode(
  templateId: string,
  items: AntvItem[],
): TElement | null {
  if (items.length === 0) return null;
  const prefix = templateId.split("-")[0] ?? "";

  if (prefix === "sequence") {
    return {
      type: "timeline",
      orientation: "vertical",
      sidedness: "single",
      numbered: true,
      showLine: true,
      children: retype(items, "timeline-item"),
    };
  }
  if (prefix === "compare" && items.length >= 2) {
    if (items.length === 2) {
      return { type: "compare", children: retype(items, "compare-side") };
    }
    return {
      type: "pros-cons",
      children: items.map((item, i) => ({
        type: i % 2 === 0 ? "pros-item" : "cons-item",
        children: itemChildren(item),
      })),
    };
  }
  if (prefix === "hierarchy") {
    // First item is the root; the rest sit one level under it.
    const [root, ...rest] = items;
    const reports: TElement[] = rest.map((item) => ({
      type: "org-node",
      name: item.title ?? "",
      ...(item.desc ? { role: item.desc } : {}),
      children: [textNode("")],
    }));
    return {
      type: "org-chart",
      children: [
        {
          type: "org-node",
          name: root!.title ?? "",
          ...(root!.desc ? { role: root!.desc } : {}),
          children: reports.length > 0 ? reports : [textNode("")],
        },
      ],
    };
  }
  if (prefix === "quadrant") {
    const quads = ["tl", "tr", "bl", "br"];
    return {
      type: "matrix",
      children: items.slice(0, 4).map((item, i) => ({
        type: "matrix-item",
        quad: quads[i]!,
        children: itemChildren(item),
      })),
    };
  }
  if (prefix === "relation") {
    return {
      type: "connected-circles",
      children: retype(items, "connected-circle-item"),
    };
  }
  // list- / chart- / anything else → boxes (previous behavior).
  return { type: "boxes", children: retype(items, "box-item") };
}
