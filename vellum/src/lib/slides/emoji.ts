/**
 * Emoji in slide text: which characters are emoji, and the font every
 * renderer draws them with.
 *
 * A slide is drawn three ways — the browser (editor, present mode, and the
 * print route the PDF is made from), PowerPoint, and Word — and left to
 * itself each one picked a different emoji glyph. The browser fell back to
 * whatever colour emoji font the machine had. The PowerPoint exporter wrote
 * emoji into runs set in the theme's text font, which has no emoji, so
 * PowerPoint had to substitute one and could choose a black-and-white
 * glyph; PowerPoint itself, when someone types an emoji, sets that run in
 * Segoe UI Emoji. The fix is to stop leaving the choice to fallback: emoji
 * become runs (and spans) of their own, set in an emoji font, here and in
 * the export.
 */

/**
 * The emoji font PowerPoint and Word are told to use: the colour emoji font
 * Windows ships, and the one Office itself switches a typed emoji to. The
 * PDF is rendered on the same Windows machine with the same font (the first
 * entry of EMOJI_FONT_STACK), so the two show the same glyphs. Where it is
 * not installed — PowerPoint for Mac, LibreOffice — the viewer substitutes
 * its own colour emoji font for the missing face, as it would for any
 * emoji.
 */
export const EMOJI_FONT = "Segoe UI Emoji";

/**
 * The browser stack for emoji: Windows, Apple, then Noto (ChromeOS, Android,
 * most Linux). Only one is present on any machine; the first matches
 * EMOJI_FONT so the server's PDF and PowerPoint on Windows agree.
 */
export const EMOJI_FONT_STACK = `"${EMOJI_FONT}", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

/**
 * Unicode's recommended-for-interchange emoji, including the sequences that
 * make one emoji out of several code points: ZWJ sequences (👩‍💻), skin tones
 * (👍🏽), flags (🇮🇳), keycaps (1️⃣) and anything followed by the emoji
 * variation selector (❤️). Characters that default to text presentation and
 * carry no selector — ✔, ❤, ©, digits — are not emoji here: every renderer
 * draws those from the text font, so they stay text.
 *
 * Built at run time: the `v` flag (Unicode sets) exists in Node 20+ and
 * current browsers but cannot be written as a literal for every build
 * target. Where it is missing nothing is treated as emoji, which is the old
 * behaviour.
 */
function emojiPattern(): RegExp | null {
  try {
    return new RegExp("\\p{RGI_Emoji}", "gv");
  } catch {
    return null;
  }
}

const EMOJI = emojiPattern();

/**
 * A code point every emoji has at least one of: ©, ®, the symbol blocks from
 * ‼ (U+203C) to ㊙ (U+3299) — which hold the keycap mark and the dingbats —
 * the presentation selector, and the pictograph planes U+1F000–U+1FAFF
 * (flags, people, objects). Text with none of these has no emoji, so it is
 * never run through the full pattern: RGI_Emoji is a set of thousands of
 * sequences, and the parser cleans every text leaf of a deck on every
 * streaming tick.
 */
const MAYBE_EMOJI = /[\u{A9}\u{AE}\u{203C}-\u{3299}\u{FE0F}\u{1F000}-\u{1FAFF}]/u;

export interface TextPiece {
  text: string;
  emoji: boolean;
}

/**
 * Whether the text holds an emoji (see splitEmoji). The pattern is global, so
 * `test` moves its `lastIndex` — and `matchAll` starts from wherever that was
 * left, which skipped the first emoji of a text checked first. Reset both
 * ways.
 */
export function hasEmoji(text: string): boolean {
  if (!EMOJI || !text || !MAYBE_EMOJI.test(text)) return false;
  EMOJI.lastIndex = 0;
  const found = EMOJI.test(text);
  EMOJI.lastIndex = 0;
  return found;
}

/**
 * The text cut into runs of emoji and runs of everything else, in order.
 * Text without emoji comes back as one piece.
 */
export function splitEmoji(text: string): TextPiece[] {
  if (!EMOJI || !text || !MAYBE_EMOJI.test(text)) return [{ text, emoji: false }];
  const pieces: TextPiece[] = [];
  let at = 0;
  EMOJI.lastIndex = 0;
  for (const match of text.matchAll(EMOJI)) {
    const start = match.index ?? 0;
    if (start > at) pieces.push({ text: text.slice(at, start), emoji: false });
    const last = pieces[pieces.length - 1];
    // Neighbouring emoji share a run, as they would in PowerPoint.
    if (last?.emoji && start === at) last.text += match[0];
    else pieces.push({ text: match[0], emoji: true });
    at = start + match[0].length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), emoji: false });
  return pieces.length > 0 ? pieces : [{ text, emoji: false }];
}

/**
 * The emoji a text opens with, after any leading space, or null. One emoji,
 * not the run: "🚀✨ Launch" opens with 🚀.
 */
export function leadingEmoji(text: string): string | null {
  if (!EMOJI || !text || !MAYBE_EMOJI.test(text)) return null;
  const trimmed = text.trimStart();
  EMOJI.lastIndex = 0;
  const match = EMOJI.exec(trimmed);
  EMOJI.lastIndex = 0;
  return match && match.index === 0 ? match[0] : null;
}

/**
 * The text with its emoji taken out and the gap each one leaves closed:
 * "🚀 Launch" → "Launch", "Fast ⚡ cheap" → "Fast cheap", "Done ✅" → "Done".
 * Line breaks are kept. Text without emoji comes back as it was.
 */
export function withoutEmoji(text: string): string {
  if (!hasEmoji(text)) return text;
  const marked = splitEmoji(text)
    .map((piece) => (piece.emoji ? "\u0000" : piece.text))
    .join("");
  // An emoji — or a run of them, spaces between — goes with the spaces
  // beside it. Between two words one space stays; at an end of the text or
  // of a line, none does.
  return marked.replace(/[^\S\n]*(?:\u0000[^\S\n]*)+/g, (gap: string, at: number) => {
    const before = marked[at - 1];
    const after = marked[at + gap.length];
    const edge =
      before === undefined || after === undefined || before === "\n" || after === "\n";
    return edge ? "" : " ";
  });
}
