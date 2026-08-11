/**
 * PRISM — gradient-card pack, dark and light variants.
 * Always-on rounded cards, gradient surfaces, gradient heading fills,
 * one hot accent against a cool base. Inspired by card-native web deck
 * aesthetics; original palettes with free fonts.
 */
import type { ThemeProperties } from "@/lib/themes/data";

export const prismThemes: Record<string, ThemeProperties> = {
  prism: {
    name: "Prism",
    description: "Sleek dark cards with violet-to-ember gradient energy",
    mode: "dark",
    colors: {
      primary: "#FF5000",
      accent: "#7C5CFF",
      background: "#0B0B0D",
      text: "#EDEDF0",
      heading: "#FFFFFF",
      smartLayout: "#7C5CFF",
      cardBackground: "#151518",
    },
    fonts: {
      heading: "Onest",
      body: "Hanken Grotesk",
      headingWeight: 700,
      bodyWeight: 500,
    },
    borderRadius: { card: "1.5rem", slide: "1rem", button: "9999px" },
    transitions: { default: "all 0.2s ease-in-out" },
    shadows: {
      card: "",
      button: "",
      slide: "0 24px 60px rgba(0,0,0,0.5)",
    },
    background: {
      type: "radial",
      override: `
        radial-gradient(90% 60% at 85% 10%, #7C5CFF26 0%, transparent 55%),
        radial-gradient(70% 50% at 10% 90%, #FF500018 0%, transparent 50%),
        #0B0B0D
      `,
    },
    chartSeries: [
      "#7C5CFF",
      "#FF5000",
      "#DA2887",
      "#2548EB",
      "#84C1FA",
      "#AFE7FC",
    ],
    tokens: {
      structure: { cardPolicy: "cards", whitespace: 0.28 },
      style: { headingFill: "linear-gradient(115deg, #FFFFFF 30%, #B9A6FF 70%, #FF9A66 100%)" },
    },
  },
  prismLight: {
    name: "Prism Light",
    description: "Deep-blue ink on airy tiles, hot ember accents",
    mode: "light",
    colors: {
      primary: "#FF5000",
      accent: "#0540AD",
      background: "#FFFFFF",
      text: "#38383C",
      heading: "#002253",
      smartLayout: "#0540AD",
      cardBackground: "#E8EEFC",
    },
    fonts: {
      heading: "Onest",
      body: "Hanken Grotesk",
      headingWeight: 700,
      bodyWeight: 500,
    },
    borderRadius: { card: "1.5rem", slide: "1rem", button: "9999px" },
    transitions: { default: "all 0.2s ease-in-out" },
    shadows: {
      card: "0 2px 8px rgba(5,64,173,0.08)",
      button: "",
      slide: "0 14px 40px rgba(5,64,173,0.12)",
    },
    background: {
      type: "radial",
      override: `
        radial-gradient(80% 55% at 90% 0%, #D0E6FE55 0%, transparent 55%),
        radial-gradient(60% 45% at 5% 100%, #E8EEFC88 0%, transparent 50%),
        #FFFFFF
      `,
    },
    chartSeries: [
      "#0540AD",
      "#FF5000",
      "#DA2887",
      "#2548EB",
      "#84C1FA",
      "#AFE7FC",
    ],
    tokens: {
      structure: { cardPolicy: "cards", whitespace: 0.3 },
      style: { headingFill: "linear-gradient(115deg, #002253 40%, #0540AD 75%, #FF5000 115%)" },
    },
  },
};
