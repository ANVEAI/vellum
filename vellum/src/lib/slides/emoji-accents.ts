/**
 * Emoji accents: one modern emoji, drawn as a picture above the title of a
 * few slides — the cover, the section openers, a statement, the close.
 *
 * Pictures, not text. An emoji typed into text is drawn by whichever emoji
 * font the viewer has: Windows' flat Segoe UI Emoji on this server, Apple's
 * on a Mac. PowerPoint cannot put a picture inside text, so the only emoji
 * that look the same in the editor, the PDF and PowerPoint on every machine
 * are pictures placed beside the text. The pictures are Microsoft's Fluent
 * Emoji in its 3D style (MIT), under public/static/emoji/.
 *
 * Few, and only where a slide pauses. Generated decks carry an emoji only on
 * their display moments — layouts the planner gives about one slide in four
 * — one per slide, never in body text (clean.ts takes those out). The model
 * proposes one with emoji="…" on a SECTION; which slides keep it is decided
 * here, once the deck is planned.
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import { leadHeadingIndex } from "@/lib/slides/walk";
import { leadingEmoji } from "@/lib/slides/emoji";

export interface EmojiAccent {
  /** The emoji, with its presentation selector where it takes one. */
  emoji: string;
  /** Its Unicode (CLDR) name: the picker's label and tooltip. */
  name: string;
}

/**
 * The emoji a generated deck may use, and the picker offers. Objects and
 * symbols that read in a business, technical or teaching deck, no faces —
 * a face sets a tone the words have not — and no flags.
 */
export const EMOJI_ACCENTS: readonly EmojiAccent[] = [
  // Direction and results
  { emoji: "🚀", name: "Rocket" },
  { emoji: "🎯", name: "Bullseye" },
  { emoji: "📈", name: "Chart increasing" },
  { emoji: "📉", name: "Chart decreasing" },
  { emoji: "📊", name: "Bar chart" },
  { emoji: "🧭", name: "Compass" },
  { emoji: "🗺️", name: "World map" },
  { emoji: "🔭", name: "Telescope" },
  { emoji: "🏆", name: "Trophy" },
  { emoji: "🏁", name: "Chequered flag" },
  { emoji: "📌", name: "Pushpin" },
  { emoji: "⛰️", name: "Mountain" },
  // Ideas and science
  { emoji: "💡", name: "Light bulb" },
  { emoji: "✨", name: "Sparkles" },
  { emoji: "🧠", name: "Brain" },
  { emoji: "🔮", name: "Crystal ball" },
  { emoji: "🧪", name: "Test tube" },
  { emoji: "🔬", name: "Microscope" },
  { emoji: "🧬", name: "DNA" },
  { emoji: "🤖", name: "Robot" },
  { emoji: "🎨", name: "Artist palette" },
  { emoji: "🔍", name: "Magnifying glass tilted left" },
  // Technology
  { emoji: "💻", name: "Laptop" },
  { emoji: "📱", name: "Mobile phone" },
  { emoji: "☁️", name: "Cloud" },
  { emoji: "🌐", name: "Globe with meridians" },
  { emoji: "⚙️", name: "Gear" },
  { emoji: "🛠️", name: "Hammer and wrench" },
  { emoji: "🧩", name: "Puzzle piece" },
  { emoji: "🔗", name: "Link" },
  { emoji: "🛰️", name: "Satellite" },
  { emoji: "🔋", name: "Battery" },
  // Trust
  { emoji: "🔒", name: "Locked" },
  { emoji: "🛡️", name: "Shield" },
  { emoji: "🔑", name: "Key" },
  { emoji: "✅", name: "Check mark button" },
  { emoji: "⚠️", name: "Warning" },
  { emoji: "🚧", name: "Construction" },
  // Business
  { emoji: "💰", name: "Money bag" },
  { emoji: "💼", name: "Briefcase" },
  { emoji: "🏦", name: "Bank" },
  { emoji: "🏢", name: "Office building" },
  { emoji: "🏭", name: "Factory" },
  { emoji: "🤝", name: "Handshake" },
  { emoji: "📦", name: "Package" },
  { emoji: "🛒", name: "Shopping cart" },
  { emoji: "💎", name: "Gem stone" },
  // People and voice
  { emoji: "👥", name: "Busts in silhouette" },
  { emoji: "💬", name: "Speech balloon" },
  { emoji: "📣", name: "Megaphone" },
  { emoji: "🎤", name: "Microphone" },
  { emoji: "👋", name: "Waving hand" },
  { emoji: "🙌", name: "Raising hands" },
  { emoji: "👏", name: "Clapping hands" },
  { emoji: "❓", name: "Red question mark" },
  // Time and plans
  { emoji: "⏱️", name: "Stopwatch" },
  { emoji: "⏳", name: "Hourglass not done" },
  { emoji: "🗓️", name: "Spiral calendar" },
  { emoji: "📋", name: "Clipboard" },
  { emoji: "📝", name: "Memo" },
  // Learning
  { emoji: "🎓", name: "Graduation cap" },
  { emoji: "📚", name: "Books" },
  { emoji: "📖", name: "Open book" },
  // World, energy and health
  { emoji: "🌱", name: "Seedling" },
  { emoji: "🌍", name: "Globe showing Europe-Africa" },
  { emoji: "♻️", name: "Recycling symbol" },
  { emoji: "⚡", name: "High voltage" },
  { emoji: "🔥", name: "Fire" },
  { emoji: "💧", name: "Droplet" },
  { emoji: "☀️", name: "Sun" },
  { emoji: "🏥", name: "Hospital" },
  { emoji: "❤️", name: "Red heart" },
  // Celebration
  { emoji: "🎉", name: "Party popper" },
  { emoji: "🌟", name: "Glowing star" },
];

/** The emoji without its presentation selector, which writers often omit. */
function bare(text: string): string {
  return text.replace(/\u{FE0F}/gu, "");
}

const BY_BARE = new Map(EMOJI_ACCENTS.map((accent) => [bare(accent.emoji), accent]));

/** The palette entry for an emoji, however it was written, or undefined. */
export function accentFor(raw: unknown): EmojiAccent | undefined {
  if (typeof raw !== "string") return undefined;
  return BY_BARE.get(bare(raw.trim()));
}

/**
 * The picture's file stem: its code points in lowercase hex joined by "-",
 * the presentation selector left out — the naming Twemoji and Noto use.
 */
export function accentFile(accent: EmojiAccent): string {
  return [...bare(accent.emoji)]
    .map((char) => (char.codePointAt(0) ?? 0).toString(16))
    .join("-");
}

/** Where an accent's picture is served from (canonical; prefixed at render). */
export const EMOJI_ASSET_DIR = "/static/emoji";

/** The canonical URL of an emoji's picture, or undefined off the palette. */
export function accentSrc(emoji: unknown): string | undefined {
  const accent = accentFor(emoji);
  return accent ? `${EMOJI_ASSET_DIR}/${accentFile(accent)}.png` : undefined;
}

function isText(node: Descendant): node is TText {
  return typeof (node as TText).text === "string" && !(node as TElement).type;
}

function firstText(nodes: Descendant[] | undefined): string {
  for (const node of nodes ?? []) {
    const text = isText(node) ? node.text : firstText((node as TElement).children);
    if (text.trim()) return text;
  }
  return "";
}

/**
 * The palette emoji a slide's title opens with — "🚀 Launch week" — the
 * model's other way of proposing an accent. Read before clean.ts takes
 * emoji out of the text.
 */
export function titleAccent(nodes: Descendant[]): string | undefined {
  const lead = nodes[leadHeadingIndex(nodes)] as TElement | undefined;
  if (!lead) return undefined;
  const opening = leadingEmoji(firstText(lead.children));
  return opening ? accentFor(opening)?.emoji : undefined;
}

/**
 * The layouts that wear an accent: the display moments a deck pauses on.
 * Content, data and quote layouts never do — there the emoji would sit on a
 * slide that is busy being read. Quote layouts have a glyph of their own, and
 * full-bleed slides a photograph.
 */
export const ACCENT_ARCHETYPES: ReadonlySet<string> = new Set([
  "hero",
  "divider",
  "statement",
  "closing",
]);

/**
 * Tones whose decks keep emoji to the cover and the close. Microsoft's
 * Writing Style Guide keeps emoji off serious topics, and house style guides
 * that cover decks keep them out of formal ones. Matched as words in the
 * deck's tone: the New page's "academic", and template tones such as
 * "measured, executive", "precise, evidence-led" and "objective, analytical".
 */
const RESTRAINED_TONE =
  /\b(academic|formal|executive|board|investor|legal|regulatory|compliance|financial|scientific|clinical|evidence|analytical|precise|measured|objective|authoritative)\b/i;

/** Whether a deck of this tone keeps emoji to its cover and close. */
export function restrainedTone(tone: string | null | undefined): boolean {
  return Boolean(tone && RESTRAINED_TONE.test(tone));
}

/**
 * A regenerated slide with the accent its predecessor had: the deck's emoji
 * were settled when it was made, or chosen and removed by hand since, and a
 * rewrite of one slide's words is not a reason to change them.
 */
export function keepAccentOf(previous: PlateSlide, next: PlateSlide): PlateSlide {
  const kept = { ...next };
  delete kept.emojiHint;
  delete kept.emoji;
  return previous.emoji ? { ...kept, emoji: previous.emoji } : kept;
}

/**
 * Settle a generated deck's accents. A slide keeps the emoji the model
 * proposed (`emojiHint`) when it is on the palette, the slide is one of the
 * display moments and has a title, and no earlier slide used the same emoji;
 * every proposal is then dropped from the slide. With `restrained`, only the
 * cover and the close keep theirs.
 */
export function chooseEmojiAccents(
  slides: PlateSlide[],
  options: { restrained?: boolean } = {},
): PlateSlide[] {
  const used = new Set<string>();
  return slides.map((slide) => {
    if (!("emojiHint" in slide) && !slide.emoji) return slide;
    const rest = { ...slide };
    delete rest.emojiHint;
    if (rest.emoji) {
      used.add(bare(rest.emoji));
      return rest;
    }
    const accent = accentFor(slide.emojiHint);
    const archetype = slide.archetype ?? "";
    const allowed = options.restrained
      ? archetype === "hero" || archetype === "closing"
      : ACCENT_ARCHETYPES.has(archetype);
    if (
      !accent ||
      !allowed ||
      leadHeadingIndex(slide.content) === -1 ||
      used.has(bare(accent.emoji))
    ) {
      return rest;
    }
    used.add(bare(accent.emoji));
    return { ...rest, emoji: accent.emoji };
  });
}
