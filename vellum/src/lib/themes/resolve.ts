/**
 * Ported from allweonedev/presentation-ai (MIT License) — see THIRD_PARTY_LICENSES.md.
 */

import {
  themes,
  type ThemeProperties,
  type Themes,
} from "@/lib/themes/data";
import {
  presentationAiThemePropertiesSchema,
  presentationThemePropertiesSchema,
  presentationThemeStyleDataSchema,
} from "./schema";

export const PRESENTATION_AUTO_THEME_ID = "auto";

export type PresentationThemeSelectionSource = "auto" | "selected";

export function isPresentationAutoTheme(theme: string | null | undefined) {
  return theme === PRESENTATION_AUTO_THEME_ID;
}

export function isBuiltInPresentationTheme(
  theme: string | null | undefined,
): theme is Themes {
  return typeof theme === "string" && theme in themes;
}

function resolveCompleteCustomThemeData(
  customThemeData: unknown,
): ThemeProperties | null {
  const parsedTheme =
    presentationThemePropertiesSchema.safeParse(customThemeData);

  if (parsedTheme.success) {
    return parsedTheme.data;
  }

  const parsedThemeStyleData =
    presentationThemeStyleDataSchema.safeParse(customThemeData);

  if (parsedThemeStyleData.success) {
    const fallbackTheme = themes.mystique;

    return {
      ...parsedThemeStyleData.data,
      name: parsedThemeStyleData.data.name ?? `Custom ${fallbackTheme.name}`,
      description:
        parsedThemeStyleData.data.description ??
        `Custom theme based on ${fallbackTheme.name}`,
    };
  }

  const parsedPartialTheme =
    presentationAiThemePropertiesSchema.safeParse(customThemeData);

  if (!parsedPartialTheme.success) {
    return null;
  }

  const fallbackTheme = themes.mystique;
  const completedTheme: ThemeProperties = {
    ...fallbackTheme,
    name: parsedPartialTheme.data.name ?? `Custom ${fallbackTheme.name}`,
    description:
      parsedPartialTheme.data.description ??
      `Custom theme based on ${fallbackTheme.name}`,
    colors: {
      ...fallbackTheme.colors,
      ...parsedPartialTheme.data.colors,
    },
    fonts: {
      ...fallbackTheme.fonts,
      ...parsedPartialTheme.data.fonts,
    },
    background: parsedPartialTheme.data.background ?? fallbackTheme.background,
  };
  const parsedCompletedTheme =
    presentationThemePropertiesSchema.safeParse(completedTheme);

  return parsedCompletedTheme.success ? parsedCompletedTheme.data : null;
}

export function resolvePresentationThemeData({
  customThemeData,
  theme,
}: {
  customThemeData: unknown;
  theme: string | null | undefined;
}): ThemeProperties | null {
  if (customThemeData) {
    const resolved = resolveCompleteCustomThemeData(customThemeData);
    if (resolved) {
      return resolved;
    }
    // Custom data failed validation — fall through to built-in lookup
  }

  if (isBuiltInPresentationTheme(theme)) {
    return themes[theme];
  }

  return null;
}

export function getPersistablePresentationTheme({
  fallbackTheme,
  theme,
}: {
  fallbackTheme: Themes;
  theme: string | null | undefined;
}): Themes | string {
  return isPresentationAutoTheme(theme)
    ? fallbackTheme
    : (theme ?? fallbackTheme);
}

/** Resolve with guaranteed fallback to mystique (server-safe helper). */
export function resolveThemeOrDefault(
  themeName?: string | null,
  customThemeData?: unknown,
): ThemeProperties {
  return (
    resolvePresentationThemeData({
      theme: themeName ?? "mystique",
      customThemeData: customThemeData ?? null,
    }) ?? themes.mystique
  );
}
