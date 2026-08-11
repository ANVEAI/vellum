/**
 * Streaming-parse hygiene.
 *
 * Mid-stream the buffer routinely ends inside a tag. `finalize()` force-closes
 * an open section with "</SECTION>", which used to weld onto the fragment:
 * "<CALLO" + "</SECTION>" parsed as a tag named `CALLO</SECTION`, logging
 * "Unknown top-level tag: CALLO</SECTION" on nearly every tick of a real
 * generation — and leaving a junk node if the model's output really was cut
 * short.
 *
 * Also locks the contract the app depends on: a full reparse of the
 * cumulative buffer must equal a single parse of the finished string, at any
 * chunk boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideParser, type PlateSlide } from "@/lib/generation/parser/slide-parser";

const DECK = `<PRESENTATION>
  <SECTION layout="left"><TITLE>Teaching Managers AI</TITLE><P>Start small, verify always.</P><IMG query="a manager at a laptop" /><NOTES>Open with the cost of guessing.</NOTES></SECTION>
  <SECTION layout="right"><H1>Where judgment still wins</H1><BULLETS><DIV><H3>Framing</H3><P>Models answer what you ask.</P></DIV><DIV><H3>Review</H3><P>Verify before you forward.</P></DIV></BULLETS><CALLOUT type="note"><P>Never paste customer data.</P></CALLOUT><NOTES>Land the judgment point.</NOTES></SECTION>
  <SECTION layout="vertical"><H1>A ninety day path</H1><TIMELINE><DIV><H3>Weeks 1-4</H3><P>Shadow one workflow.</P></DIV><DIV><H3>Weeks 5-12</H3><P>Automate the boring half.</P></DIV></TIMELINE><LABEL>Rollout</LABEL><NOTES>Close on the timeline.</NOTES></SECTION>
</PRESENTATION>`;

function parseWhole(xml: string): PlateSlide[] {
  const parser = new SlideParser({ mode: "deck" });
  parser.parseChunk(xml);
  parser.finalize();
  return parser.getAllSlides();
}

/** How the app streams: fresh parser, whole cumulative buffer, every tick. */
function parseStreamed(xml: string, chunk: number): PlateSlide[] {
  let cumulative = "";
  let slides: PlateSlide[] = [];
  for (let i = 0; i < xml.length; i += chunk) {
    cumulative += xml.slice(i, i + chunk);
    const parser = new SlideParser({ mode: "deck" });
    parser.reset();
    parser.parseChunk(cumulative);
    parser.finalize();
    slides = parser.getAllSlides();
  }
  return slides;
}

const shape = (slides: PlateSlide[]) =>
  slides.map((s) => s.content.map((n) => (n as { type?: string }).type).join("+")).join(" | ");

describe("streaming parse", () => {
  let warnings: string[] = [];
  let original: typeof console.warn;

  beforeEach(() => {
    warnings = [];
    original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };
  });
  afterEach(() => {
    console.warn = original;
    vi.restoreAllMocks();
  });

  it("never invents a tag name welded to the closing SECTION", () => {
    // Every prefix of the deck is a legitimate mid-stream buffer state.
    for (let cut = 1; cut <= DECK.length; cut++) {
      const parser = new SlideParser({ mode: "deck" });
      parser.reset();
      parser.parseChunk(DECK.slice(0, cut));
      parser.finalize();
    }
    const welded = warnings.filter((message) => message.includes("</SECTION"));
    expect(welded).toEqual([]);
  });

  it("logs no unknown-tag warnings at all while streaming", () => {
    for (let cut = 1; cut <= DECK.length; cut++) {
      const parser = new SlideParser({ mode: "deck" });
      parser.reset();
      parser.parseChunk(DECK.slice(0, cut));
      parser.finalize();
    }
    const unknown = warnings.filter((message) =>
      message.includes("Unknown top-level tag"),
    );
    expect(unknown).toEqual([]);
  });

  it("a buffer cut inside a tag drops only the unfinished element", () => {
    const upto = DECK.indexOf("<CALLOUT");
    const parser = new SlideParser({ mode: "deck" });
    parser.reset();
    // "…</BULLETS><CALLO" — the classic mid-tag cut.
    parser.parseChunk(DECK.slice(0, upto + 6));
    parser.finalize();
    const slides = parser.getAllSlides();
    const types = slides.flatMap((s) =>
      s.content.map((n) => String((n as { type?: string }).type)),
    );
    // The finished blocks survive; nothing named after the closing tag appears.
    expect(types).toContain("bullets");
    expect(types.some((t) => t.includes("SECTION") || t.includes("CALLO"))).toBe(false);
  });

  it("streamed parsing matches a single parse at every chunk size", () => {
    const expected = shape(parseWhole(DECK));
    expect(expected).not.toBe("");
    for (const size of [1, 2, 3, 5, 13, 64, 512]) {
      expect(shape(parseStreamed(DECK, size)), `chunk size ${size}`).toBe(expected);
    }
  });

  it("keeps every slide's blocks when the stream ends cleanly", () => {
    const slides = parseWhole(DECK);
    expect(slides).toHaveLength(3);
    // IMG and NOTES ride on the slide (rootImage / speakerNote) rather than
    // the content array, so the shapes are title+p, h1+bullets+note,
    // h1+timeline+label.
    expect(slides.map((s) => s.content.length)).toEqual([2, 3, 3]);
    expect(Boolean(slides[0].rootImage)).toBe(true);
    expect(slides.every((s) => (s.speakerNote ?? "").length > 0)).toBe(true);
  });

  it("truncated output keeps what arrived and drops only the cut element", () => {
    // The model hit its limit mid-tag: "…<H1>A ninety day path</H1><TIMEL".
    const truncated = DECK.slice(0, DECK.indexOf("<TIMELINE") + 5);
    const slides = parseWhole(truncated);
    expect(slides).toHaveLength(3);
    // Earlier slides are untouched; the last keeps its heading and simply
    // lacks the timeline that never finished arriving.
    expect(slides.map((s) => s.content.length)).toEqual([2, 3, 1]);
    const types = slides.flatMap((s) =>
      s.content.map((n) => String((n as { type?: string }).type)),
    );
    expect(types).toEqual(["presentation-title", "p", "h1", "bullets", "note", "h1"]);
    expect(types.some((t) => t.includes("SECTION") || t.includes("TIMEL"))).toBe(false);
  });
});
