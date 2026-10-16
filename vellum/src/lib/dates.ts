/**
 * Human dates for the library.
 *
 * "Today" and "Yesterday" are calendar facts, not durations. The previous
 * version computed `floor((now - then) / 24h)`, which counts elapsed 24-hour
 * blocks: a deck generated at 19:00 and opened at 11:25 the next morning is
 * 16 hours old, floors to 0, and read "Today". Anything made in the evening
 * was mislabelled for most of the following day.
 *
 * Days are counted between local midnights in the viewer's timezone, which
 * is what a reader means by the words.
 */

const DAY_MS = 86_400_000;

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `then` to `now` in local time; 0 = same day. */
export function calendarDaysBetween(then: Date, now: Date): number {
  // Rounded rather than floored: a span that crosses a DST change is 23 or
  // 25 hours between midnights, and rounding absorbs it.
  return Math.round((localMidnight(now) - localMidnight(then)) / DAY_MS);
}

/** "Today", "Yesterday", "3 days ago", "Oct 9", or "Oct 9, 2025". */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = calendarDaysBetween(then, now);
  // A future date only arises from clock skew between machines.
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Full local date and time, for a tooltip. */
export function fullDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
