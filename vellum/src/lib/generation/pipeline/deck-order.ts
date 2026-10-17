/**
 * Deck order after the model has written it: cut to the requested count
 * without losing the ending, and end on the sign-off.
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import { isSignOff, signatureOf } from "@/lib/design/archetypes";

function isSignOffSlide(slide: PlateSlide): boolean {
  return isSignOff(signatureOf(slide).headingText);
}

/**
 * The deck cut to `count` slides, keeping its ending.
 *
 * The model writes more sections than the outline has cards — a cover it was
 * not asked for, section dividers between parts — and the ceiling trim kept
 * the first `count`. A 10-card pitch came back as 11 slides and lost the
 * eleventh: "The Ask", the slide a pitch exists for. The last slide now
 * stays when it is the ending (a closing layout or a sign-off); section
 * dividers the writer added go first, since they carry no content of their
 * own; the rest of the surplus comes from just before the ending.
 */
export function trimToCount(slides: PlateSlide[], count: number): PlateSlide[] {
  if (slides.length <= count) return slides;
  if (count < 2) return slides.slice(0, count);
  const last = slides[slides.length - 1];
  const ending = last.archetype === "closing" || isSignOffSlide(last) ? [last] : [];
  const body = slides.slice(0, slides.length - ending.length);
  let surplus = slides.length - count;
  const dividers = new Set<PlateSlide>();
  for (let index = body.length - 1; index > 0 && surplus > 0; index -= 1) {
    if (body[index].archetype === "divider") {
      dividers.add(body[index]);
      surplus -= 1;
    }
  }
  const kept = body.filter((slide) => !dividers.has(slide));
  return [...kept.slice(0, kept.length - surplus), ...ending];
}

/**
 * The slides with every sign-off last; the same array when nothing moves.
 *
 * Asked for 21 slides, the model wrote 24, with "Thank You" as the 20th and
 * four more after it, so the trimmed deck went on for a slide after saying
 * thank you. A sign-off followed by anything other than another sign-off
 * moves to the end; every other slide keeps its order. The cover never moves.
 */
export function endOnSignOff(slides: PlateSlide[]): PlateSlide[] {
  const signOff = slides.map((slide, index) => index > 0 && isSignOffSlide(slide));
  const lastOther = signOff.lastIndexOf(false);
  const early = slides.filter((_, index) => signOff[index] && index < lastOther);
  if (early.length === 0) return slides;
  return [...slides.filter((slide) => !early.includes(slide)), ...early];
}
