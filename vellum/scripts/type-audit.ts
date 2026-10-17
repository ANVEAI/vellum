/**
 * Typography and distribution audit: the type roles a deck actually renders,
 * and how much of each slide its content fills.
 *
 * Renders /print/<id> — the page the PDF and PowerPoint exports are made from
 * — and measures every slide:
 *   - the slide title (`.v-lead`): its tag and rendered size;
 *   - the rendered sizes of body text and of text inside items;
 *   - occupancy: the share of the canvas covered by the content blocks'
 *     union box plus the picture rail, against the family's own fill target
 *     (1 - the `whitespace` token);
 *   - autofit: the type scale and zoom the slide needed, and overflow.
 *
 *   npx tsx scripts/type-audit.ts <docId> [<docId> ...]
 *
 * Fails when titles on content layouts render at more than one size among
 * slides that autofit left at full scale, or when a slide still overflows at
 * both autofit floors. Reports, without failing, slides that fill less than
 * half their family's target — the slides that read as empty — and slides
 * that autofit had to shrink.
 */
import { chromium } from "playwright";
import { resolveDesignTokens } from "@/lib/design/tokens";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";

const ORIGIN = process.env.APP_ORIGIN ?? "http://127.0.0.1:3210";
const BASE = `${ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
const PASSWORD = process.env.APP_PASSWORD ?? "";

/** Layouts that set the title at display size by design. */
const DISPLAY = new Set(["hero", "closing", "divider", "statement", "full-bleed", "quote-full", "testimonial"]);

interface Row {
  idx: number;
  archetype: string;
  fit: number;
  zoom: number;
  overflow: boolean;
  words: number;
  leadTag: string;
  leadPx: number;
  bodyPx: number[];
  itemPx: number[];
  occupied: number;
  rail: boolean;
}

// Plain-JS string: tsx's name-keeping helper must not be injected into the page.
const MEASURE = `
(function () {
  function round(n) { return Math.round(n * 10) / 10; }
  function uniq(xs) {
    var seen = {};
    xs.forEach(function (x) { seen[round(x)] = true; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
  }
  var ITEM = '.v-item-body, .v-box, .v-bullet, .v-step, .v-icons-item, .v-seq-item, .v-timeline-item, .v-arrow-item, .v-side, .v-stat';
  return Array.prototype.slice.call(document.querySelectorAll('.print-slide')).map(function (slide) {
    var sr = slide.getBoundingClientRect();
    var content = slide.querySelector('[data-slide-content]');
    var blocks = Array.prototype.slice.call(content.querySelectorAll(':scope > [data-block]'));
    var lead = content.querySelector('.v-lead');
    var body = [], items = [], words = 0;
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var text = node.textContent || '';
      if (!text.trim()) continue;
      var el = node.parentElement;
      words += text.split(/\\s+/).filter(Boolean).length;
      if (lead && lead.contains(el)) continue;
      var px = parseFloat(getComputedStyle(el).fontSize);
      if (el.closest(ITEM)) items.push(px);
      else if (!el.closest('h1, h2, h3, h4, h5, h6')) body.push(px);
    }
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    blocks.forEach(function (block) {
      var rect = block.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      l = Math.min(l, rect.left); t = Math.min(t, rect.top);
      r = Math.max(r, rect.right); b = Math.max(b, rect.bottom);
    });
    var rail = slide.querySelector(':scope > img.v-rootimg');
    var railRect = rail ? rail.getBoundingClientRect() : null;
    var area = sr.width * sr.height;
    var covered = (isFinite(l) ? (r - l) * (b - t) : 0) + (railRect ? railRect.width * railRect.height : 0);
    return {
      idx: Number(slide.getAttribute('data-slide-idx')) + 1,
      archetype: slide.getAttribute('data-archetype') || '-',
      fit: Number(slide.getAttribute('data-fit') || 1),
      zoom: Number(slide.getAttribute('data-zoom') || 1),
      overflow: content.classList.contains('v-content--overflow'),
      words: words,
      leadTag: lead ? lead.tagName.toLowerCase() : '-',
      leadPx: lead ? round(parseFloat(getComputedStyle(lead).fontSize)) : 0,
      bodyPx: uniq(body),
      itemPx: uniq(items),
      occupied: round(Math.min(1, covered / area) * 100),
      rail: Boolean(rail),
    };
  });
})()
`;

async function audit(id: string, cookie: string): Promise<boolean> {
  const doc = (await (
    await fetch(`${BASE}/api/documents/${id}`, { headers: { Cookie: cookie } })
  ).json()) as { title?: string; themeName?: string | null; customTheme?: { data: string } | null };
  let custom: unknown = null;
  try {
    custom = doc.customTheme ? JSON.parse(doc.customTheme.data) : null;
  } catch {
    custom = null;
  }
  const tokens = resolveDesignTokens(resolveThemeOrDefault(doc.themeName, custom), doc.themeName ?? undefined);
  // The family's own target, as a percentage of the canvas.
  const target = Math.round((1 - tokens.structure.whitespace) * 100);

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const [name, value] = cookie.split("=");
    await ctx.addCookies([{ name, value, url: ORIGIN }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/print/${id}`, { waitUntil: "networkidle", timeout: 90_000 });
    await page
      .waitForFunction(
        () => [...document.querySelectorAll(".print-slide")].every((s) => s.hasAttribute("data-fit-settled")),
        undefined,
        { timeout: 30_000 },
      )
      .catch(() => undefined);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const rows = (await page.evaluate(MEASURE)) as Row[];

    console.log(`\n${doc.title ?? id} (${id}) — ${tokens.family}, fill target ${target}%`);
    for (const row of rows) {
      const scale = row.fit * row.zoom;
      console.log(
        `  ${String(row.idx).padStart(2)} ${row.archetype.padEnd(14)} ${String(row.words).padStart(3)}w  title ${row.leadTag.padEnd(2)} ${String(row.leadPx).padStart(5)}px  body ${JSON.stringify(row.bodyPx).padEnd(14)} items ${JSON.stringify(row.itemPx).padEnd(14)} fills ${String(row.occupied).padStart(4)}%${scale < 1 ? `  scaled ${scale.toFixed(2)}` : ""}${row.overflow ? "  OVERFLOW" : ""}`,
      );
    }
    const fullScale = rows.filter((r) => r.fit === 1 && r.zoom === 1 && r.leadPx > 0);
    const contentTitles = [...new Set(fullScale.filter((r) => !DISPLAY.has(r.archetype)).map((r) => r.leadPx))];
    const displayTitles = [...new Set(fullScale.filter((r) => DISPLAY.has(r.archetype)).map((r) => r.leadPx))];
    const sparse = rows.filter((r) => !DISPLAY.has(r.archetype) && r.occupied < target / 2);
    const shrunk = rows.filter((r) => r.fit * r.zoom < 1);
    const overflow = rows.filter((r) => r.overflow);
    console.log(`  content-layout title sizes at full scale: ${JSON.stringify(contentTitles)}`);
    console.log(`  display-layout title sizes at full scale: ${JSON.stringify(displayTitles)}`);
    console.log(`  fill below half the target (${target / 2}%): ${sparse.length ? sparse.map((r) => r.idx).join(", ") : "none"}`);
    console.log(`  shrunk by autofit: ${shrunk.length ? shrunk.map((r) => r.idx).join(", ") : "none"}`);
    console.log(`  overflowing: ${overflow.length ? overflow.map((r) => r.idx).join(", ") : "none"}`);
    const ok = contentTitles.length <= 1 && displayTitles.length <= 1 && overflow.length === 0;
    console.log(`  ${ok ? "ok" : "FAIL"}`);
    return ok;
  } finally {
    await browser.close();
  }
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) throw new Error("usage: npx tsx scripts/type-audit.ts <docId> [<docId> ...]");
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);
  let failed = 0;
  for (const id of ids) if (!(await audit(id, cookie))) failed += 1;
  console.log(failed ? `\n${failed} deck(s) failing` : "\nevery deck passes");
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
