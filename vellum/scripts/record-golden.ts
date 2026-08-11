/**
 * Records REAL qwen generation streams as golden fixtures for the parser
 * tests. Run with the Ollama server up:
 *
 *   npx tsx scripts/record-golden.ts            # all fixtures
 *   npx tsx scripts/record-golden.ts deck-short # one fixture
 *
 * Each fixture writes tests/golden/fixtures/<name>.stream.txt (raw XML as
 * streamed, post think-strip). Fixtures are committed; tests replay them
 * offline at pathological chunk boundaries.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { streamChat } from "../src/lib/generation/llm/ollama";
import { buildDeckPrompt } from "../src/lib/generation/prompts/deck";
import { buildDocumentPrompt } from "../src/lib/generation/prompts/document";
import { SlideParser } from "../src/lib/generation/parser/slide-parser";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3.6:35b";
const FIXTURES_DIR = path.resolve(__dirname, "../tests/golden/fixtures");

const DECK_SHORT_OUTLINE = [
  "## The Problem\n- Meetings eat 23 hours per week for managers\n- Decisions stall waiting for status updates",
  "## The Fix\n- Async-first written updates\n- Meetings only for genuine debate",
  "## Results\n- 40% fewer meetings in pilot teams\n- Faster decision turnaround",
];

const DECK_MEDIUM_OUTLINE = [
  "## Why Solar Now\n- Panel costs fell 90% since 2010\n- Grid parity reached in most markets",
  "## How Panels Work\n- Photovoltaic effect basics\n- From cell to array",
  "## Home Installation Steps\n- Assessment, permits, install, inspection\n- Typical 6-8 week timeline",
  "## Costs and Payback\n- Typical system prices\n- Payback in 6-9 years, incentives help",
  "## Choosing an Installer\n- Certifications to check\n- Quote comparison criteria",
  "## The Road Ahead\n- Battery storage pairing\n- Community solar options",
];

const DOC_OUTLINE = [
  "## Introduction to Remote Work\n- Definition and history\n- Post-2020 acceleration",
  "## Productivity Evidence\n- Key studies and their findings\n- Where remote wins and loses",
  "## Building Remote Culture\n- Rituals, documentation, trust\n- Common failure modes",
  "## The Hybrid Future\n- Emerging patterns\n- Recommendations for teams",
];

const FIXTURES: Record<
  string,
  { mode: "deck" | "document"; build: () => { system: string; user: string } }
> = {
  "deck-short": {
    mode: "deck",
    build: () =>
      buildDeckPrompt({
        prompt: "A 3-slide pitch for async-first meetings culture",
        outline: DECK_SHORT_OUTLINE,
        language: "English",
        tone: "professional",
        currentDate: "2026-08-10",
      }),
  },
  "deck-medium": {
    mode: "deck",
    build: () =>
      buildDeckPrompt({
        prompt: "A homeowner's guide to going solar",
        outline: DECK_MEDIUM_OUTLINE,
        language: "English",
        tone: "friendly and practical",
        currentDate: "2026-08-10",
      }),
  },
  "doc-remote-work": {
    mode: "document",
    build: () =>
      buildDocumentPrompt({
        prompt: "A briefing on the state of remote work",
        outline: DOC_OUTLINE,
        language: "English",
        tone: "analytical",
        currentDate: "2026-08-10",
      }),
  },
};

async function recordFixture(name: string) {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`Unknown fixture: ${name}`);
  const { system, user } = fixture.build();

  process.stdout.write(`[${name}] generating with ${MODEL}... `);
  const started = Date.now();
  let raw = "";
  await streamChat({
    baseUrl: OLLAMA_URL,
    model: MODEL,
    think: false,
    stop: ["</PRESENTATION>", "</DOCUMENT>"],
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    onDelta: (delta) => {
      raw += delta;
    },
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const parser = new SlideParser({ mode: fixture.mode });
  parser.parseChunk(raw);
  parser.finalize();
  const slides = parser.getAllSlides();

  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(path.join(FIXTURES_DIR, `${name}.stream.txt`), raw, "utf8");
  console.log(
    `done in ${secs}s — ${raw.length} chars, parsed ${slides.length} slides`,
  );
  if (slides.length === 0) {
    console.warn(
      `  WARNING: fixture parsed to 0 slides — inspect before committing.`,
    );
  }
}

async function main() {
  const wanted = process.argv[2];
  const names = wanted ? [wanted] : Object.keys(FIXTURES);
  for (const name of names) {
    await recordFixture(name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
