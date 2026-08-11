/**
 * NOCTURNE — charcoal image-forward pack.
 * Effectively-black canvas, pure white type at generous scale, rounded
 * media tiles floating in wide gutters, a dedicated numeric face for
 * stats. One base accent drives everything. Original work, free fonts.
 */
import type { ThemeProperties } from "@/lib/themes/data";

export const nocturneThemes: Record<string, ThemeProperties> = {
  nocturne: {
    name: "Nocturne",
    description: "Charcoal image-forward — soft type, floating tiles",
    mode: "dark",
    colors: {
      primary: "#8A8A8A",
      accent: "#5EEAD4",
      background: "#0A0A0A",
      text: "#FFFFFF",
      heading: "#FFFFFF",
      smartLayout: "#5EEAD4",
      cardBackground: "#141414",
    },
    fonts: {
      heading: "Outfit",
      body: "Inter",
      numeric: "Space Grotesk",
      headingWeight: 600,
      bodyWeight: 400,
    },
    borderRadius: { card: "1.25rem", slide: "1rem", button: "9999px" },
    transitions: { default: "all 0.2s ease-in-out" },
    shadows: { card: "", button: "", slide: "0 30px 80px rgba(0,0,0,0.6)" },
    background: {
      type: "linear",
      override: "linear-gradient(180deg, #141414 0%, #0A0A0A 60%)",
    },
    chartSeries: [
      "#5EEAD4",
      "#FFFFFF",
      "#8A8A8A",
      "#3DA394",
      "#565656",
      "#2A6B61",
    ],
    tokens: {
      structure: { cardPolicy: "cards", whitespace: 0.5 },
      content: { maxWordsPerSlide: 35, maxItems: 4 },
    },
  },
};
