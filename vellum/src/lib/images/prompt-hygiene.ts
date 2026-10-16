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

/**
 * Written marks as a subject in their own right. "A glowing orb generating
 * colorful particles of text" came back as an orb ringed with invented
 * words; "sound waves turning into digital code" and "an orb emitting data
 * streams" as fields of made-up numerals.
 */
const WRITTEN_MARKS =
  /\b(?:lines of code|(?:binary|digital|computer|source|programming) code|code|text|letters|words|numbers|digits|numerals|glyphs|equations?|formulas?)\b/gi;

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
// Maps are here too: every place on one is a name, and "a map of India
// glowing with data lines" came back covered in invented city names.
const FURNITURE =
  /\b(?:diagrams?|flow ?charts?|org(?:anization(?:al)?)? charts?|charts?|graphs?|infographics?|data visuali[sz]ations?|visuali[sz]ations?|timelines?|dashboards?|wireframes?|mockups?|mock-ups?|icons?|icon sets?|presentation slides?|slide layouts?|spreadsheets?|maps?)\b/i;

const DEVICE =
  /\b(?:smartphones?|phones?|laptops?|tablets?|monitors?|computers?|screens?|displays?|tvs?|televisions?)\b/i;

/**
 * Say that a device's screen is dark and blank.
 *
 * A person "using a tablet" or "looking at a computer screen" is a good
 * subject, but the image model fills an undescribed screen with an interface,
 * and an interface is made of invented words. Describing the surface as
 * empty is the one phrasing it renders cleanly (negating what is on it does
 * not work on a guidance-distilled model), so a prompt that mentions a device
 * and does not already say so gets it said. This adds, never removes: the
 * subject is kept as written.
 */
export function blankScreens(prompt: string): string {
  if (!DEVICE.test(prompt) || /\bblank screens?\b/i.test(prompt)) return prompt;
  return `${prompt.replace(/[\s.]+$/, "")}, every screen in the picture dark and blank`;
}

/** Whether an image prompt asks for slide furniture instead of a subject. */
export function requestsSlideFurniture(prompt: string): boolean {
  return FURNITURE.test(prompt);
}

/**
 * Words that describe a surface, a light, a colour or a treatment — what an
 * image looks like, never what it shows.
 */
const TREATMENT_WORDS = new Set(
  (
    "abstract background backgrounds backdrop backdrops gradient gradients glow glows glowing light lights lighting lit " +
    "radial soft subtle gentle smooth texture textured textures pattern patterns bokeh blur blurred blurry wallpaper haze " +
    "hazy mist misty fog foggy atmosphere atmospheric ambient aura halo vignette shimmer shimmering sparkle sparkles " +
    "sparkling particles particle dust dots lines shapes waves wave wavy flowing swirl swirls swirling curves curved " +
    "geometric minimal minimalist minimalistic clean simple elegant modern sleek premium cinematic dramatic moody dark " +
    "darker deep rich vibrant muted pale bright vivid luminous neon space negative copy side sides left right top bottom " +
    "center centre corner corners edge edges upper lower area empty wide composition style styled aesthetic tone tones " +
    "toned hue hues palette color colors colour colours colored coloured shade shades highlight highlights shadow shadows " +
    "depth field focus soft-focus high quality detailed hd 4k 8k render rendered rendering scene image photo photograph " +
    "illustration artwork art visual background-only overlay overlays layer layers blend blended noise grain grainy " +
    "black white grey gray red orange yellow green blue purple violet indigo magenta pink teal cyan gold golden silver " +
    "navy maroon crimson amber emerald turquoise lavender lilac plum burgundy beige cream ivory charcoal midnight cobalt " +
    "azure sapphire ruby coral peach mint lime olive bronze copper rose scarlet aqua ultraviolet monochrome monochromatic " +
    "duotone pastel tinted tint glossy matte metallic iridescent holographic ethereal dreamy serene calm warm cool " +
    // Composition notes: where the text will go, not what the picture shows.
    // "The left side has clean, sharp negative space for text."
    "sharp crisp centered centred large small big huge ample plenty room open spacious uncluttered breathing " +
    "framed framing frame positioned placed portion half whole full faint faintly subtly softly gently text title titles"
  ).split(" "),
);

const LINKING_WORDS = new Set(
  "a an the with and or of on in at to for from by into onto over under behind beside across along around within throughout featuring showing having has have leaving leaves very slightly some its their this that these those as like is are be".split(
    " ",
  ),
);

/**
 * Whether an image prompt describes only a look — colours, light, texture —
 * with nothing in it to depict.
 *
 * Given a brief that specified a dark purple deck, the model asked for
 * "Abstract dark purple background with a soft violet radial glow on the
 * right side, minimalist, cinematic" on three slides, a slide about an AI
 * agent among them. The deck's theme already supplies the background; an
 * image that repeats it says nothing about the slide it sits on.
 */
export function requestsBackdropOnly(prompt: string): boolean {
  const words = prompt.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  return words.every(
    (word) => TREATMENT_WORDS.has(word) || LINKING_WORDS.has(word) || /^\d+$/.test(word),
  );
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
  out = out.replace(WRITTEN_MARKS, note);

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
