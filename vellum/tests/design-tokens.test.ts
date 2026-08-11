import { describe, expect, it } from "vitest";
import { themes } from "@/lib/themes/data";
import { PACK_THEME_KEYS } from "@/lib/themes/packs";
import { resolveDesignTokens, surfaceOf } from "@/lib/design/tokens";
import { resolveFamily, DESIGN_FAMILIES } from "@/lib/design/families";
import { LEGACY_SCALE, scaleForFamily } from "@/lib/design/type-scale";
import { themeToCssVars } from "@/lib/themes/css-vars";
import { gradients, findGradient, gradientCss } from "@/lib/themes/gradients";
import { surfaceForSlide } from "@/lib/design/planner";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

describe("design tokens & style packs", () => {
  it("registers the four style packs alongside the 38 builtins", () => {
    expect(PACK_THEME_KEYS).toEqual(
      expect.arrayContaining([
        "meridian",
        "foolscap",
        "prism",
        "prismLight",
        "nocturne",
      ]),
    );
    expect(Object.keys(themes).length).toBeGreaterThanOrEqual(43);
  });

  it("resolves every theme to a known family with a real scale", () => {
    for (const [name, theme] of Object.entries(themes)) {
      const family = resolveFamily(name, theme);
      expect(DESIGN_FAMILIES).toContain(family);
      const tokens = resolveDesignTokens(theme, name);
      expect(tokens.style.scale.body).toBeGreaterThan(10);
      expect(tokens.content.maxWordsPerSlide).toBeGreaterThan(10);
    }
  });

  it("keeps the corporate family pixel-identical to the legacy scale", () => {
    expect(scaleForFamily("corporate")).toEqual(LEGACY_SCALE);
    expect(scaleForFamily(undefined)).toEqual(LEGACY_SCALE);
  });

  it("honors per-theme token overrides", () => {
    const nocturne = resolveDesignTokens(themes.nocturne, "nocturne");
    expect(nocturne.content.maxWordsPerSlide).toBe(35);
    const meridian = resolveDesignTokens(themes.meridian, "meridian");
    expect(meridian.family).toBe("studio");
    expect(meridian.structure.cardPolicy).toBe("hairline");
  });

  it("quotes font families so numeric names stay valid CSS", () => {
    // "Source Serif 4" unquoted is an invalid CSS identifier — the whole
    // font-family declaration would be dropped and headings would silently
    // fall back to the body face.
    const vars = themeToCssVars(themes.foolscap, "foolscap");
    expect(vars["--presentation-heading-font"]).toBe('"Source Serif 4"');
    expect(vars["--presentation-body-font"]).toBe('"Hanken Grotesk"');
  });

  it("emits pack chart palettes and the numeric font slot", () => {
    const vars = themeToCssVars(themes.foolscap, "foolscap");
    expect(vars["--presentation-series-3"]).toBe("#788C5D");
    const nocturneVars = themeToCssVars(themes.nocturne, "nocturne");
    expect(nocturneVars["--presentation-numeric-font"]).toBe('"Space Grotesk"');
    const prismVars = themeToCssVars(themes.prism, "prism");
    expect(prismVars["--presentation-heading-fill"]).toContain("gradient");
  });

  it("activates designed gradient surfaces", () => {
    expect(surfaceOf(themes.meridian)).toContain("radial-gradient");
    expect(surfaceOf(themes.daktilo)).toContain("radial-gradient");
  });

  it("rotates surfaces only when the theme asks for rhythm", () => {
    const slide = { id: "s", content: [], archetype: "content" } as unknown as PlateSlide;
    const foolscap = resolveDesignTokens(themes.foolscap, "foolscap");
    const a = surfaceForSlide(foolscap.structure, slide, 0);
    const b = surfaceForSlide(foolscap.structure, slide, 1);
    expect(a).not.toBe(b);
    const meridian = resolveDesignTokens(themes.meridian, "meridian");
    expect(surfaceForSlide(meridian.structure, slide, 1)).toBeUndefined();
  });

  it("never rotates the surface under a full-bleed image", () => {
    const foolscap = resolveDesignTokens(themes.foolscap, "foolscap");
    const bleed = {
      id: "s",
      content: [],
      archetype: "full-bleed",
    } as unknown as PlateSlide;
    expect(surfaceForSlide(foolscap.structure, bleed, 1)).toBeUndefined();
  });

  it("ports the gradient library with working keyword search", () => {
    // 233 raw entries; one is a nested array that normalize() flattens.
    expect(gradients.length).toBeGreaterThanOrEqual(233);
    expect(gradients.every((g) => g.colors.length > 0)).toBe(true);
    const hit = findGradient("deep blue trust");
    expect(hit).not.toBeNull();
    expect(gradientCss(hit!)).toContain("linear-gradient");
    expect(findGradient("zzzz")).toBeNull();
  });
});
