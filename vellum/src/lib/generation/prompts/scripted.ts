/**
 * Does the request already list its own slides?
 *
 * A template is a narrative arc for a short prompt: "a keynote about voice
 * AI" becomes hook, status quo, crack, number, shift. A request that already
 * spells out every slide — "Slide 1: Title … Slide 20: Thank you" — has its
 * arc. Forcing a blueprint onto it made the two fight: a 20-slide lecture
 * brief run through Conference Keynote got an outline of "THE HOOK —", "THE
 * CRACK —" entries that dropped the brief's own slide 9 and invented "Q&A and
 * Next Steps" and "Where to Find Us"; the content stage followed the brief,
 * skipped the slide the outline never had, and shipped 19 of 20.
 *
 * When the request is scripted, its slide list is the contract and the
 * template contributes only its tone and overall direction.
 */

/** "Slide 3:", "Slide 3 -", "### Slide 3 —", "SLIDE 3." at the start of a line. */
const SLIDE_MARKER = /^[\s#>*-]*slide\s+(\d{1,3})\s*[:.\-–—)]/gim;

/** The number of distinct slides the request enumerates (0 if none). */
export function scriptedSlideCount(prompt: string | null | undefined): number {
  if (!prompt) return 0;
  const seen = new Set<string>();
  for (const match of prompt.matchAll(SLIDE_MARKER)) seen.add(match[1]);
  return seen.size;
}

/**
 * Three or more distinct numbered slides. Fewer is a prompt that mentions a
 * slide in passing ("make slide 2 punchier"), not a script.
 */
export function isScriptedRequest(prompt: string | null | undefined): boolean {
  return scriptedSlideCount(prompt) >= 3;
}
