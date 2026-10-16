import { describe, expect, it } from "vitest";
import { requestsSlideFurniture, stripTextRequests } from "@/lib/images/prompt-hygiene";

/**
 * The inputs here are real prompts taken from the generated deck whose images
 * came back reading "Tlcath", "Gode" and "Doglooldpletion".
 */
describe("image prompt hygiene", () => {
  it("drops a labelled-ring request but keeps the subject", () => {
    const { prompt, removed } = stripTextRequests(
      "dark purple background with concentric circles aligned at the bottom. Outer ring labeled 'Artificial Intelligence' in violet deepest. Next ring 'Machine Learning'",
    );
    expect(prompt).toContain("concentric circles");
    expect(prompt).not.toMatch(/Artificial Intelligence/i);
    expect(prompt).not.toMatch(/Machine Learning/i);
    expect(prompt).not.toMatch(/labeled/i);
    expect(removed.length).toBeGreaterThan(0);
  });

  it("strips hex colours", () => {
    const { prompt } = stripTextRequests(
      "three cards side by side, each card is dark indigo (#1A1736) with rounded corners",
    );
    expect(prompt).not.toContain("#1A1736");
    expect(prompt).toContain("rounded corners");
  });

  it("removes quoted literals wherever they appear", () => {
    const { prompt } = stripTextRequests(
      'a billboard that reads "Buy Now" beside a quiet road',
    );
    expect(prompt).not.toMatch(/Buy Now/);
    expect(prompt).toContain("quiet road");
  });

  it("removes on-image text nouns", () => {
    const { prompt } = stripTextRequests(
      "a city skyline at dusk with text overlay and a watermark",
    );
    expect(prompt).not.toMatch(/text overlay/i);
    expect(prompt).not.toMatch(/watermark/i);
    expect(prompt).toContain("city skyline");
  });

  it("leaves a clean photographic prompt untouched", () => {
    const clean =
      "cinematic wide-angle view of a futuristic smart city powered by renewable energy, morning haze, warm sunlight through glass towers";
    const { prompt, removed } = stripTextRequests(clean);
    expect(prompt).toBe(clean);
    expect(removed).toEqual([]);
  });

  it("never returns an empty prompt", () => {
    const { prompt } = stripTextRequests("labeled 'Growth'");
    expect(prompt.length).toBeGreaterThan(11);
  });

  it("does not leave dangling punctuation behind", () => {
    const { prompt } = stripTextRequests(
      "a quiet office, labeled 'Finance', soft morning light",
    );
    expect(prompt).not.toMatch(/,\s*,/);
    expect(prompt).not.toMatch(/^[\s,]/);
    expect(prompt).toContain("soft morning light");
  });

  it("keeps a device but blanks its screen", () => {
    // The real prompt behind a slide that shipped with gibberish UI on a phone.
    const { prompt, removed } = stripTextRequests(
      "modern smartphone screen displaying various AI applications like maps, voice assistant and secure banking interface",
    );
    expect(prompt).toMatch(/smartphone/);
    expect(prompt).toMatch(/blank screen/);
    expect(prompt).not.toMatch(/displaying/);
    expect(prompt).not.toMatch(/interface/i);
    expect(removed.length).toBeGreaterThan(0);
  });

  it("drops interface nouns", () => {
    const { prompt } = stripTextRequests("a designer reviewing a dashboard at dusk");
    expect(prompt).not.toMatch(/dashboard/i);
    expect(prompt).toContain("designer");
  });

  it("leaves a device with no screen content alone", () => {
    const clean = "a laptop on a wooden desk beside a cup of coffee, morning light";
    expect(stripTextRequests(clean).prompt).toBe(clean);
  });

  it("recognises requests for slide furniture", () => {
    // Real prompts from a generated deck.
    expect(
      requestsSlideFurniture(
        "nested concentric circles diagram showing AI evolution from outer artificial intelligence to inner generative AI",
      ),
    ).toBe(true);
    expect(
      requestsSlideFurniture("abstract glowing data visualization of neural networks connected to medical icons"),
    ).toBe(true);
    expect(requestsSlideFurniture("a bar chart of quarterly revenue")).toBe(true);
  });

  it("does not mistake an ordinary subject for furniture", () => {
    expect(requestsSlideFurniture("children laughing on a playground slide")).toBe(false);
    expect(requestsSlideFurniture("container cranes at a harbour at dusk")).toBe(false);
    expect(requestsSlideFurniture("a glowing violet orb against a deep indigo sky")).toBe(false);
  });
});

