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
  if (!EMOJI || !text) return false;
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
  if (!EMOJI || !text) return [{ text, emoji: false }];
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
