/**
 * Design families: the structural layer above themes. A theme carries colors
 * and fonts; its family decides how slides are BUILT — card policy, splits,
 * whitespace, scale, chart manners. Six families cover the 38 builtin themes
 * (pinned below) plus a classifier for AI-generated/custom themes.
 */
import type { ThemeProperties } from "@/lib/themes/data";

export type DesignFamily =
  | "swiss"
  | "editorial"
  | "corporate"
  | "bold"
  | "organic"
  | "tech"
  | "studio";

export const DESIGN_FAMILIES: DesignFamily[] = [
  "swiss",
  "editorial",
  "corporate",
  "bold",
  "organic",
  "tech",
  "studio",
];

/** Curated family assignment for every builtin theme. */
export const FAMILY_BY_THEME: Record<string, DesignFamily> = {
  daktilo: "corporate",
  noir: "editorial",
  cornflower: "corporate",
  indigo: "corporate",
  orbit: "tech",
  cosmos: "bold",
  piano: "swiss",
  ebony: "editorial",
  mystique: "tech",
  phantom: "tech",
  allweoneLight: "corporate",
  allweoneDark: "tech",
  crimson: "bold",
  ember: "bold",
  sunset: "bold",
  dusk: "bold",
  forest: "organic",
  canopy: "organic",
  aurora: "bold",
  borealis: "bold",
  sakura: "editorial",
  midnight: "tech",
  ocean: "corporate",
  abyss: "tech",
  sand: "editorial",
  obsidian: "tech",
  mint: "organic",
  jade: "organic",
  rose: "editorial",
  wine: "editorial",
  arctic: "swiss",
  glacier: "swiss",
  honey: "organic",
  amber: "organic",
  coral: "organic",
  magma: "bold",
  lavender: "editorial",
  velvet: "editorial",
  // ---- style packs ----
  meridian: "studio",
  foolscap: "editorial",
  prism: "tech",
  prismLight: "tech",
  nocturne: "bold",
};

const SERIF_HINTS = [
  "serif",
  "playfair",
  "cormorant",
  "lora",
  "merriweather",
  "crimson",
  "libre",
  "spectral",
  "fraunces",
  "georgia",
  "garamond",
  "bodoni",
  "didot",
  "prata",
  "cardo",
  "vollkorn",
  "bitter",
  "zilla",
  "eb ",
];

function isSerif(font: string): boolean {
  const f = font.toLowerCase();
  return SERIF_HINTS.some((hint) => f.includes(hint));
}

function radiusPx(value: string): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 12;
  return value.includes("rem") ? n * 16 : n;
}

/**
 * Resolve a theme's family: curated pin by theme key when known, otherwise a
 * heuristic (serif heading → editorial; zero radius → swiss; dark + sans →
 * tech; big radius → organic; else corporate) for AI/custom themes.
 */
export function resolveFamily(
  themeName: string | undefined,
  theme: ThemeProperties,
): DesignFamily {
  if (themeName && FAMILY_BY_THEME[themeName]) return FAMILY_BY_THEME[themeName];
  if (isSerif(theme.fonts.heading)) return "editorial";
  const radius = radiusPx(theme.borderRadius.card);
  if (radius <= 2) return "swiss";
  if (radius >= 16) return theme.mode === "dark" ? "tech" : "organic";
  if (theme.mode === "dark") return "tech";
  return "corporate";
}
