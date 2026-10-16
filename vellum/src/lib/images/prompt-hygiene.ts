/**
 * Strip text-rendering requests out of an image prompt before it reaches the
 * image model.
 *
 * Diffusion models render requested words as convincing gibberish. A deck
 * generated from a design brief showed exactly this: the model, asked for
 * "concentric circles, outer ring labeled 'Artificial Intelligence'", got
 * back rings of invented letterforms, and a slide asking for "five cards
 * listing Text, Images, Video, Audio, Code" came back with cards reading
 * "Tlcath", "Gode", "Godd".
 *
 * The negative prompt cannot be relied on to prevent this. FLUX.1-schnell is
 * guidance-distilled and runs at guidance 0, so its negative conditioning has
 * almost no weight; "text, letters" sat in the negative block for every style
 * preset while the gibberish was generated anyway. Phrasing it as a negation
 * in the positive prompt does not work either — these models handle "no text"
 * poorly. The reliable fix is to not ask in the first place, which is what
 * this does.
 *
 * The prompt guidance tells the model the same thing; this is the backstop for
 * when it is overridden by a user brief that spells out labelled diagrams.
 */

/** Quoted literals: the single clearest "render this word" signal. */
const QUOTED = /["“”'‘’]([^"“”'‘’]{1,80})["“”'‘’]/g;

/** Hex colours — meaningless to the model, and they invite UI rendering. */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * Markers that introduce words to be drawn. Only the marker is removed, not
 * the clause after it: an earlier version consumed to the next boundary and
 * ate the scene with it, turning "a billboard that reads 'Buy Now' beside a
 * quiet road" into "a billboard".
 */
const TEXT_CLAUSE =
  /\b(?:labell?ed|titled|captioned|annotated|inscribed|reading|that reads?|which reads?|that says?|saying|with the (?:text|word|words|label|caption|title)|displaying the (?:text|word|words))\b/gi;

/**
 * A device showing content. The device is a fine subject; whatever is on its
 * screen is rendered as invented lettering. A real slide displayed "a
 * smartphone screen displaying various AI applications like maps, voice
 * assistant and secure banking interface" — every label on it gibberish. The
 * device survives with a blank screen, which is the one way to describe a
 * screen these models render cleanly: describe the surface as empty rather
 * than negate what is on it.
 */
const SCREEN_CONTENT =
  /\b(smartphone|phone|laptop|tablet|monitor|computer|display|screen|tv|television)((?:\s+screen)?)\s+(?:displaying|showing|featuring|running|with)\b[^.;]*/gi;

/** Interfaces, which are made of words. */
const UI_NOUN =
  /\b(?:user interfaces?|interfaces?|dashboards?|app screens?|websites?|web pages?|infographics?|spreadsheets?)\b/gi;

/** Standalone requests for lettering. */
const TEXT_NOUN =
  /\b(?:text overlay|on-image text|lettering|typography|watermark|signage|subtitle|caption)s?\b/gi;

function tidy(text: string): string {
  return text
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s*,\s*([.;])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/^[\s,;.]+/, "")
    .replace(/[\s,;]+$/, "")
    .trim();
}

/**
 * Requests for slide furniture rather than a subject. The renderer draws
 * charts, diagrams, timelines and icons natively; an image model asked for
 * one draws a convincing imitation covered in invented labels. These cannot
 * be cleaned up the way a stray caption can — removing the word leaves no
 * subject — so a prompt that asks for one is not worth sending at all.
 */
const FURNITURE =
  /\b(?:diagrams?|flow ?charts?|org(?:anization(?:al)?)? charts?|charts?|graphs?|infographics?|data visuali[sz]ations?|visuali[sz]ations?|timelines?|dashboards?|wireframes?|mockups?|mock-ups?|icons?|icon sets?|presentation slides?|slide layouts?|spreadsheets?)\b/i;

/** Whether an image prompt asks for slide furniture instead of a subject. */
export function requestsSlideFurniture(prompt: string): boolean {
  return FURNITURE.test(prompt);
}

export interface PromptHygieneResult {
  prompt: string;
  /** What was removed, for the log. Empty when the prompt was already clean. */
  removed: string[];
}

/**
 * Remove text-rendering requests. Returns the cleaned prompt and what went.
 *
 * Deliberately conservative: it strips the request for lettering, not the
 * subject. "A timeline with eight dots labelled '1950'" keeps the timeline —
 * the renderer draws real timelines, and a vague backdrop is a better outcome
 * than invented glyphs either way.
 */
export function stripTextRequests(prompt: string): PromptHygieneResult {
  const removed: string[] = [];
  const note = (match: string) => {
    const trimmed = match.trim();
    if (trimmed) removed.push(trimmed);
    return " ";
  };

  // Quotes first: once the literal is gone the marker before it is just a
  // stray word, so removing markers cannot swallow the surrounding scene.
  let out = prompt;
  out = out.replace(QUOTED, note);
  out = out.replace(TEXT_CLAUSE, note);
  out = out.replace(HEX_COLOR, note);
  out = out.replace(SCREEN_CONTENT, (match, device: string, screen: string) => {
    note(match);
    return ` ${device}${screen} with a dark, blank screen `;
  });
  out = out.replace(UI_NOUN, note);
  out = out.replace(TEXT_NOUN, note);

  const cleaned = tidy(out);
  // Never hand back an empty prompt: a prompt that was nothing but text
  // requests still has to generate something for the slot.
  if (cleaned.length < 12) {
    return {
      prompt: "abstract soft-focus background texture, muted tones, no subject",
      removed,
    };
  }
  return { prompt: cleaned, removed };
}
