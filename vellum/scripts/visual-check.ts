/**
 * Visual verification of a rendered deck at a real viewport: reports the
 * computed design-engine styles per slide and writes a PNG contact sheet.
 *
 *   npx tsx scripts/visual-check.ts <documentId> [outPng]
 */
import { chromium } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

async function main() {
  const id = process.argv[2];
  const out = process.argv[3] ?? `data/exports/visual-${id}.png`;
  if (!id) {
    console.error("usage: npx tsx scripts/visual-check.ts <documentId> [outPng]");
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const [name, value] = cookie.split("=");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addCookies([{ name, value, url: ORIGIN }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/print/${id}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("[data-print-ready-target]", { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);

  const report = await page.evaluate(() => {
    const scope = document.querySelector("[data-family]");
    const slides = [...document.querySelectorAll(".v-slide")];
    const infographics = [
      ".v-fnl", ".v-kpi", ".v-rings", ".v-picto", ".v-harvey",
      ".v-matrix", ".v-org", ".v-journey", ".v-venn", ".v-iceberg", ".v-flow",
    ].filter((sel) => document.querySelector(sel) !== null);
    return {
      family: scope?.getAttribute("data-family") ?? null,
      cardPolicy: scope?.getAttribute("data-card-policy") ?? null,
      slides: slides.map((s) => {
        const cs = getComputedStyle(s);
        const heading = s.querySelector(".v-title, .v-h1, .v-h2");
        const hcs = heading ? getComputedStyle(heading) : null;
        return {
          archetype: s.getAttribute("data-archetype"),
          bg: cs.backgroundImage !== "none"
            ? cs.backgroundImage.slice(0, 44)
            : cs.backgroundColor,
          headingFont: hcs?.fontFamily.split(",")[0].replace(/"/g, "") ?? null,
          headingPx: hcs?.fontSize ?? null,
          headingWeight: hcs?.fontWeight ?? null,
          footnotes: Boolean(s.querySelector(".v-footnotes")),
        };
      }),
      infographics,
      charts: document.querySelectorAll(".v-chart").length,
      svgCount: document.querySelectorAll(".v-slide svg").length,
    };
  });

  console.log(JSON.stringify(report, null, 1));
  await page.screenshot({ path: out, fullPage: true });
  console.log("screenshot:", out);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
