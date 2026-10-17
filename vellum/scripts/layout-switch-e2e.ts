/**
 * Switch layouts in the live editor and check every result.
 *
 * layout-audit.ts renders each layout in a fresh page, so it cannot see what
 * happens when a user switches layouts in place — and that is where a stale
 * autofit lived: the fit was cached per slide without the layout in its key,
 * so a switch reused the measurement taken under the previous layout and
 * "switching sometimes fixed it". This clicks every layout tile on chosen
 * slides, without reloading, and measures the canvas after each click; then
 * walks the tiles a second time to prove that switching back is clean too.
 *
 * Works on a throwaway duplicate, so the source deck is never written.
 *
 *   npx tsx scripts/layout-switch-e2e.ts <deckId> [slideNumbers, e.g. 9,10,11,20]
 */
import { chromium, type Page } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://127.0.0.1:3210";
const BASE = `${ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
const PASSWORD = process.env.APP_PASSWORD ?? "";

// The editor canvas is the largest slide surface on the page; navigator
// thumbnails are a tenth of its size. Measured in layout pixels, dividing out
// the canvas's transform: scale().
const MEASURE = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.v-slide'));
  var canvas = slides.sort(function (a, b) { return b.getBoundingClientRect().width - a.getBoundingClientRect().width; })[0];
  if (!canvas) return null;
  var c = canvas.querySelector('[data-slide-content]');
  if (!c || !c.firstElementChild) return { arch: canvas.getAttribute('data-archetype'), empty: true };
  var scale = c.getBoundingClientRect().height / c.offsetHeight;
  var cs = getComputedStyle(c);
  var available = c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  var span = (c.lastElementChild.getBoundingClientRect().bottom - c.firstElementChild.getBoundingClientRect().top) / scale;
  var sr = canvas.getBoundingClientRect();
  var cr = c.getBoundingClientRect();
  var side = 0;
  Array.prototype.slice.call(c.querySelectorAll('*')).forEach(function (el) {
    if (!(el instanceof HTMLElement)) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    side = Math.max(side, (r.right - cr.right) / scale, (cr.left - r.left) / scale);
  });
  var h = c.querySelector('.v-lead') || c.querySelector('.v-title, .v-h1, .v-h2');
  var hr = h ? h.getBoundingClientRect() : null;
  // Text from one block covered by another block's text or painted shape
  // (see layout-audit.ts).
  var texts = [];
  var marks = [];
  Array.prototype.slice.call(c.querySelectorAll('*')).forEach(function (el) {
    if (!(el instanceof HTMLElement)) return;
    var own = false;
    for (var k = 0; k < el.childNodes.length; k++) {
      if (el.childNodes[k].nodeType === 3 && el.childNodes[k].textContent.trim()) own = true;
    }
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var s = getComputedStyle(el);
    var bg = s.backgroundColor.match(/[\\d.]+/g);
    var painted = (bg && (bg.length < 4 || Number(bg[3]) > 0.05)) ||
      ['Top', 'Right', 'Bottom', 'Left'].some(function (side) {
        return parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none';
      });
    // Measured by the block that lays the text out, not its inline span —
    // see layout-audit.ts.
    var host = el;
    while (own && host && host !== c && getComputedStyle(host).display === 'inline') host = host.parentElement;
    var item = { r: own && host ? host.getBoundingClientRect() : r, block: el.closest('[data-slide-content] > *') };
    if (own) { texts.push(item); marks.push(item); }
    else if (painted) marks.push(item);
  });
  var overlap = false;
  for (var i = 0; i < texts.length && !overlap; i++) {
    for (var j = 0; j < marks.length; j++) {
      var a = texts[i], b = marks[j];
      if (a.block === b.block) continue;
      if (Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 2 &&
          Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 2) { overlap = true; break; }
    }
  }
  return {
    overlap: overlap,
    arch: canvas.getAttribute('data-archetype'),
    fit: canvas.getAttribute('data-fit') || '1',
    zoom: canvas.getAttribute('data-zoom') || '1',
    vOver: Math.round(span - available),
    hOver: Math.round(side),
    headingVisible: hr ? hr.height > 0 && hr.top >= sr.top - 1 && hr.bottom <= sr.bottom + 1 : null
  };
})()`;

interface Measure {
  arch: string;
  fit: string;
  zoom: string;
  vOver: number;
  hOver: number;
  headingVisible: boolean | null;
  overlap?: boolean;
  empty?: boolean;
}

/** Measure until two readings agree: autofit settles over a few frames. */
async function settled(page: Page): Promise<Measure | null> {
  let last = "";
  let value: Measure | null = null;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    value = (await page.evaluate(MEASURE)) as Measure | null;
    const now = JSON.stringify(value);
    if (now === last) return value;
    last = now;
  }
  return value;
}

async function main() {
  const source = process.argv[2];
  const which = (process.argv[3] ?? "9,10,11,20").split(",").map(Number);
  if (!source) throw new Error("usage: layout-switch-e2e.ts <deckId> [slides]");

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const json = { "Content-Type": "application/json", Cookie: cookie };
  const dup = (await (
    await fetch(`${BASE}/api/documents/${source}/duplicate`, { method: "POST", headers: json })
  ).json()) as { id: string };

  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  let switches = 0;
  try {
    const [name, value] = cookie.split("=");
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addCookies([{ name, value, url: ORIGIN }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/editor/${dup.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".editor-shell", { timeout: 30_000 });
    await page.waitForTimeout(1200);

    for (const n of which) {
      await page.click(`[role="option"][aria-label="slide ${n}"]`);
      await page.waitForTimeout(500);
      const labels = await page.$$eval(".layout-tile", (els) =>
        els.map((e) => e.getAttribute("title") || e.textContent?.trim() || ""),
      );
      const lines: string[] = [];
      // Every tile, then every tile again: the second pass is the switch-back.
      for (const pass of [1, 2]) {
        for (let t = 0; t < labels.length; t++) {
          const tiles = await page.$$(".layout-tile");
          if (!tiles[t]) continue;
          await tiles[t].click();
          const m = await settled(page);
          switches += 1;
          if (!m) continue;
          const why: string[] = [];
          if (m.empty) why.push("canvas empty");
          if (m.vOver > 1) why.push(`clipped ${m.vOver}px`);
          if (m.hOver > 2) why.push(`${m.hOver}px past the content box`);
          if (m.headingVisible === false) why.push("heading not visible");
          if (m.overlap) why.push("text over other text");
          if (process.env.VERBOSE) {
            lines.push(`    pass ${pass}  ${labels[t].padEnd(12)} fit ${m.fit} zoom ${m.zoom}  ${why.length ? why.join(" | ") : "ok"}`);
          }
          if (why.length) {
            failures += 1;
            if (!process.env.VERBOSE) {
              lines.push(`    pass ${pass}  ${labels[t].padEnd(12)} (${m.arch}, fit ${m.fit} zoom ${m.zoom})  ${why.join(" | ")}`);
            }
          }
        }
      }
      console.log(
        `slide ${String(n).padStart(2)}: ${labels.length} layouts x 2 passes`,
      );
      for (const l of lines) console.log(l);
    }
    await ctx.close();
  } finally {
    await browser.close();
    await fetch(`${BASE}/api/documents/${dup.id}`, { method: "DELETE", headers: json });
  }
  console.log(`\n${switches} live layout switches measured — ${failures} failing`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
