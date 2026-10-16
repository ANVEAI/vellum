/**
 * Every slide, in every layout the editor offers for it.
 *
 * The layout picker shows each archetype that `accepts()` passes — a
 * heuristic over the slide's content signature, not a measurement. Nothing
 * proved that an offered layout actually holds the content, and some did not:
 * a closing slide went blank in Cover, Statement, Full bleed and Closing
 * because those layouts pushed its heading off the canvas.
 *
 * For each archetype this duplicates the deck, puts every slide that accepts
 * the archetype into it, renders the copy through the print route — the
 * real renderer, with the real autofit — and measures each slide. The copies
 * are deleted afterwards; the source deck is never written.
 *
 *   npx tsx scripts/layout-audit.ts <docId> [--only <archetype>]
 *
 * A slide fails if its content runs past its box vertically, any element
 * reaches outside the content box or the slide, a block's text is wider than
 * the block that holds it, or its heading is not fully on the canvas.
 */
import { chromium } from "playwright";
import {
  ARCHETYPE_WEIGHT,
  accepts,
  signatureOf,
  type ArchetypeId,
} from "@/lib/design/archetypes";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const ORIGIN = process.env.APP_ORIGIN ?? "http://127.0.0.1:3210";
const BASE = `${ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
const PASSWORD = process.env.APP_PASSWORD ?? "";

interface Measure {
  idx: number;
  arch: string;
  fit: string;
  zoom: string;
  vOver: number;
  hOver: number;
  textOutsideSlide: string[];
  wordOverflow: string[];
  headingVisible: boolean | null;
}

// Plain-JS string: tsx's name-keeping helper must not be injected into the page.
const MEASURE = `
(function () {
  function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function ownText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }
  return Array.prototype.slice.call(document.querySelectorAll('.print-slide')).map(function (slide) {
    var out = {
      idx: Number(slide.getAttribute('data-slide-idx')),
      arch: slide.getAttribute('data-archetype') || 'none',
      fit: slide.getAttribute('data-fit') || '1',
      zoom: slide.getAttribute('data-zoom') || '1',
      vOver: 0, hOver: 0, textOutsideSlide: [], wordOverflow: [], headingVisible: null
    };
    var c = slide.querySelector('[data-slide-content]');
    if (!c || !c.firstElementChild) return out;
    var sr = slide.getBoundingClientRect();
    var cr = c.getBoundingClientRect();
    var cs = getComputedStyle(c);
    var available = c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var span = c.lastElementChild.getBoundingClientRect().bottom - c.firstElementChild.getBoundingClientRect().top;
    out.vOver = Math.round(span - available);
    Array.prototype.slice.call(c.querySelectorAll('*')).forEach(function (el) {
      // SVG (a chart's axis labels) has no scroll box: clientWidth is 0 and
      // scrollWidth is its bounding box, which reads as "wider than its box".
      // Charts are sized to their container. Autofit skips SVG for the same
      // reason, so the two must agree.
      if (!(el instanceof HTMLElement)) return;
      if (!vis(el)) return;
      var r = el.getBoundingClientRect();
      var d = Math.max(r.right - cr.right, cr.left - r.left);
      if (d > out.hOver) out.hOver = Math.round(d);
      if (ownText(el)) {
        if (r.top < sr.top - 1 || r.bottom > sr.bottom + 1 || r.left < sr.left - 1 || r.right > sr.right + 1) {
          if (out.textOutsideSlide.length < 3) out.textOutsideSlide.push(el.textContent.trim().slice(0, 28));
        }
        // A word wider than the block that holds it spills into whatever is
        // beside it, even when everything stays on the slide.
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).display !== 'inline') {
          if (out.wordOverflow.length < 3) out.wordOverflow.push(el.textContent.trim().slice(0, 28));
        }
      }
    });
    var h = c.querySelector('.v-title, .v-h1, .v-h2');
    if (h) {
      var hr = h.getBoundingClientRect();
      out.headingVisible = hr.height > 0 && hr.top >= sr.top - 1 && hr.bottom <= sr.bottom + 1 && hr.top >= cr.top - 1;
    }
    return out;
  });
})()
`;

async function main() {
  const docId = process.argv[2];
  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt > -1 ? process.argv[onlyAt + 1] : undefined;
  if (!docId) throw new Error("usage: layout-audit.ts <docId> [--only <archetype>]");

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);
  const json = { "Content-Type": "application/json", Cookie: cookie };

  const source = (await (
    await fetch(`${BASE}/api/documents/${docId}`, { headers: { Cookie: cookie } })
  ).json()) as { slides: string; title: string };
  const slides = JSON.parse(source.slides) as PlateSlide[];

  const archetypes = (Object.keys(ARCHETYPE_WEIGHT) as ArchetypeId[]).filter(
    (a) => !only || a === only,
  );
  const browser = await chromium.launch({ headless: true });
  const failures: string[] = [];
  let pairs = 0;

  for (const arch of archetypes) {
    const offered = slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => accepts(arch, signatureOf(s)));
    if (offered.length === 0) continue;

    const copy = (await (
      await fetch(`${BASE}/api/documents/${docId}/duplicate`, { method: "POST", headers: json })
    ).json()) as { id: string };
    try {
      const forced = slides.map((s) =>
        accepts(arch, signatureOf(s)) ? { ...s, archetype: arch } : s,
      );
      await fetch(`${BASE}/api/documents/${copy.id}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ slides: JSON.stringify(forced) }),
      });

      const [name, value] = cookie.split("=");
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      await ctx.addCookies([{ name, value, url: ORIGIN }]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/print/${copy.id}`, { waitUntil: "networkidle", timeout: 90_000 });
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll(".print-slide")].every((s) =>
              s.hasAttribute("data-fit-settled"),
            ),
          { timeout: 30_000 },
        )
        .catch(() => undefined);
      const measured = (await page.evaluate(MEASURE)) as Measure[];
      await ctx.close();

      const bad: string[] = [];
      for (const { i } of offered) {
        pairs += 1;
        const m = measured.find((x) => x.idx === i);
        if (!m) continue;
        const why: string[] = [];
        if (m.vOver > 1) why.push(`clipped ${m.vOver}px`);
        if (m.hOver > 2) why.push(`${m.hOver}px past the content box`);
        if (m.textOutsideSlide.length) why.push(`text off the slide: "${m.textOutsideSlide[0]}"`);
        if (m.wordOverflow.length) why.push(`text wider than its box: "${m.wordOverflow[0]}"`);
        if (m.headingVisible === false) why.push("heading not visible");
        if (why.length) {
          bad.push(`    slide ${String(i + 1).padStart(2)}  fit ${m.fit} zoom ${m.zoom}  ${why.join(" | ")}`);
          failures.push(`${arch} / slide ${i + 1}`);
        }
      }
      console.log(
        `${arch.padEnd(15)} offered on ${String(offered.length).padStart(2)} slides  ->  ${bad.length === 0 ? "all fit" : `${bad.length} FAIL`}`,
      );
      for (const line of bad) console.log(line);
    } finally {
      await fetch(`${BASE}/api/documents/${copy.id}`, { method: "DELETE", headers: json });
    }
  }
  await browser.close();
  console.log(
    `\n${pairs} slide/layout pairs checked — ${failures.length} failing${failures.length ? "" : ". Every offered layout holds its content."}`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
