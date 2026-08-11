/**
 * FLOW diagram DSL: a lenient mermaid-subset parser + deterministic
 * Sugiyama-lite layout onto a 0-1000 × 0-600 abstract canvas.
 *
 * Node lines:   `id[Label]` `id(Label)` `id{Label}` `id[(Label)]` `id((Label))`
 *               → process   rounded     decision    store          terminal
 * Edge lines:   `a --> b`, `a -->|label| b`, `a --> b |label|`, chains
 *               `a --> b --> c`. Endpoints may carry inline shape defs.
 *
 * LENIENT by contract: unparseable lines are skipped, never thrown. Layout is
 * a pure function of the graph — no text measurement, no randomness — so the
 * same input always yields a deep-equal result.
 */

export type FlowDirection = "TB" | "LR";
export type FlowShape =
  | "process"
  | "rounded"
  | "decision"
  | "store"
  | "terminal";

export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface PositionedFlowNode extends FlowNode {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wrapped label lines (1 or 2), pre-computed without measurement. */
  lines: string[];
  layer: number;
}

export interface PositionedFlowEdge {
  from: string;
  to: string;
  label?: string;
  /** Orthogonal polyline in canvas coordinates. */
  points: Array<[number, number]>;
}

export interface FlowLayout {
  nodes: PositionedFlowNode[];
  edges: PositionedFlowEdge[];
  width: number;
  height: number;
}

export const FLOW_CANVAS_W = 1000;
export const FLOW_CANVAS_H = 600;

const MAX_NODES = 24;
const MAX_EDGES = 48;
const MAIN_MARGIN = 46;
const WRAP_AT = 28;

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

interface ParsedToken {
  id: string;
  label?: string;
  shape?: FlowShape;
}

/** Parse one endpoint token: bare id or id + shape brackets. */
function parseNodeToken(raw: string): ParsedToken | null {
  const text = raw.trim();
  if (!text) return null;
  if (ID_RE.test(text)) return { id: text };

  const m = /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*(.+)$/.exec(text);
  if (!m) return null;
  const id = m[1]!;
  const rest = m[2]!.trim();

  const bracketShapes: Array<[string, string, FlowShape]> = [
    ["[(", ")]", "store"],
    ["((", "))", "terminal"],
    ["{", "}", "decision"],
    ["(", ")", "rounded"],
    ["[", "]", "process"],
  ];
  for (const [open, close, shape] of bracketShapes) {
    if (rest.startsWith(open) && rest.endsWith(close)) {
      const inner = rest
        .slice(open.length, rest.length - close.length)
        .trim()
        .replace(/^["']+|["']+$/g, "");
      return { id, label: inner || id, shape };
    }
  }
  return null;
}

/** Pull one `|label|` chip out of a segment; returns [label?, remainder]. */
function extractPipeLabel(segment: string): [string | undefined, string] {
  const m = /\|([^|]*)\|/.exec(segment);
  if (!m) return [undefined, segment];
  const label = m[1]!.trim();
  const remainder = segment.slice(0, m.index) + segment.slice(m.index + m[0].length);
  return [label || undefined, remainder];
}

export function parseFlow(text: string): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const implicit = new Set<string>();
  const edges: FlowEdge[] = [];

  const define = (token: ParsedToken): boolean => {
    const existing = nodes.get(token.id);
    if (existing) {
      // An explicit shape/label upgrades an implicit reference; the first
      // explicit definition wins after that.
      if (implicit.has(token.id) && token.shape) {
        existing.label = token.label ?? token.id;
        existing.shape = token.shape;
        implicit.delete(token.id);
      }
      return true;
    }
    if (nodes.size >= MAX_NODES) return false;
    nodes.set(token.id, {
      id: token.id,
      label: token.label ?? token.id,
      shape: token.shape ?? "process",
    });
    if (!token.shape) implicit.add(token.id);
    return true;
  };

  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/;+$/, "").trim();
    if (!line) continue;
    if (/^(flowchart|graph)\b/i.test(line)) continue; // mermaid headers
    if (line.startsWith("%%") || line.startsWith("#")) continue; // comments

    if (/-{1,3}>/.test(line)) {
      // Edge (possibly a chain). Split on arrows, carry labels per hop.
      const segments = line.split(/\s*-{1,3}>\s*/);
      if (segments.length < 2) continue;

      const hops: Array<{ token: ParsedToken; label?: string }> = [];
      let valid = true;
      for (let i = 0; i < segments.length; i += 1) {
        const [label, remainder] = extractPipeLabel(segments[i] ?? "");
        const token = parseNodeToken(remainder);
        if (!token) {
          valid = false;
          break;
        }
        // A `|label|` in segment i>0 labels the hop arriving at segment i.
        hops.push({ token, label: i > 0 ? label : undefined });
      }
      if (!valid || hops.length < 2) continue;

      let ok = true;
      for (const hop of hops) ok = define(hop.token) && ok;
      if (!ok) continue;
      for (let i = 1; i < hops.length; i += 1) {
        if (edges.length >= MAX_EDGES) break;
        edges.push({
          from: hops[i - 1]!.token.id,
          to: hops[i]!.token.id,
          ...(hops[i]!.label ? { label: hops[i]!.label } : {}),
        });
      }
      continue;
    }

    // Node definition line (must carry an explicit shape — bare words are
    // treated as junk and skipped).
    const token = parseNodeToken(line);
    if (token?.shape) define(token);
  }

  return { nodes: [...nodes.values()], edges };
}

/** 2-line wrap at ~WRAP_AT chars: split at the space nearest the middle. */
export function wrapLabel(label: string, max = WRAP_AT): string[] {
  const text = label.trim();
  if (text.length <= max) return [text];
  const mid = Math.floor(text.length / 2);
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === " ") {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
  }
  if (best === -1) return [text.slice(0, max), text.slice(max)];
  return [text.slice(0, best), text.slice(best + 1)];
}

export function nodeWidth(label: string): number {
  return Math.max(120, Math.min(260, label.length * 8.5 + 24));
}

function nodeHeight(shape: FlowShape, lineCount: number): number {
  const two = lineCount > 1;
  if (shape === "decision") return two ? 96 : 78;
  if (shape === "store") return two ? 76 : 58;
  if (shape === "terminal") return two ? 72 : 54;
  return two ? 68 : 48;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function layoutFlow(
  graph: FlowGraph,
  direction: FlowDirection = "TB",
): FlowLayout {
  const nodes = graph.nodes.slice(0, MAX_NODES);
  const index = new Map<string, number>();
  nodes.forEach((n, i) => index.set(n.id, i));

  const edges = graph.edges.filter(
    (e) => index.has(e.from) && index.has(e.to),
  );

  // ---- back-edge removal (DFS over insertion order) ----
  const out: number[][] = nodes.map(() => []);
  const forward: FlowEdge[] = [];
  const backOrLoop = new Set<FlowEdge>();
  for (const e of edges) {
    if (e.from === e.to) {
      backOrLoop.add(e);
      continue;
    }
    out[index.get(e.from)!]!.push(index.get(e.to)!);
  }

  const state = new Array<number>(nodes.length).fill(0); // 0=new 1=stack 2=done
  const backPairs = new Set<string>();
  const dfs = (u: number): void => {
    state[u] = 1;
    for (const v of out[u]!) {
      if (state[v] === 1) {
        backPairs.add(`${u}>${v}`);
      } else if (state[v] === 0) {
        dfs(v);
      }
    }
    state[u] = 2;
  };
  for (let i = 0; i < nodes.length; i += 1) {
    if (state[i] === 0) dfs(i);
  }
  for (const e of edges) {
    if (backOrLoop.has(e)) continue;
    const key = `${index.get(e.from)!}>${index.get(e.to)!}`;
    if (backPairs.has(key)) backOrLoop.add(e);
    else forward.push(e);
  }

  // ---- longest-path layering from roots (Kahn over forward edges) ----
  const fOut: number[][] = nodes.map(() => []);
  const inDeg = new Array<number>(nodes.length).fill(0);
  for (const e of forward) {
    fOut[index.get(e.from)!]!.push(index.get(e.to)!);
    inDeg[index.get(e.to)!] += 1;
  }
  const layer = new Array<number>(nodes.length).fill(0);
  const queue: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (inDeg[i] === 0) queue.push(i);
  }
  const remaining = inDeg.slice();
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi]!;
    qi += 1;
    for (const v of fOut[u]!) {
      layer[v] = Math.max(layer[v]!, layer[u]! + 1);
      remaining[v] -= 1;
      if (remaining[v] === 0) queue.push(v);
    }
  }

  const layerCount = nodes.length > 0 ? Math.max(...layer) + 1 : 0;
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  nodes.forEach((_, i) => layers[layer[i]!]!.push(i));

  // ---- barycenter ordering, 2 sweeps (down then up), stable ----
  const posIn = new Array<number>(nodes.length).fill(0);
  const refreshPos = (): void => {
    for (const l of layers) l.forEach((n, j) => (posIn[n] = j));
  };
  const fIn: number[][] = nodes.map(() => []);
  for (const e of forward) {
    fIn[index.get(e.to)!]!.push(index.get(e.from)!);
  }
  const sortLayer = (l: number, neighborsOf: number[][]): void => {
    const arr = layers[l]!;
    const keyed = arr.map((n, j) => {
      const nb = neighborsOf[n]!;
      const bary =
        nb.length > 0
          ? nb.reduce((acc, m) => acc + posIn[m]!, 0) / nb.length
          : j;
      return { n, j, bary };
    });
    keyed.sort((a, b) => a.bary - b.bary || a.j - b.j);
    layers[l] = keyed.map((k) => k.n);
  };
  refreshPos();
  for (let l = 1; l < layerCount; l += 1) {
    sortLayer(l, fIn);
    refreshPos();
  }
  for (let l = layerCount - 2; l >= 0; l -= 1) {
    sortLayer(l, fOut);
    refreshPos();
  }

  // ---- coordinates (TB: main axis = y; LR: main axis = x) ----
  const mainExtent = direction === "TB" ? FLOW_CANVAS_H : FLOW_CANVAS_W;
  const crossExtent = direction === "TB" ? FLOW_CANVAS_W : FLOW_CANVAS_H;
  const mainAt = (l: number): number =>
    layerCount <= 1
      ? mainExtent / 2
      : MAIN_MARGIN + (l * (mainExtent - 2 * MAIN_MARGIN)) / (layerCount - 1);

  const placed: PositionedFlowNode[] = nodes.map((n) => ({
    ...n,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    lines: wrapLabel(n.label),
    layer: layer[index.get(n.id)!]!,
  }));

  layers.forEach((arr, l) => {
    const main = mainAt(l);
    arr.forEach((nIdx, j) => {
      const cross = ((j + 0.5) * crossExtent) / arr.length;
      const node = placed[nIdx]!;
      const baseW = nodeWidth(node.label);
      node.w = round2(
        node.shape === "decision" ? Math.min(280, baseW * 1.25) : baseW,
      );
      node.h = nodeHeight(node.shape, node.lines.length);
      if (direction === "TB") {
        node.x = round2(cross);
        node.y = round2(main);
      } else {
        node.x = round2(main);
        node.y = round2(cross);
      }
    });
  });

  // ---- orthogonal elbow edges ----
  const maxRight = placed.reduce((m, n) => Math.max(m, n.x + n.w / 2), 0);
  const maxBottom = placed.reduce((m, n) => Math.max(m, n.y + n.h / 2), 0);

  const routed: PositionedFlowEdge[] = edges.map((e) => {
    const a = placed[index.get(e.from)!]!;
    const b = placed[index.get(e.to)!]!;
    const base = { from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) };

    if (e.from === e.to) {
      // Self-loop: small rectangle off the node's trailing side.
      const points: Array<[number, number]> =
        direction === "TB"
          ? [
              [round2(a.x + a.w / 2), round2(a.y - 10)],
              [round2(a.x + a.w / 2 + 26), round2(a.y - 10)],
              [round2(a.x + a.w / 2 + 26), round2(a.y + 10)],
              [round2(a.x + a.w / 2), round2(a.y + 10)],
            ]
          : [
              [round2(a.x - 10), round2(a.y + a.h / 2)],
              [round2(a.x - 10), round2(a.y + a.h / 2 + 26)],
              [round2(a.x + 10), round2(a.y + a.h / 2 + 26)],
              [round2(a.x + 10), round2(a.y + a.h / 2)],
            ];
      return { ...base, points };
    }

    const aLayer = a.layer;
    const bLayer = b.layer;

    if (bLayer > aLayer) {
      // Forward edge: leave A's exit face, enter B's entry face.
      if (direction === "TB") {
        const start: [number, number] = [a.x, round2(a.y + a.h / 2)];
        const end: [number, number] = [b.x, round2(b.y - b.h / 2)];
        if (Math.abs(a.x - b.x) < 0.5) return { ...base, points: [start, end] };
        const midY = round2((start[1] + end[1]) / 2);
        return {
          ...base,
          points: [start, [a.x, midY], [b.x, midY], end],
        };
      }
      const start: [number, number] = [round2(a.x + a.w / 2), a.y];
      const end: [number, number] = [round2(b.x - b.w / 2), b.y];
      if (Math.abs(a.y - b.y) < 0.5) return { ...base, points: [start, end] };
      const midX = round2((start[0] + end[0]) / 2);
      return {
        ...base,
        points: [start, [midX, a.y], [midX, b.y], end],
      };
    }

    // Back / same-layer edge: route around the trailing channel.
    if (direction === "TB") {
      const channelX = round2(Math.min(FLOW_CANVAS_W - 12, maxRight + 28));
      return {
        ...base,
        points: [
          [round2(a.x + a.w / 2), a.y],
          [channelX, a.y],
          [channelX, b.y],
          [round2(b.x + b.w / 2), b.y],
        ],
      };
    }
    const channelY = round2(Math.min(FLOW_CANVAS_H - 12, maxBottom + 28));
    return {
      ...base,
      points: [
        [a.x, round2(a.y + a.h / 2)],
        [a.x, channelY],
        [b.x, channelY],
        [b.x, round2(b.y + b.h / 2)],
      ],
    };
  });

  return {
    nodes: placed,
    edges: routed,
    width: FLOW_CANVAS_W,
    height: FLOW_CANVAS_H,
  };
}

/** Polyline → SVG path with rounded elbow corners (radius r). */
export function roundedElbowPath(
  points: Array<[number, number]>,
  r = 6,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]![0]} ${points[0]![1]}`;
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    if (rr < 0.5 || inLen === 0 || outLen === 0) {
      d += ` L ${cx} ${cy}`;
      continue;
    }
    const inX = cx - ((cx - px) / inLen) * rr;
    const inY = cy - ((cy - py) / inLen) * rr;
    const outX = cx + ((nx - cx) / outLen) * rr;
    const outY = cy + ((ny - cy) / outLen) * rr;
    d += ` L ${round2(inX)} ${round2(inY)} Q ${cx} ${cy} ${round2(outX)} ${round2(outY)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/** Midpoint of a polyline's middle segment (for edge label chips). */
export function polylineMidpoint(
  points: Array<[number, number]>,
): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0]!;
  const segIdx = Math.floor((points.length - 1) / 2);
  const [ax, ay] = points[segIdx]!;
  const [bx, by] = points[segIdx + 1]!;
  return [round2((ax + bx) / 2), round2((ay + by) / 2)];
}
