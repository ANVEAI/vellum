/**
 * Export-contract verification: for a deck's /print page, assert
 *   1. exactly one [data-block-idx] wrapper per top-level model node,
 *      in model order, per slide;
 *   2. the frozen sub-locator classes exist for each component type present.
 * A drop here means the PPTX exporter silently regressed to screenshots.
 *
 *   npx tsx scripts/verify-export-contract.ts <documentId>
 */
import { chromium } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

const SUB_LOCATORS: Record<string, string[]> = {
  boxes: [".v-box", ".v-item-body"],
  icons: [".v-icons-item", ".v-icon"],
  steps: [".v-step", ".v-num"],
  timeline: [".v-timeline-item", ".v-timeline-dot"],
  arrows: [".v-arrow-item", ".v-arrow-shape"],
  "arrow-vertical": [".v-seq-item", ".v-seq-body"],
  compare: [".v-side"],
  "before-after": [".v-side"],
  "pros-cons": [".v-side"],
  stats: [".v-stat"],
};

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx scripts/verify-export-contract.ts <documentId>");
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const doc = (await (
    await fetch(`${BASE}/api/documents/${id}`, { headers: { cookie } })
  ).json()) as { slides: string; kind: string };
  const slides = JSON.parse(doc.slides) as Array<{
    content: Array<{ type?: string }>;
    archetype?: string;
  }>;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const [name, value] = cookie.split("=");
  await context.addCookies([
    { name, value, url: ORIGIN },
  ]);
  const page = await context.newPage();
  await page.goto(`${BASE}/print/${id}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("[data-print-ready-target]", { timeout: 30_000 });

  let failures = 0;
  const componentTypesSeen = new Set<string>();
  for (let i = 0; i < slides.length; i++) {
    const modelBlocks = slides[i].content.filter((n) => typeof n.type === "string");
    const domBlocks = await page.locator(`[data-slide-idx="${i}"] [data-block-idx]`).count();
    if (domBlocks !== modelBlocks.length) {
      failures++;
      console.log(`❌ slide ${i + 1}: ${modelBlocks.length} model nodes but ${domBlocks} [data-block-idx] wrappers`);
    }
    for (let j = 0; j < modelBlocks.length; j++) {
      const type = String(modelBlocks[j].type);
      const locators = SUB_LOCATORS[type];
      if (!locators) continue;
      componentTypesSeen.add(type);
      for (const selector of locators) {
        const count = await page
          .locator(`[data-slide-idx="${i}"] [data-block-idx="${j}"] ${selector}`)
          .count();
        if (count === 0) {
          failures++;
          console.log(`❌ slide ${i + 1} block ${j} (${type}): missing sub-locator ${selector}`);
        }
      }
    }
  }
  const archetypes = slides.map((s) => s.archetype ?? "—");
  console.log(`slides: ${slides.length} | archetypes: ${archetypes.join(", ")}`);
  console.log(
    `distinct archetypes: ${new Set(archetypes.filter((a) => a !== "—")).size} | component types checked: ${[...componentTypesSeen].join(", ") || "none"}`,
  );
  await browser.close();
  if (failures > 0) {
    console.log(`\nCONTRACT BROKEN: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ export contract holds: one wrapper per node, all sub-locators present");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
