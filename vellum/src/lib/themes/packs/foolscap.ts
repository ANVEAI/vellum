/**
 * FOOLSCAP — warm ivory editorial pack.
 * Cream canvas, clay accent used scarcely (or flooded), serif display that
 * never bolds, muted humanist chart palette, near-zero shadows. Inspired
 * by warm-minimal research-lab aesthetics; original work with free fonts.
 */
import type { ThemeProperties } from "@/lib/themes/data";

export const foolscapThemes: Record<string, ThemeProperties> = {
  foolscap: {
    name: "Foolscap",
    description: "Warm ivory editorial — serif calm, clay accents",
    mode: "light",
    colors: {
      primary: "#6A9BCC",
      accent: "#D97757",
      background: "#FAF9F5",
      text: "#3D3D3A",
      heading: "#141413",
      smartLayout: "#D97757",
      cardBackground: "#F0EEE6",
    },
    fonts: {
      heading: "Source Serif 4",
      body: "Hanken Grotesk",
      headingWeight: 400,
      bodyWeight: 400,
    },
    borderRadius: { card: "1.5rem", slide: "1rem", button: "0.5rem" },
    transitions: { default: "all 0.2s ease-in-out" },
    shadows: {
      card: "0 1px 3px rgba(20,20,19,0.08)",
      button: "",
      slide: "0 10px 30px rgba(20,20,19,0.07)",
    },
    background: {
      type: "solid",
      override: "#FAF9F5",
    },
    chartSeries: [
      "#D97757",
      "#6A9BCC",
      "#788C5D",
      "#C46686",
      "#D4A27F",
      "#BCD1CA",
      "#CBCADB",
      "#EBDBBC",
    ],
    tokens: {
      structure: {
        cardPolicy: "open",
        whitespace: 0.42,
        surfaceRhythm: true,
        // canvas (ivory) → card surface → canvas → warm oat; all light so
        // the ink text stays readable on every rotation stop.
        surfaces: [undefined, "#F0EEE6", undefined, "#E3DACC"],
      },
      content: { maxWordsPerSlide: 45 },
    },
  },
};
