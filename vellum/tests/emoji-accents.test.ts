/**
 * Emoji accents: a few modern emoji, drawn as pictures above chosen titles —
 * never characters in a deck's copy.
 *
 * A probe deck that put an emoji on every point, set in Windows' flat emoji
 * font, read as cluttered and basic. Style guides agree on the first part
 * (Microsoft: at most three emoji to a message, never as bullet markers,
 * never on serious topics); the second is the font: the only emoji that look
 * the same in the editor, the PDF and PowerPoint on any machine are pictures.
 */
import React from "react";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlideParser, type PlateSlide } from "@/lib/generation/parser/slide-parser";
import {
  EMOJI_ACCENTS,
  accentFile,
  accentFor,
  accentSrc,
  chooseEmojiAccents,
  keepAccentOf,
  restrainedTone,
} from "@/lib/slides/emoji-accents";
import { leadingEmoji, splitEmoji, withoutEmoji } from "@/lib/slides/emoji";
import { SlideContent } from "@/components/slides/render/renderer";
import { fitCacheKey } from "@/components/slides/render/use-auto-fit";
import { buildDeckPrompt } from "@/lib/generation/prompts/deck";
import type { Descendant } from "@/lib/slides/plate-shim";

function parse(xml: string, mode: "deck" | "document" = "deck"): PlateSlide[] {
  const parser = new SlideParser({ mode });
  parser.reset();
  parser.parseChunk(xml);
  parser.finalize();
  parser.clearAllGeneratingMarks();
  return parser.getAllSlides();
}

function text(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; children?: unknown[] };
  if (typeof n.text === "string") return n.text;
  return (n.children ?? []).map(text).join(" ").replace(/\s+/g, " ").trim();
}

const deck = (...sections: string[]) => `<PRESENTATION>${sections.join("")}</PRESENTATION>`;

describe("the palette", () => {
  it("holds single emoji, each once", () => {
    for (const accent of EMOJI_ACCENTS) {
      expect(splitEmoji(accent.emoji), accent.name).toEqual([{ text: accent.emoji, emoji: true }]);
    }
    const bare = EMOJI_ACCENTS.map((a) => a.emoji.replace(/\u{FE0F}/gu, ""));
    expect(new Set(bare).size).toBe(bare.length);
    expect(new Set(EMOJI_ACCENTS.map((a) => a.name)).size).toBe(EMOJI_ACCENTS.length);
  });

  it("names each picture by its code points, without the presentation selector", () => {
    expect(accentFile(accentFor("🚀")!)).toBe("1f680");
    expect(accentFile(accentFor("☁️")!)).toBe("2601");
    expect(accentFile(accentFor("🗺️")!)).toBe("1f5fa");
    expect(accentSrc("🚀")).toBe("/static/emoji/1f680.png");
  });

  it("has a picture for every emoji it offers", () => {
    const missing = EMOJI_ACCENTS.filter(
      (a) => !existsSync(path.join(process.cwd(), "public", ...accentSrc(a.emoji)!.split("/"))),
    ).map((a) => `${a.emoji} ${a.name}`);
    expect(missing).toEqual([]);
  });

  it("matches an emoji however it was written, and nothing off the palette", () => {
    expect(accentFor(" 🚀 ")?.name).toBe("Rocket");
    expect(accentFor("☁")?.emoji).toBe("☁️");
    expect(accentFor("😀")).toBeUndefined();
    expect(accentFor("")).toBeUndefined();
    expect(accentFor(42)).toBeUndefined();
    expect(accentSrc("😀")).toBeUndefined();
  });
});

describe("emoji out of the copy", () => {
  it("finds the emoji a text opens with", () => {
    expect(leadingEmoji("  🚀✨ Launch")).toBe("🚀");
    expect(leadingEmoji("Launch 🚀")).toBeNull();
    expect(leadingEmoji("")).toBeNull();
  });

  it("takes emoji out and closes the gap they leave", () => {
    expect(withoutEmoji("🚀 Launch")).toBe("Launch");
    expect(withoutEmoji("Fast ⚡ cheap")).toBe("Fast cheap");
    expect(withoutEmoji("Fast⚡cheap")).toBe("Fast cheap");
    expect(withoutEmoji("Done ✅")).toBe("Done");
    expect(withoutEmoji("Go 🚀 🎉 now")).toBe("Go now");
    expect(withoutEmoji("Line 🌍\nNext")).toBe("Line\nNext");
    expect(withoutEmoji("🎉")).toBe("");
  });

  it("returns text without emoji as it was, symbols included", () => {
    const plain = "✔ done → next © 2026";
    expect(withoutEmoji(plain)).toBe(plain);
  });
});

describe("the parser", () => {
  it("reads a proposed accent from the SECTION", () => {
    const [slide] = parse(deck(`<SECTION role="hero" emoji="🚀"><TITLE>Ship faster</TITLE></SECTION>`));
    expect(slide.emojiHint).toBe("🚀");
    expect(slide.emoji).toBeUndefined();
    expect(text(slide.content[0])).toBe("Ship faster");
  });

  it("reads an emoji opening the title as the proposal, and takes emoji out of the text", () => {
    const [slide] = parse(
      deck(
        `<SECTION><H1>🚀 Ship faster</H1><BULLETS><DIV><H3>✅ Done today</H3><P>Shipped 🎉 on time</P></DIV></BULLETS></SECTION>`,
      ),
    );
    expect(slide.emojiHint).toBe("🚀");
    expect(slide.content.map(text)).toEqual(["Ship faster", "Done today Shipped on time"]);
  });

  it("prefers the attribute, and ignores emoji off the palette", () => {
    expect(parse(deck(`<SECTION emoji="🎯"><H1>🚀 Ship</H1></SECTION>`))[0].emojiHint).toBe("🎯");
    const [slide] = parse(deck(`<SECTION emoji="😀"><H1>😀 Hello there</H1></SECTION>`));
    expect(slide.emojiHint).toBeUndefined();
    expect(text(slide.content[0])).toBe("Hello there");
  });

  it("leaves a table's emoji alone: in a grid they are the values", () => {
    const [slide] = parse(
      deck(
        `<SECTION><H1>Plans compared</H1><TABLE><TR><TH>Feature</TH><TH>Pro</TH></TR><TR><TD>SSO</TD><TD>✅</TD></TR></TABLE></SECTION>`,
      ),
    );
    expect(JSON.stringify(slide.content)).toContain("✅");
  });

  it("gives documents no accents", () => {
    const [section] = parse(
      `<DOCUMENT><SECTION emoji="🚀"><TITLE>🚀 Annual report</TITLE><P>Body.</P></SECTION></DOCUMENT>`,
      "document",
    );
    expect(section.emojiHint).toBeUndefined();
  });
});

const titled = (archetype: string, emojiHint?: string, heading = "A title"): PlateSlide => ({
  id: `${archetype}-${heading}`,
  archetype,
  content: [{ type: "h1", children: [{ text: heading }] } as never],
  ...(emojiHint ? { emojiHint } : {}),
});

describe("which slides keep an accent", () => {
  it("keeps proposals on display moments with a title, each emoji once", () => {
    const out = chooseEmojiAccents([
      titled("hero", "🚀"),
      titled("content", "🎯"),
      titled("divider", "🚀", "Second part"),
      titled("statement", "📈"),
      titled("closing", "🙌"),
      { id: "untitled", archetype: "divider", emojiHint: "💡", content: [{ type: "p", children: [{ text: "No title" }] } as never] },
    ]);
    expect(out.map((s) => s.emoji ?? null)).toEqual(["🚀", null, null, "📈", "🙌", null]);
    expect(out.some((s) => "emojiHint" in s)).toBe(false);
  });

  it("keeps a formal deck's emoji to its cover and close", () => {
    const out = chooseEmojiAccents(
      [titled("hero", "🚀"), titled("divider", "🧭"), titled("statement", "📈"), titled("closing", "🙌")],
      { restrained: true },
    );
    expect(out.map((s) => s.emoji ?? null)).toEqual(["🚀", null, null, "🙌"]);
  });

  it("keeps an accent a slide already has, and counts it as used", () => {
    const out = chooseEmojiAccents([{ ...titled("hero"), emoji: "🚀" }, titled("closing", "🚀")]);
    expect(out.map((s) => s.emoji ?? null)).toEqual(["🚀", null]);
  });

  it("reads formal tones", () => {
    for (const tone of ["academic", "measured, executive", "precise, evidence-led", "confident, investor-ready"]) {
      expect(restrainedTone(tone), tone).toBe(true);
    }
    for (const tone of ["professional", "casual", "persuasive", "energetic, visionary", undefined]) {
      expect(restrainedTone(tone), String(tone)).toBe(false);
    }
  });

  it("lets a regenerated slide keep the accent it had, and only that", () => {
    const next = { ...titled("hero", "🎯"), emoji: "💡" };
    expect(keepAccentOf({ ...titled("hero"), emoji: "🚀" }, next)).toMatchObject({ emoji: "🚀" });
    const without = keepAccentOf(titled("hero"), next);
    expect(without.emoji).toBeUndefined();
    expect("emojiHint" in without).toBe(false);
  });
});

describe("the accent on the slide", () => {
  const html = (nodes: Descendant[], emoji?: string) =>
    renderToStaticMarkup(React.createElement(SlideContent, { nodes, emoji }));
  const nodes = [
    { type: "label", children: [{ text: "Part two" }] },
    { type: "h1", children: [{ text: "Ship faster" }] },
    { type: "h2", children: [{ text: "A subtitle" }] },
  ] as never[];

  it("draws the picture on its own line at the top of the title, and nowhere else", () => {
    const out = html(nodes, "🚀");
    expect(out).toContain(
      '<h1 class="v-h1 v-lead"><span class="v-emoji-line" data-emoji-accent=""><img class="v-emoji-accent" src="/static/emoji/1f680.png" alt="" draggable="false"/></span><span class="">Ship faster</span></h1>',
    );
    expect(out.match(/v-emoji-accent/g)).toHaveLength(1);
  });

  it("draws nothing for no emoji or one off the palette", () => {
    expect(html(nodes)).not.toContain("v-emoji-line");
    expect(html(nodes, "😀")).not.toContain("v-emoji-line");
  });

  it("is measured again by autofit when it changes", () => {
    const slide = { id: "s", content: nodes };
    expect(fitCacheKey({ ...slide, emoji: "🚀" })).not.toBe(fitCacheKey(slide));
  });
});

describe("the deck prompt", () => {
  const input = {
    prompt: "A talk about shipping faster",
    outline: ["# Ship faster", "# Why now"],
    language: "English",
    currentDate: "2026-10-17",
  };

  it("offers the palette for display moments and keeps emoji out of the copy", () => {
    const { system } = buildDeckPrompt(input);
    expect(system).toContain("# EMOJI ACCENTS");
    expect(system).toContain('emoji="…"');
    expect(system).toContain(EMOJI_ACCENTS.map((a) => a.emoji).join(" "));
    expect(system).toContain("Never write an emoji inside any text");
  });

  it("asks for the cover, dividers and close, and in a formal deck for two", () => {
    const casual = buildDeckPrompt({ ...input, tone: "casual" }).system;
    expect(casual).toContain("The hero and the closing each carry one, and so does each section divider.");
    expect(casual).toContain("the hero SECTION, each divider SECTION and the closing SECTION carry emoji=");
    const formal = buildDeckPrompt({ ...input, tone: "academic" }).system;
    expect(formal).toContain("exactly two slides carry one: the hero and the closing");
    expect(formal).not.toContain("each divider SECTION");
  });

  it("teaches the attribute with the slide shell", () => {
    expect(buildDeckPrompt(input).system).toContain('emoji="one emoji from the EMOJI ACCENTS list"');
  });
});
