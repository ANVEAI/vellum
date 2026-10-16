import { describe, expect, it } from "vitest";
import { calendarDaysBetween, relativeDay } from "@/lib/dates";

// Local-time constructors, so the assertions hold in any timezone.
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe("library dates are calendar days", () => {
  /**
   * Regression, from the library: decks generated in the evening read
   * "Today" until the evening after, because the old code floored elapsed
   * 24-hour blocks.
   */
  it("calls an evening deck 'Yesterday' the next morning", () => {
    const generated = local(2026, 10, 15, 19, 37);
    const opened = local(2026, 10, 16, 11, 25); // 15h48m later
    expect(relativeDay(generated.toISOString(), opened)).toBe("Yesterday");
  });

  it("calls a deck from earlier the same day 'Today'", () => {
    expect(
      relativeDay(local(2026, 10, 16, 0, 5).toISOString(), local(2026, 10, 16, 23, 55)),
    ).toBe("Today");
  });

  it("flips at midnight, not 24 hours later", () => {
    const lateNight = local(2026, 10, 15, 23, 59);
    expect(relativeDay(lateNight.toISOString(), local(2026, 10, 16, 0, 1))).toBe(
      "Yesterday",
    );
  });

  it("counts days for the past week", () => {
    expect(relativeDay(local(2026, 10, 12, 9).toISOString(), local(2026, 10, 16, 8))).toBe(
      "4 days ago",
    );
  });

  it("shows a date after a week, with the year only when it differs", () => {
    const now = local(2026, 10, 16, 12);
    expect(relativeDay(local(2026, 10, 1, 12).toISOString(), now)).not.toMatch(/2026/);
    expect(relativeDay(local(2025, 10, 1, 12).toISOString(), now)).toMatch(/2025/);
  });

  it("treats a slightly-future timestamp (clock skew) as today", () => {
    expect(relativeDay(local(2026, 10, 16, 13).toISOString(), local(2026, 10, 16, 12))).toBe(
      "Today",
    );
  });

  it("returns nothing for an unparseable date", () => {
    expect(relativeDay("not a date")).toBe("");
  });

  it("counts calendar days independent of the time of day", () => {
    expect(calendarDaysBetween(local(2026, 10, 15, 23), local(2026, 10, 16, 1))).toBe(1);
    expect(calendarDaysBetween(local(2026, 10, 16, 1), local(2026, 10, 16, 23))).toBe(0);
  });
});
