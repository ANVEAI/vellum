"use client";

/**
 * Applies a resolved theme's CSS variables to its subtree, and shares the
 * resolved ThemeProperties via context so the slide surface can also paint
 * critical properties (background/color/fonts) as concrete inline values —
 * belt and braces for environments where custom-property paint lags, and a
 * determinism win for headless export rendering.
 */
import React, { createContext, useContext, useEffect, useMemo } from "react";
import { themes, type ThemeProperties } from "@/lib/themes/data";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import { themeToCssVars } from "@/lib/themes/css-vars";
import { loadThemeFonts } from "@/lib/themes/load-custom-font";
import {
  resolveDesignTokens,
  type DesignTokens,
} from "@/lib/design/tokens";

export { resolveThemeOrDefault };

const ThemeContext = createContext<ThemeProperties>(themes.mystique);
const TokensContext = createContext<DesignTokens>(
  resolveDesignTokens(themes.mystique, "mystique"),
);

export function useSlideTheme(): ThemeProperties {
  return useContext(ThemeContext);
}

export function useDesignTokens(): DesignTokens {
  return useContext(TokensContext);
}

export function ThemeScope({
  themeName,
  customThemeData,
  children,
  className,
}: {
  themeName?: string;
  customThemeData?: unknown;
  children: React.ReactNode;
  className?: string;
}) {
  const theme = useMemo(
    () => resolveThemeOrDefault(themeName, customThemeData),
    [themeName, customThemeData],
  );
  const tokens = useMemo(
    () => resolveDesignTokens(theme, themeName),
    [theme, themeName],
  );
  const vars = useMemo(
    () => themeToCssVars(theme, themeName),
    [theme, themeName],
  );
  // Custom/brand themes may carry font URLs — inject @font-face once.
  useEffect(() => {
    loadThemeFonts(theme.fonts);
  }, [theme.fonts]);
  return (
    <ThemeContext.Provider value={theme}>
      <TokensContext.Provider value={tokens}>
        <div
          className={className}
          style={vars as React.CSSProperties}
          data-family={tokens.family}
          data-card-policy={tokens.structure.cardPolicy}
        >
          {children}
        </div>
      </TokensContext.Provider>
    </ThemeContext.Provider>
  );
}

export const themeNames = Object.keys(themes);
