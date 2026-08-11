/**
 * MERIDIAN — dark block-craft studio pack.
 * Near-black canvas, hairline-separated tiles, confident grotesque type,
 * one cool accent spent sparingly. Inspired by contemporary block-based
 * presentation craft; original palette and composition.
 */
import type { ThemeProperties } from "@/lib/themes/data";

export const meridianThemes: Record<string, ThemeProperties> = {
  meridian: {
    name: "Meridian",
    description: "Dark block-craft — hairline tiles, engineered calm",
    mode: "dark",
    colors: {
      primary: "#E8A33D",
      accent: "#5B8DEF",
      background: "#0E0E10",
      text: "#E8E8EA",
      heading: "#FFFFFF",
      smartLayout: "#5B8DEF",
      cardBackground: "#17171A",
    },
    fonts: {
      heading: "Inter Tight",
      body: "Inter",
      headingWeight: 700,
      bodyWeight: 400,
    },
    borderRadius: { card: "1rem", slide: "1rem", button: "0.5rem" },
    transitions: { default: "all 0.2s ease-in-out" },
    shadows: {
      card: "",
      button: "",
      slide: "0 24px 60px rgba(0,0,0,0.55)",
    },
    background: {
      type: "radial",
      override: `
        radial-gradient(120% 80% at 50% 0%, #1A2340 0%, transparent 55%),
        #0E0E10
      `,
    },
    chartSeries: [
      "#5B8DEF",
      "#E8A33D",
      "#48C78E",
      "#C77DFF",
      "#F2555A",
      "#6EC6D9",
    ],
    tokens: {
      structure: { cardPolicy: "hairline", whitespace: 0.32 },
    },
  },
};
