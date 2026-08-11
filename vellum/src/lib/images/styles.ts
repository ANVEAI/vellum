/**
 * Deck-level image style contract. One style decision per deck: a locked
 * style block + negative block appended to every image prompt, plus a CSS
 * grade that unifies whatever the model returns. Cohesion is guaranteed in
 * CSS, not trusted to the model.
 */
import type { DesignFamily } from "@/lib/design/families";

export interface ImageStylePreset {
  id: string;
  name: string;
  tagline: string;
  /** Appended verbatim to every image prompt in the deck. */
  styleBlock: string;
  /** Injected into the workflow's Negative node (falls back to prompt text). */
  negativeBlock: string;
}

export const IMAGE_STYLE_PRESETS: ImageStylePreset[] = [
  {
    id: "editorial-photo",
    name: "Editorial Photo",
    tagline: "35mm natural light, muted, film-like",
    styleBlock:
      "editorial photography, 35mm lens, natural soft light, muted color palette, shallow depth of field, film-like grain, composed with generous negative space on one side",
    negativeBlock:
      "text, letters, words, watermark, logo, UI elements, charts, borders, collage, oversaturation, HDR, lens flare, stock-photo handshake, deformed hands, distorted faces",
  },
  {
    id: "brand-duotone",
    name: "Brand Duotone",
    tagline: "Two-tone, palette-locked — the safest set",
    styleBlock:
      "duotone photographic treatment, two-color grade, high contrast tonal range, minimalist composition, large areas of flat tone, negative space on one side",
    negativeBlock:
      "text, letters, watermark, logo, busy background, rainbow colors, oversaturation, borders, collage, deformed hands",
  },
  {
    id: "archive-mono",
    name: "Archive Mono",
    tagline: "High-contrast black & white, timeless",
    styleBlock:
      "black and white photography, high contrast, dramatic directional light, fine grain, timeless documentary style, strong geometry, negative space",
    negativeBlock:
      "color, text, letters, watermark, logo, low contrast, flat lighting, borders, collage",
  },
  {
    id: "studio-still",
    name: "Studio Still Life",
    tagline: "Objects on seamless backdrops, soft shadow",
    styleBlock:
      "studio still life photography, single object on a seamless backdrop, soft gradient shadow, high-key clean lighting, minimalist product aesthetic",
    negativeBlock:
      "people, hands, text, letters, watermark, logo, busy background, clutter, borders",
  },
  {
    id: "editorial-illustration",
    name: "Editorial Illustration",
    tagline: "Flat vector, 2-3 colors, confident lines",
    styleBlock:
      "flat vector editorial illustration, limited palette of three colors, bold confident shapes, thick-and-thin line weight, generous white space, modern magazine style, no gradients",
    negativeBlock:
      "photograph, photorealistic, 3d render, text, letters, watermark, gradients, texture, sketch lines, borders",
  },
  {
    id: "technical-line",
    name: "Technical Line",
    tagline: "Single-weight line art, blueprint register",
    styleBlock:
      "technical line art illustration, single-weight 2px lines, blueprint drawing style, precise geometry, isometric hints, monochrome ink on paper, generous margins",
    negativeBlock:
      "photograph, color fill, shading, 3d render, text, letters, watermark, texture, borders",
  },
  {
    id: "soft-3d",
    name: "Soft 3D",
    tagline: "Matte clay render, single soft key light",
    styleBlock:
      "soft 3D clay render, matte materials, rounded friendly geometry, single soft key light, pastel tinted palette, floating composition on a clean backdrop",
    negativeBlock:
      "photograph, harsh reflections, glossy plastic, text, letters, watermark, busy scene, borders",
  },
  {
    id: "abstract-field",
    name: "Abstract Field",
    tagline: "Gradient meshes and fields — no subject",
    styleBlock:
      "abstract gradient field, smooth flowing color mesh, topographic contours, atmospheric depth, no recognizable objects, calm minimal composition",
    negativeBlock:
      "people, objects, buildings, text, letters, watermark, logo, hard edges, noise",
  },
  {
    id: "editorial-dim",
    name: "Editorial Dim",
    tagline: "Moody low-key photography for dark decks",
    styleBlock:
      "moody editorial photography, low-key dramatic lighting, deep shadows with one directional light source, dark backgrounds, muted desaturated palette, cinematic atmosphere, generous negative space in the shadows for text overlay",
    negativeBlock:
      "bright daylight, white background, text, letters, watermark, logo, oversaturation, HDR, lens flare, busy background, deformed hands, distorted faces",
  },
];

export function getImageStyle(id: string | undefined): ImageStylePreset | null {
  if (!id || id === "auto") return null;
  return IMAGE_STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Family → default preset when the deck says "auto". */
export const FAMILY_DEFAULT_STYLE: Record<DesignFamily, string> = {
  swiss: "archive-mono",
  editorial: "editorial-photo",
  corporate: "editorial-photo",
  bold: "brand-duotone",
  organic: "editorial-illustration",
  tech: "soft-3d",
  studio: "editorial-dim",
};

/** Rough hue → palette word, appended so images lean toward the theme. */
export function paletteWords(accentHex: string): string {
  const hex = accentHex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 24) return "neutral monochrome tones";
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 20) return "warm red accent tones";
  if (hue < 45) return "warm orange amber tones";
  if (hue < 70) return "golden yellow accent tones";
  if (hue < 160) return "green natural tones";
  if (hue < 200) return "teal cyan accent tones";
  if (hue < 255) return "cool blue tones";
  if (hue < 290) return "violet indigo tones";
  if (hue < 330) return "magenta pink accent tones";
  return "warm red accent tones";
}
