/**
 * 233 named gradient presets, ported from allweonedev/presentation-ai
 * (MIT License) gradient.json — see THIRD_PARTY_LICENSES.md. Used by the
 * AI theme generator (keyword-matched surfaces) and the theme Surface
 * picker.
 */
import raw from "./gradients.json";

export interface GradientPreset {
  name: string;
  colors: string[];
  colorsname: string[];
  keywords: string[][];
}

/**
 * One upstream entry is a nested array of presets rather than a preset —
 * flatten it, and drop anything without usable colors.
 */
function normalize(entries: unknown[]): GradientPreset[] {
  const out: GradientPreset[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      out.push(...normalize(entry));
      continue;
    }
    const preset = entry as Partial<GradientPreset>;
    if (!preset?.name || !Array.isArray(preset.colors) || preset.colors.length === 0) {
      continue;
    }
    out.push({
      name: preset.name,
      colors: preset.colors,
      colorsname: Array.isArray(preset.colorsname) ? preset.colorsname : [],
      keywords: Array.isArray(preset.keywords)
        ? preset.keywords.filter((group): group is string[] => Array.isArray(group))
        : [],
    });
  }
  return out;
}

export const gradients: GradientPreset[] = normalize(raw as unknown[]);

/** CSS background value for a preset (135° linear). */
export function gradientCss(preset: GradientPreset): string {
  if (preset.colors.length === 1) return preset.colors[0];
  const step = 100 / (preset.colors.length - 1);
  const stops = preset.colors
    .map((color, i) => `${color} ${Math.round(i * step)}%`)
    .join(", ");
  return `linear-gradient(135deg, ${stops})`;
}

/** Best keyword match for a mood/topic query; null when nothing scores. */
export function findGradient(query: string): GradientPreset | null {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (words.length === 0) return null;
  let best: GradientPreset | null = null;
  let bestScore = 0;
  for (const preset of gradients) {
    let score = 0;
    for (const group of preset.keywords) {
      for (const keyword of group) {
        if (words.includes(keyword.toLowerCase())) score += 1;
      }
    }
    if (preset.name && words.includes(preset.name.toLowerCase())) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = preset;
    }
  }
  return bestScore > 0 ? best : null;
}
