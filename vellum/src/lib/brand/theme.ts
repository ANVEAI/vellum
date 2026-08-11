/**
 * Deterministic brand theme: custom-theme data JSON built from extracted
 * brand colors + logo. No LLM involved — instant, offline, predictable.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parse(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}
function luminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const WHITE: Rgb = { r: 252, g: 252, b: 251 };
const INK: Rgb = { r: 24, g: 25, b: 31 };

/** Custom-theme data (schema-valid) from brand colors; light surface with
 *  the brand accent carrying the identity. */
export function themeDataFromBrand(input: {
  name?: string;
  colors: string[];
  logoUrl?: string;
}): Record<string, unknown> {
  const accent = parse(input.colors[0] ?? "#5B5BD6");
  const secondary = input.colors[1] ? parse(input.colors[1]) : accent;
  // Headings: the accent dark enough to read on near-white; darken as needed.
  const headingRgb =
    luminance(accent) > 0.45 ? mix(accent, INK, 0.55) : mix(accent, INK, 0.2);

  return {
    name: input.name ? `${input.name} Brand` : "Brand",
    description: "Generated from your brand kit",
    mode: "light",
    colors: {
      primary: toHex(secondary),
      accent: toHex(accent),
      background: toHex(WHITE),
      text: toHex(INK),
      heading: toHex(headingRgb),
      smartLayout: toHex(accent),
      cardBackground: toHex(mix(accent, WHITE, 0.94)),
    },
    fonts: { heading: "Inter", body: "Inter" },
    borderRadius: { card: "0.75rem", slide: "1rem", button: "0.17rem" },
    transitions: { default: "all 0.2s ease-in-out" },
    shadows: {
      card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 10px rgba(0,0,0,0.05)",
      button: "",
      slide: "0 12px 28px rgba(0,0,0,0.08)",
    },
    background: {
      type: "radial",
      override: `radial-gradient(circle at 12% 8%, ${toHex(mix(accent, WHITE, 0.86))} 0%, transparent 34%), radial-gradient(circle at 88% 90%, ${toHex(mix(secondary, WHITE, 0.9))} 0%, transparent 42%), ${toHex(WHITE)}`,
    },
    ...(input.logoUrl ? { brandLogo: input.logoUrl } : {}),
  };
}
