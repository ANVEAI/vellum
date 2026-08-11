/**
 * Ported from allweonedev/presentation-ai (MIT License) — see THIRD_PARTY_LICENSES.md.
 */

import * as z from "zod";

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Expected a 6-digit hex color");

const presentationThemeModeSchema = z.enum(["light", "dark"]);

const presentationThemeColorsSchema = z.object({
  primary: hexColorSchema.describe(
    "Main brand/action color used for emphasis and prominent visual accents.",
  ),
  accent: hexColorSchema.describe(
    "Secondary accent color that complements the primary color.",
  ),
  background: hexColorSchema.describe("Main slide/page background color."),
  text: hexColorSchema.describe(
    "Body text color with strong contrast against background and cardBackground.",
  ),
  heading: hexColorSchema.describe(
    "Heading text color with strong contrast against background and cardBackground.",
  ),
  smartLayout: hexColorSchema.describe(
    "Fill color for smart layout SVGs and visual structures such as pyramids, pie charts, staircase blocks, cycles, timelines, and other diagram elements. It usually sits close to the primary color or a deliberate variant of it, not a neutral card surface color.",
  ),
  cardBackground: hexColorSchema.describe(
    "Surface color for cards or text containers where text is rendered. This is separate from smartLayout and should preserve text readability.",
  ),
});

const presentationThemeFontsSchema = z.object({
  heading: z
    .string()
    .min(1)
    .describe(
      "A real, well-known font family name, such as Inter, Manrope, Poppins, IBM Plex Sans, Playfair Display, Merriweather, Sora, or Space Grotesk. Do not invent font names.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "A real, well-known font family name, such as Inter, Manrope, Source Sans Pro, Work Sans, IBM Plex Sans, Lato, Open Sans, or DM Sans. Do not invent font names.",
    ),
  numeric: z.string().min(1).optional(),
  headingWeight: z.number().int().min(100).max(900).optional(),
  bodyWeight: z.number().int().min(100).max(900).optional(),
  headingUrl: z.string().url().optional(),
  bodyUrl: z.string().url().optional(),
});

const presentationThemeBorderRadiusSchema = z.object({
  card: z.string().min(1),
  slide: z.string().min(1),
  button: z.string().min(1),
});

const presentationThemeTransitionsSchema = z.object({
  default: z.string().min(1),
});

const presentationThemeShadowsSchema = z.object({
  card: z.string(),
  button: z.string(),
  slide: z.string(),
});

const presentationThemeMaskSchema = z
  .object({
    clipPath: z.string().optional(),
    maskImage: z.string().optional(),
    maskSize: z.string().optional(),
    maskPosition: z.string().optional(),
    maskRepeat: z.string().optional(),
  })
  .optional();

const presentationThemeBackgroundSchema = z
  .object({
    type: z.enum(["solid", "linear", "radial", "image"]).optional(),
    override: z.string().optional(),
    gradient: z
      .object({
        type: z.enum(["linear", "radial"]),
        angle: z.number().optional(),
        shape: z.enum(["circle", "ellipse"]).optional(),
        at: z
          .object({
            x: z.number(),
            y: z.number(),
          })
          .optional(),
        stops: z
          .array(
            z.object({
              id: z.string().min(1),
              color: hexColorSchema,
              position: z.number().min(0).max(100),
            }),
          )
          .optional(),
      })
      .optional(),
    imageUrl: z.string().url().optional(),
  })
  .optional();

export const presentationAiThemePropertiesSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(240).optional(),
  colors: presentationThemeColorsSchema.partial().optional(),
  fonts: presentationThemeFontsSchema.partial().optional(),
  background: presentationThemeBackgroundSchema,
});

export const presentationThemePropertiesSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240),
  mode: presentationThemeModeSchema,
  colors: presentationThemeColorsSchema,
  fonts: presentationThemeFontsSchema,
  borderRadius: presentationThemeBorderRadiusSchema,
  transitions: presentationThemeTransitionsSchema,
  shadows: presentationThemeShadowsSchema,
  mask: presentationThemeMaskSchema,
  background: presentationThemeBackgroundSchema,
  brandLogo: z.string().optional(),
  /** Structural token overrides (Partial<DesignTokens>); passed through
   *  opaquely — resolveDesignTokens validates by merging over presets. */
  tokens: z.record(z.string(), z.unknown()).optional(),
  chartSeries: z.array(hexColorSchema).max(8).optional(),
});

export const presentationThemeStyleDataSchema =
  presentationThemePropertiesSchema
    .omit({
      name: true,
      description: true,
    })
    .extend({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(240).optional(),
    });

export type PresentationAiThemeProperties = z.infer<
  typeof presentationAiThemePropertiesSchema
>;
