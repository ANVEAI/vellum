import { describe, expect, it } from "vitest";
import {
  applyImageToSlides,
  imageSlotKey,
  newestJobPerSlot,
} from "@/lib/images/patch-slides";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const at = (ms: number) => new Date(1_760_000_000_000 + ms);

describe("only the newest job may write an image slot", () => {
  /**
   * Regression, from a real deck: the quality gate regenerated slide 6 and
   * kept its id. The job queued for the ORIGINAL content ("smartphone screen
   * showing maps and a banking interface") finished and landed on the new
   * content, whose query asked for a plain glow.
   */
  it("prefers the job queued after a regeneration", () => {
    const stale = {
      id: "a1",
      slideId: "s6",
      nodeId: "__root__",
      createdAt: at(0),
      prompt: "smartphone screen showing maps and a banking interface",
    };
    const fresh = {
      id: "b2",
      slideId: "s6",
      nodeId: "__root__",
      createdAt: at(40_000),
      prompt: "a winding mountain path at dawn",
    };
    const newest = newestJobPerSlot([fresh, stale]);
    expect(newest.get(imageSlotKey("s6", "__root__"))).toBe(fresh);
  });

  it("keeps slots independent", () => {
    const root = { id: "a", slideId: "s1", nodeId: "__root__", createdAt: at(0) };
    const item = { id: "b", slideId: "s1", nodeId: "img-1", createdAt: at(0) };
    const other = { id: "c", slideId: "s2", nodeId: "__root__", createdAt: at(0) };
    const newest = newestJobPerSlot([root, item, other]);
    expect(newest.size).toBe(3);
  });

  it("breaks a createdAt tie by id, which sorts by creation", () => {
    const first = { id: "cm0001", slideId: "s", nodeId: "n", createdAt: at(5) };
    const second = { id: "cm0002", slideId: "s", nodeId: "n", createdAt: at(5) };
    expect(newestJobPerSlot([second, first]).get(imageSlotKey("s", "n"))).toBe(second);
  });

  it("still lets the editor replace a picture with a different prompt", () => {
    // The editor's regenerate action sends a NEW prompt for the same slot, so
    // a prompt-equals-query check would have rejected it. Recency does not.
    const generated = { id: "a", slideId: "s", nodeId: "__root__", createdAt: at(0) };
    const userAsked = { id: "b", slideId: "s", nodeId: "__root__", createdAt: at(90_000) };
    expect(newestJobPerSlot([generated, userAsked]).get(imageSlotKey("s", "__root__"))).toBe(
      userAsked,
    );
  });

  it("applies a root image without consulting the query", () => {
    const slides = [
      { id: "s", content: [], rootImage: { query: "edited by the user" } },
    ] as unknown as PlateSlide[];
    expect(applyImageToSlides(slides, "s", "__root__", "original prompt", "/u.png")).toBe(true);
    expect((slides[0].rootImage as { url?: string }).url).toBe("/u.png");
  });

  /**
   * Regression: the gate rewrote three slides without images, and jobs for
   * their original content still landed — the patcher created a root image
   * from nothing to hold each one.
   */
  it("never creates a root image the slide no longer has", () => {
    const slides = [{ id: "s", content: [] }] as unknown as PlateSlide[];
    expect(applyImageToSlides(slides, "s", "__root__", "stale prompt", "/x.png")).toBe(false);
    expect(slides[0].rootImage).toBeUndefined();
  });

  it("fills a root image slot that is still wanted", () => {
    const slides = [{ id: "s", content: [], rootImage: { query: "q" } }] as unknown as PlateSlide[];
    expect(applyImageToSlides(slides, "s", "__root__", "q", "/x.png")).toBe(true);
  });
});

