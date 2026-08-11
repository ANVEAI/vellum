/**
 * Abstract wireframes for the 16 archetypes, drawn on a 100×56 (16:9) grid.
 * They exist so the layout picker can show what a layout *is* — the old
 * control cycled through 14 archetypes with no preview at all.
 */
import type { ArchetypeId } from "@/lib/design/archetypes";

/** [x, y, w, h, tone?, round?] — tone drives opacity, round makes a pill. */
type Shape = [number, number, number, number, ("strong" | "soft" | "fill")?, boolean?];

const GLYPHS: Record<ArchetypeId, Shape[]> = {
  hero: [
    [10, 17, 58, 10, "strong"],
    [10, 31, 36, 4],
    [10, 40, 20, 3],
  ],
  agenda: [
    [9, 8, 28, 5, "strong"],
    [9, 21, 6, 4, "soft"],
    [19, 21, 44, 4],
    [9, 30, 6, 4, "soft"],
    [19, 30, 52, 4],
    [9, 39, 6, 4, "soft"],
    [19, 39, 38, 4],
  ],
  divider: [
    [0, 0, 100, 56, "fill"],
    [10, 22, 12, 3, "soft"],
    [10, 29, 44, 8, "strong"],
  ],
  statement: [
    [8, 14, 84, 15, "strong"],
    [8, 34, 30, 4],
  ],
  "quote-full": [
    [12, 11, 7, 8, "strong"],
    [12, 24, 72, 5],
    [12, 33, 58, 5],
    [12, 44, 24, 3, "soft"],
  ],
  "full-bleed": [
    [0, 0, 100, 56, "fill"],
    [8, 33, 52, 8, "strong"],
    [8, 44, 30, 3],
  ],
  split: [
    [54, 0, 46, 56, "fill"],
    [8, 13, 34, 8, "strong"],
    [8, 26, 38, 3],
    [8, 32, 32, 3],
    [8, 38, 35, 3],
  ],
  "three-up": [
    [8, 7, 30, 5, "strong"],
    [8, 19, 25, 29, "soft"],
    [37, 19, 25, 29, "soft"],
    [66, 19, 25, 29, "soft"],
  ],
  kpi: [
    [8, 7, 30, 5, "strong"],
    [8, 20, 12, 8, "strong"],
    [8, 31, 16, 3],
    [31, 20, 12, 8, "strong"],
    [31, 31, 16, 3],
    [54, 20, 12, 8, "strong"],
    [54, 31, 16, 3],
    [77, 20, 12, 8, "strong"],
    [77, 31, 15, 3],
  ],
  "chart-focus": [
    [8, 7, 30, 5, "strong"],
    [10, 40, 11, 12, "soft"],
    [24, 32, 11, 20, "soft"],
    [38, 25, 11, 27, "soft"],
    [52, 30, 11, 22, "soft"],
    [66, 17, 11, 35, "strong"],
    [80, 27, 11, 25, "soft"],
  ],
  closing: [
    [30, 20, 40, 10, "strong"],
    [36, 34, 28, 4],
  ],
  "team-grid": [
    [8, 6, 30, 5, "strong"],
    [11, 17, 13, 13, "soft", true],
    [9, 33, 17, 3],
    [33, 17, 13, 13, "soft", true],
    [31, 33, 17, 3],
    [55, 17, 13, 13, "soft", true],
    [53, 33, 17, 3],
    [77, 17, 13, 13, "soft", true],
    [75, 33, 17, 3],
  ],
  testimonial: [
    [10, 17, 18, 18, "soft", true],
    [34, 15, 56, 6, "strong"],
    [34, 25, 48, 4],
    [34, 35, 22, 3, "soft"],
  ],
  "phase-cards": [
    [8, 7, 30, 5, "strong"],
    [8, 20, 25, 27, "soft"],
    [34, 32, 3, 2],
    [38, 20, 25, 27, "soft"],
    [64, 32, 3, 2],
    [68, 20, 24, 27, "soft"],
  ],
  "metric-bubbles": [
    [11, 15, 22, 22, "soft", true],
    [39, 15, 22, 22, "soft", true],
    [67, 15, 22, 22, "soft", true],
    [13, 42, 18, 3],
    [41, 42, 18, 3],
    [69, 42, 18, 3],
  ],
  content: [
    [8, 8, 30, 5, "strong"],
    [8, 21, 40, 3],
    [8, 28, 36, 3],
    [8, 35, 39, 3],
    [8, 42, 28, 3],
    [56, 19, 36, 27, "soft"],
  ],
};

const OPACITY = { strong: 0.7, soft: 0.26, plain: 0.42, fill: 0.14 } as const;

export function ArchetypeGlyph({ id }: { id: ArchetypeId }) {
  return (
    <svg viewBox="0 0 100 56" className="block h-full w-full" aria-hidden focusable="false">
      {(GLYPHS[id] ?? GLYPHS.content).map(([x, y, w, h, tone, round], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={round ? Math.min(w, h) / 2 : 1.5}
          fill="currentColor"
          opacity={tone ? OPACITY[tone] : OPACITY.plain}
        />
      ))}
    </svg>
  );
}

export const ARCHETYPE_LABEL: Record<ArchetypeId, string> = {
  hero: "Cover",
  agenda: "Agenda",
  divider: "Divider",
  statement: "Statement",
  "quote-full": "Quote",
  "full-bleed": "Full bleed",
  split: "Split",
  "three-up": "Three up",
  kpi: "KPI row",
  "chart-focus": "Chart",
  closing: "Closing",
  "team-grid": "Grid",
  testimonial: "Testimonial",
  "phase-cards": "Phases",
  "metric-bubbles": "Metrics",
  content: "Content",
};
