/**
 * Runtime @font-face injection for custom/brand themes carrying font URLs
 * (theme.fonts.headingUrl / bodyUrl) — the half of custom fonts the static
 * fetch-fonts pipeline can't cover. Idempotent per (family, url).
 *
 * Approach derived from allweonedev/presentation-ai's loadCustomFont (MIT)
 * — see THIRD_PARTY_LICENSES.md; simplified to style-tag injection.
 */

const loaded = new Set<string>();

function formatFor(url: string): string | null {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith(".woff2")) return "woff2";
  if (clean.endsWith(".woff")) return "woff";
  if (clean.endsWith(".ttf")) return "truetype";
  if (clean.endsWith(".otf")) return "opentype";
  return null;
}

export function loadCustomFont(family: string, url: string | undefined): void {
  if (typeof document === "undefined") return;
  if (!family || !url) return;
  const key = `${family}|${url}`;
  if (loaded.has(key)) return;
  const format = formatFor(url);
  if (!format) return;
  loaded.add(key);

  const style = document.createElement("style");
  style.setAttribute("data-vellum-font", family);
  style.textContent = `@font-face {
  font-family: "${family.replace(/"/g, "")}";
  src: url("${url}") format("${format}");
  font-display: swap;
}`;
  document.head.appendChild(style);
}

export function loadThemeFonts(fonts: {
  heading: string;
  body: string;
  numeric?: string;
  headingUrl?: string;
  bodyUrl?: string;
}): void {
  loadCustomFont(fonts.heading, fonts.headingUrl);
  loadCustomFont(fonts.body, fonts.bodyUrl);
}
