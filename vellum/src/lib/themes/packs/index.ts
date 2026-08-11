/**
 * Style-pack theme registry. Each pack module is data-only (type-only
 * import of ThemeProperties — no runtime cycle with data.ts). Spread into
 * the main `themes` map; family pins live in src/lib/design/families.ts.
 *
 * Packs are original works inspired by contemporary presentation design;
 * they ship neutral names, free fonts, and no third-party assets.
 */
import type { ThemeProperties } from "@/lib/themes/data";
import { meridianThemes } from "./meridian";
import { foolscapThemes } from "./foolscap";
import { prismThemes } from "./prism";
import { nocturneThemes } from "./nocturne";

export const packThemes: Record<string, ThemeProperties> = {
  ...meridianThemes,
  ...foolscapThemes,
  ...prismThemes,
  ...nocturneThemes,
};

/** Theme keys that belong to studio packs (ThemePicker groups them). */
export const PACK_THEME_KEYS: string[] = Object.keys(packThemes);
