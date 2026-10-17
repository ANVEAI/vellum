/**
 * Emoji are set in an emoji font of their own in every renderer.
 *
 * The PowerPoint exporter wrote emoji into runs set in the theme's text
 * font, which has no emoji, so PowerPoint chose a substitute itself and
 * could land on a black-and-white glyph; on the slide, a cover title's
 * gradient fill turned 🚀 into a flat silhouette.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMOJI_FONT, hasEmoji, splitEmoji } from "@/lib/slides/emoji";
import { emojiText, singleParagraphProperties } from "@/lib/export/pptx-emoji";
import { SlideContent } from "@/components/slides/render/renderer";
import type { Descendant } from "@/lib/slides/plate-shim";

type Run = { text?: string; options?: Record<string, unknown> };

describe("which characters are emoji", () => {
  it("takes whole emoji sequences as one", () => {
    const emoji = splitEmoji("A 👩‍💻 B 👍🏽 C 🇮🇳 D 1️⃣ E ❤️").filter((p) => p.emoji).map((p) => p.text);
    expect(emoji).toEqual(["👩‍💻", "👍🏽", "🇮🇳", "1️⃣", "❤️"]);
  });

  it("leaves text-presentation characters and symbols as text", () => {
    for (const text of ["✔ done", "❤ plain heart", "© 2026", "#1 in class", "→ next", "★ rated"]) {
      expect(hasEmoji(text), text).toBe(false);
    }
  });

  it("finds the first emoji of a text that was just checked", () => {
    // The pattern is global: a `test` left its lastIndex past the first
    // emoji, and the split then started there and found none.
    const text = "🚀 Launch Week";
    expect(hasEmoji(text)).toBe(true);
    expect(splitEmoji(text)[0]).toEqual({ text: "🚀", emoji: true });
  });

  it("never skips an emoji with its quick check", () => {
    // hasEmoji first looks for a code point every emoji carries one of, and
    // runs the full RGI_Emoji pattern only then. Every single emoji, bare or
    // with its presentation selector, must pass that first look; sequences
    // (skin tones, ZWJ, flags, keycaps) are built from these or carry U+FE0F.
    const rgi = new RegExp("^\\p{RGI_Emoji}$", "v");
    const missed: string[] = [];
    for (let cp = 0; cp <= 0x1ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);
      for (const candidate of [char, `${char}\u{FE0F}`]) {
        if (rgi.test(candidate) && !hasEmoji(candidate)) missed.push(cp.toString(16));
      }
    }
    expect(missed).toEqual([]);
  });

  it("keeps neighbouring emoji together and returns text without emoji whole", () => {
    expect(splitEmoji("Ship 🚀🎉 now")).toEqual([
      { text: "Ship ", emoji: false },
      { text: "🚀🎉", emoji: true },
      { text: " now", emoji: false },
    ]);
    expect(splitEmoji("No emoji here")).toEqual([{ text: "No emoji here", emoji: false }]);
  });
});

describe("emoji runs in the PowerPoint export", () => {
  it("returns text without emoji exactly as it was passed", () => {
    const runs: Run[] = [{ text: "Plain", options: { bold: true } }];
    const out = emojiText(runs as never, { fontFace: "Inter" });
    expect(out.text).toBe(runs);
    expect(emojiText("Plain", { fontFace: "Inter" })).toEqual({ text: "Plain", options: { fontFace: "Inter" } });
  });

  it("sets emoji in the emoji font, upright and regular, inside a bold box", () => {
    const out = emojiText("🚀 Launch Week", { fontFace: "Space Grotesk", bold: true, fontSize: 40 });
    const runs = out.text as Run[];
    expect(runs.map((r) => r.text)).toEqual(["🚀", " Launch Week"]);
    expect(runs[0].options).toMatchObject({ fontFace: EMOJI_FONT, bold: false, italic: false });
    expect(runs[1].options).toMatchObject({ bold: true });
    expect(runs[1].options?.fontFace).toBeUndefined();
    // Bold moved into the runs: a box-level bold would override the emoji's.
    expect(out.options).toEqual({ fontFace: "Space Grotesk", fontSize: 40 });
  });

  it("keeps a bullet and its paragraph to the first piece, the line break to the last", () => {
    const out = emojiText([
      { text: "🔥 Hot leads", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceBefore: 8 } },
      { text: "Inbound up 40% 📈 since March", options: { indentLevel: 1, breakLine: true } },
    ] as never);
    const runs = out.text as Run[];
    expect(runs.map((r) => r.text)).toEqual(["🔥", " Hot leads", "Inbound up 40% ", "📈", " since March"]);
    expect(runs.map((r) => Boolean(r.options?.bullet))).toEqual([true, false, false, false, false]);
    expect(runs.map((r) => Boolean(r.options?.breakLine))).toEqual([false, true, false, false, true]);
    expect(runs[3].options?.fontFace).toBe(EMOJI_FONT);
  });

  it("ends a paragraph at each newline, as pptxgenjs does", () => {
    const runs = emojiText("One 🌍\nTwo").text as Run[];
    expect(runs.map((r) => [r.text, Boolean(r.options?.breakLine)])).toEqual([
      ["One ", false],
      ["🌍", true],
      ["Two", false],
    ]);
  });
});

describe("paragraph properties", () => {
  /** What pptxgenjs 4.0.1 writes for a paragraph of two runs. */
  const twoRuns =
    '<p:txBody><a:bodyPr/><a:p><a:pPr marL="152400" indent="-152400"><a:buChar char="&#x2022;"/></a:pPr><a:r><a:t>🔥</a:t></a:r><a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:t> Hot leads</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody>';

  it("keeps a paragraph's first properties and drops the repeats", () => {
    expect(singleParagraphProperties(twoRuns)).toBe(
      '<p:txBody><a:bodyPr/><a:p><a:pPr marL="152400" indent="-152400"><a:buChar char="&#x2022;"/></a:pPr><a:r><a:t>🔥</a:t></a:r><a:r><a:t> Hot leads</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody>',
    );
  });

  it("leaves single-run paragraphs and list styles untouched", () => {
    const xml =
      '<a:lstStyle><a:lvl1pPr algn="l"/></a:lstStyle><a:p><a:pPr algn="l"/><a:r><a:t>One</a:t></a:r></a:p><a:p><a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:t>Two</a:t></a:r></a:p>';
    expect(singleParagraphProperties(xml)).toBe(xml);
  });
});

describe("emoji on the slide", () => {
  const html = (nodes: Descendant[]) => renderToStaticMarkup(React.createElement(SlideContent, { nodes }));

  it("wraps each emoji in a span of its own and leaves other text alone", () => {
    const out = html([{ type: "h1", children: [{ text: "🚀 Launch ✔ week" }] } as never]);
    expect(out).toContain('<span class="v-emoji">🚀</span> Launch ✔ week');
    expect(html([{ type: "p", children: [{ text: "No emoji" }] } as never])).not.toContain("v-emoji");
  });
});
