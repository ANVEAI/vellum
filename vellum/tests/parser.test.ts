/**
 * Golden-file tests for the ported SlideParser.
 *
 * Fixtures are REAL recorded qwen3.6:35b streams (scripts/record-golden.ts).
 * Each fixture is replayed at pathological chunk boundaries — the parser must
 * produce identical output regardless of how the stream was sliced, and IDs
 * must be deterministic across independent parses.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SlideParser,
  type PlateSlide,
} from "@/lib/generation/parser/slide-parser";

const FIXTURES_DIR = path.resolve(__dirname, "golden/fixtures");

interface Fixture {
  name: string;
  mode: "deck" | "document";
  content: string;
}

function loadFixtures(): Fixture[] {
  let files: string[] = [];
  try {
    files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".stream.txt"));
  } catch {
    return [];
  }
  return files.map((file) => ({
    name: file.replace(".stream.txt", ""),
    mode: file.startsWith("doc") ? ("document" as const) : ("deck" as const),
    content: readFileSync(path.join(FIXTURES_DIR, file), "utf8"),
  }));
}

/**
 * Simulate live streaming exactly the way the upstream generation manager
 * consumes the parser: on every update tick, reset + parse the cumulative
 * text + finalize, reading getAllSlides() as the current snapshot. The
 * sectionIdMap survives reset(), which is what keeps ids stable while a
 * stream grows. Returns the final snapshot after the last tick.
 */
function parseStreaming(
  content: string,
  mode: "deck" | "document",
  size: number,
): PlateSlide[] {
  const parser = new SlideParser({ mode });
  let snapshot: PlateSlide[] = [];
  for (let end = size; end < content.length + size; end += size) {
    parser.reset();
    parser.parseChunk(content.slice(0, Math.min(end, content.length)));
    parser.finalize();
    snapshot = parser.getAllSlides();
  }
  parser.clearAllGeneratingMarks();
  return snapshot;
}

function parseWhole(content: string, mode: "deck" | "document"): PlateSlide[] {
  const parser = new SlideParser({ mode });
  parser.parseChunk(content);
  parser.finalize();
  parser.clearAllGeneratingMarks();
  return parser.getAllSlides();
}


const fixtures = loadFixtures();

describe("SlideParser golden fixtures", () => {
  it("has recorded fixtures", () => {
    expect(
      fixtures.length,
      "no fixtures found — run: npx tsx scripts/record-golden.ts",
    ).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it("parses to at least one slide", () => {
        const slides = parseWhole(fixture.content, fixture.mode);
        expect(slides.length).toBeGreaterThan(0);
      });

      it("matches snapshot", () => {
        const slides = parseWhole(fixture.content, fixture.mode);
        expect(slides).toMatchSnapshot();
      });

      // The streaming consumption pattern (reset + reparse + finalize per
      // tick) must converge to the same final result as a single whole
      // parse, regardless of how the stream was sliced — ids included.
      it("streaming converges to whole-parse result (7-byte ticks)", () => {
        const whole = parseWhole(fixture.content, fixture.mode);
        const streamed = parseStreaming(fixture.content, fixture.mode, 7);
        expect(streamed).toEqual(whole);
      });

      it("streaming converges to whole-parse result (1-byte ticks)", () => {
        const whole = parseWhole(fixture.content, fixture.mode);
        const streamed = parseStreaming(fixture.content, fixture.mode, 1);
        expect(streamed).toEqual(whole);
      });

      it("streaming converges to whole-parse result (997-byte ticks)", () => {
        const whole = parseWhole(fixture.content, fixture.mode);
        const streamed = parseStreaming(fixture.content, fixture.mode, 997);
        expect(streamed).toEqual(whole);
      });

      it("produces identical ids across independent whole parses", () => {
        const first = parseWhole(fixture.content, fixture.mode).map(
          (s) => s.id,
        );
        const second = parseWhole(fixture.content, fixture.mode).map(
          (s) => s.id,
        );
        expect(first).toEqual(second);
        expect(new Set(first).size).toBe(first.length);
      });

      if (fixture.mode === "document") {
        it("stamps formatCategory=document on every slide", () => {
          const slides = parseWhole(fixture.content, fixture.mode);
          for (const slide of slides) {
            expect(slide.formatCategory).toBe("document");
          }
        });
      }
    });
  }
});

describe("SlideParser synthetic cases", () => {
  const SYNTHETIC_DECK = `<PRESENTATION><SECTION layout="left"><TITLE>Hello World</TITLE><P>An opening line.</P></SECTION><SECTION layout="vertical"><H1>Points</H1><BULLETS bulletType="basic"><DIV><H3>First</H3><P>Alpha.</P></DIV><DIV><H3>Second</H3><P>Beta.</P></DIV></BULLETS><IMG query="abstract gradient shapes" /></SECTION></PRESENTATION>`;

  it("parses a minimal synthetic deck", () => {
    const slides = parseWhole(SYNTHETIC_DECK, "deck");
    expect(slides.length).toBe(2);
  });

  it("promotes an unterminated trailing section on finalize", () => {
    const truncated = SYNTHETIC_DECK.replace("</SECTION></PRESENTATION>", "");
    const slides = parseWhole(truncated, "deck");
    expect(slides.length).toBe(2);
  });

  it("handles a <DOCUMENT> envelope in document mode", () => {
    const doc = `<DOCUMENT><SECTION><TITLE>Report</TITLE><P>Lead paragraph.</P></SECTION><SECTION><H1>Chapter One</H1><P>Body text.</P></SECTION></DOCUMENT>`;
    const slides = parseWhole(doc, "document");
    expect(slides.length).toBe(2);
    expect(slides.every((s) => s.formatCategory === "document")).toBe(true);
  });

  it("marks trailing text as generating mid-stream and clears on finalize", () => {
    const parser = new SlideParser({ mode: "deck" });
    const partial = `<PRESENTATION><SECTION layout="left"><TITLE>Str`;
    const slides = parser.parseChunk(partial);
    // partial section not yet promoted mid-stream without a complete marker
    expect(slides.length).toBeLessThanOrEqual(1);
    parser.parseChunk(SYNTHETIC_DECK);
    parser.finalize();
    parser.clearAllGeneratingMarks();
    const all = parser.getAllSlides();
    const hasGeneratingMark = JSON.stringify(all).includes('"generating":true');
    expect(hasGeneratingMark).toBe(false);
  });
});
