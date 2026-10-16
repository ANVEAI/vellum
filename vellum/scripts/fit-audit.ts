/**
 * Autofit audit for the render paths the geometry audit cannot see.
 *
 * geometry-audit.ts measures the print route, where slides render at scale 1.
 * The editor and present mode draw every slide inside a `transform: scale()`
 * (0.11 in the navigator, 1.5 full-screen), and a measurement that mixes
 * visual and layout pixels goes wrong only there: an autofit regression once
 * left every navigator thumbnail reporting a fit at full size while a slide
 * sat 2,691px over its box, and the print-only audit passed. This opens a
 * real page and reports, for each slide surface, the ancestor scale, the fit
 * and zoom autofit settled on, and the true overrun in layout pixels.
 *
 *   npx tsx scripts/fit-audit.ts <docId> [editor|present|print] [arrowPresses]
 *
 * A negative trueOverflowPx means the content fits with that much to spare.
 */
import { chromium } from "playwright";

const ORIGIN = "http://127.0.0.1:3210";
const BASE = `${ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;

// For every rendered slide surface on the page: its ancestor transform scale,
// the autofit it settled on, and whether its content really fits — measured
// in layout pixels so the transform cannot distort the answer.
const CODE = `
(function () {
  return Array.prototype.slice.call(document.querySelectorAll('.v-slide')).map(function (slide) {
    var c = slide.querySelector('[data-slide-content]');
    if (!c || !c.firstElementChild) return null;
    var box = c.getBoundingClientRect();
    var scale = c.offsetHeight ? box.height / c.offsetHeight : 1;
    var cs = getComputedStyle(c);
    var avail = c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var needVisual = c.lastElementChild.getBoundingClientRect().bottom - c.firstElementChild.getBoundingClientRect().top;
    return {
      num: slide.getAttribute('data-num'),
      scale: Math.round(scale * 1000) / 1000,
      fit: slide.getAttribute('data-fit') || '1',
      zoom: slide.getAttribute('data-zoom') || '1',
      overflowClass: c.className.indexOf('v-content--overflow') !== -1,
      trueOverflowPx: Math.round(needVisual / scale - avail),
    };
  }).filter(Boolean);
})()
`;

async function main() {
  const [docId, path] = [process.argv[2], process.argv[3] ?? "present"];
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const [n, v] = cookie.split("=");
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addCookies([{ name: n, value: v, url: ORIGIN }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${path}/${docId}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < Number(process.argv[4] ?? 0); i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
  }
  const rows = (await page.evaluate(CODE)) as Array<Record<string, unknown>>;
  for (const r of rows.slice(0, 40)) console.log("  ", JSON.stringify(r));
  await b.close();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
