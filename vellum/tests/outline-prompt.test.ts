/**
 * The user's slide count is authoritative, even on a template.
 *
 * Regression: both the outline route and the prompt builder derived the count
 * from `template.sections.length`, so choosing Pitch Deck (8 sections) and
 * then asking for 10 slides silently produced 8.
 */
import { describe, expect, it } from "vitest";
import { buildOutlinePrompt } from "@/lib/generation/prompts/outline";
import { getTemplate, templates } from "@/lib/templates/library";

const pitch = getTemplate("pitch-deck")!;

function prompt(nCards: number, withTemplate = true) {
  return buildOutlinePrompt({
    kind: "deck",
    prompt: "Aurora Robotics seed round",
    nCards,
    language: "English",
    currentDate: "2026-08-11",
    ...(withTemplate
      ? { templateSections: pitch.sections, templateGuidance: pitch.globalGuidance }
      : {}),
  });
}

describe("outline prompt card count", () => {
  it("the pitch deck blueprint is the 8-section case this regressed on", () => {
    expect(pitch.nCards).toBe(8);
    expect(pitch.sections.length).toBe(8);
  });

  it("every template's default count matches its blueprint length", () => {
    // If these drift, the create form's default contradicts the blueprint.
    for (const template of templates) {
      expect(
        `${template.id}:${template.nCards}`,
        `${template.id} nCards should equal sections.length`,
      ).toBe(`${template.id}:${template.sections.length}`);
    }
  });

  it("asks for exactly the requested count, above the blueprint length", () => {
    const { system } = prompt(10);
    expect(system).toContain("exactly 10 slide entries");
    expect(system).toContain("asked for 10 slides but the blueprint lists 8");
    expect(system).toContain("add 2 more");
    // The old bug: the prompt demanded the blueprint's own count.
    expect(system).not.toContain("exactly the 8 blueprint");
  });

  it("asks for exactly the requested count, below the blueprint length", () => {
    const { system } = prompt(6);
    expect(system).toContain("exactly 6 slide entries");
    expect(system).toContain("asked for 6 slides but the blueprint lists 8");
    expect(system).toContain("MERGING");
    expect(system).toContain("opening and the closing");
  });

  it("keeps the strict blueprint contract when the counts already agree", () => {
    const { system } = prompt(8);
    expect(system).toContain("exactly the 8 blueprint slide entries");
    expect(system).toContain("IN THIS ORDER");
    expect(system).not.toContain("blueprint lists");
  });

  it("still states the count without a template", () => {
    const { system } = prompt(12, false);
    expect(system).toContain("exactly 12 slide");
    expect(system).not.toContain("Blueprint");
  });

  it("always shows the blueprint so the arc survives a count change", () => {
    for (const n of [6, 8, 10]) {
      const { system } = prompt(n);
      for (const section of pitch.sections) {
        expect(system).toContain(section.heading);
      }
    }
  });
});
