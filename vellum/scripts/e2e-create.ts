/**
 * End-to-end creation run through the real UI. Its main job is to prove the
 * streaming contract still holds: as slides arrive, an already-rendered
 * slide's archetype must never change (that would mean the preview is
 * re-laying out mid-generation).
 *
 *   npx tsx scripts/e2e-create.ts
 */
import { chromium } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const [name, value] = cookie.split("=");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name, value, url: ORIGIN }]);
  const page = await context.newPage();

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  let nativeDialogs = 0;
  page.on("dialog", async (d) => {
    nativeDialogs += 1;
    await d.dismiss();
  });

  let documentId: string | null = null;
  try {
    await page.goto(`${BASE}/new`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("textarea", { timeout: 20_000 });

    // Smallest useful deck so the run stays short.
    await page.fill("textarea", "Why local-first software wins on privacy and speed");
    await page.fill("#new-count", "4");
    // No research: keeps the run deterministic and offline-fast.
    const research = page.locator('button[role="switch"]').first();
    if ((await research.getAttribute("aria-checked")) === "true") await research.click();

    await page.click('button:has-text("Generate outline")');
    check("outline step starts", true);

    await page.waitForSelector("#outline-title", { timeout: 300_000 });
    const title = await page.inputValue("#outline-title");
    const cards = await page.$$('ol > li input[aria-label$="heading"]');
    check("outline streamed into editable cards", cards.length >= 3, `${cards.length} cards, “${title}”`);

    documentId = await page.evaluate(async () => {
      const res = await fetch("/api/documents");
      const docs = (await res.json()) as Array<{ id: string }>;
      return docs[0]?.id ?? null;
    });

    await page.click('button:has-text("Generate presentation")');
    await page.waitForSelector('[role="progressbar"]', { timeout: 20_000 });
    check("generating step shows a progressbar", true);

    // Sample the rendered preview while it streams. Once a slide has an
    // archetype it must keep it; the count may only grow.
    const seen = new Map<number, string>();
    let violations = 0;
    let maxSlides = 0;
    let samples = 0;
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      if (page.url().includes("/editor/")) break;
      const snapshot = await page
        .$$eval(".v-slide", (nodes) =>
          nodes.map((n) => n.getAttribute("data-archetype") ?? ""),
        )
        .catch(() => [] as string[]);
      if (snapshot.length > 0) {
        samples += 1;
        maxSlides = Math.max(maxSlides, snapshot.length);
        snapshot.forEach((archetype, i) => {
          // Only the last slide is still streaming; earlier ones are settled.
          if (i >= snapshot.length - 1) return;
          const previous = seen.get(i);
          if (previous && archetype && previous !== archetype) {
            violations += 1;
            console.log(`      slide ${i + 1}: ${previous} → ${archetype}`);
          }
          if (archetype) seen.set(i, archetype);
        });
      }
      await page.waitForTimeout(600);
    }

    check("preview rendered slides while streaming", maxSlides > 0, `${maxSlides} slides, ${samples} samples`);
    check("settled slides never re-layout mid-stream", violations === 0, `${violations} archetype flips`);

    await page.waitForURL(/\/editor\//, { timeout: 300_000 });
    await page.waitForSelector(".editor-shell", { timeout: 30_000 });
    check("lands in the editor when generation completes", true);

    const navCount = await page.$$eval('[role="option"]', (n) => n.length);
    check("the deck is in the navigator", navCount >= 3, `${navCount} slides`);

    check("no native dialogs", nativeDialogs === 0);
    check("no page errors", errors.length === 0, errors[0]);
  } finally {
    await browser.close();
    if (documentId) {
      await fetch(`${BASE}/api/documents/${documentId}`, {
        method: "DELETE",
        headers: { cookie },
      }).catch(() => undefined);
      console.log(`\nscratch document ${documentId} deleted`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
