import { describe, expect, it } from "vitest";
import {
  isScriptedRequest,
  scriptedSlideCount,
} from "@/lib/generation/prompts/scripted";
import { buildOutlinePrompt } from "@/lib/generation/prompts/outline";

const BLUEPRINT = [
  { heading: "The Hook", guidance: "Open with tension." },
  { heading: "The Crack", guidance: "Show what is breaking." },
];

describe("scripted requests", () => {
  it("counts the slides a brief numbers itself", () => {
    // The markers as they appear in the lecture brief that lost a slide.
    const brief = [
      "SLIDE-BY-SLIDE SPEC",
      "Slide 1: Title (hero background)",
      "Slide 2: Hook",
      "Slide 3: Agenda",
      "Slide 9: AI across industries",
      "Slide 20: Thank you (hero background)",
    ].join("\n");
    expect(scriptedSlideCount(brief)).toBe(5);
    expect(isScriptedRequest(brief)).toBe(true);
  });

  it("recognises common marker styles", () => {
    const styles = "### Slide 1 — Intro\n* Slide 2. Problem\n- SLIDE 3) Plan\n> Slide 4 - Ask";
    expect(scriptedSlideCount(styles)).toBe(4);
  });

  it("counts each slide once", () => {
    expect(scriptedSlideCount("Slide 1: A\nSlide 1: A again\nSlide 2: B")).toBe(2);
  });

  it("does not treat a passing mention as a script", () => {
    expect(isScriptedRequest("An investor pitch; make slide 2 the problem slide.")).toBe(false);
    expect(isScriptedRequest("Slide 1: intro\nSlide 2: close")).toBe(false);
    expect(isScriptedRequest(null)).toBe(false);
  });

  it("drops the blueprint from the outline contract for a scripted request", () => {
    // Regression: a 20-slide brief run through a 9-section template got the
    // template's arc, lost its own slide 9 and gained invented slides.
    const { system } = buildOutlinePrompt({
      prompt: "Slide 1: A\nSlide 2: B\nSlide 3: C",
      kind: "deck",
      nCards: 3,
      language: "English",
      currentDate: "2026-10-16",
      templateSections: BLUEPRINT,
      templateGuidance: "Big type, big ideas.",
      scriptedSlides: 3,
    });
    expect(system).toContain("Scripted-request contract");
    expect(system).toContain("Do not add, skip, merge, rename or reorder");
    expect(system).not.toContain("Template contract");
    expect(system).not.toContain("The Crack");
    // The template still lends its direction.
    expect(system).toContain("Big type, big ideas.");
  });

  it("keeps the blueprint for an ordinary prompt", () => {
    const { system } = buildOutlinePrompt({
      prompt: "A keynote about voice AI",
      kind: "deck",
      nCards: 2,
      language: "English",
      currentDate: "2026-10-16",
      templateSections: BLUEPRINT,
    });
    expect(system).toContain("Template contract");
    expect(system).not.toContain("Scripted-request contract");
  });

  it("explains how to reconcile a different requested count", () => {
    const { system } = buildOutlinePrompt({
      prompt: "x",
      kind: "deck",
      nCards: 15,
      language: "English",
      currentDate: "2026-10-16",
      scriptedSlides: 20,
    });
    expect(system).toContain("merge the most closely related adjacent ones");
  });
});
