/**
 * Slide geometry audit (diagnostic, read-only).
 *
 * Renders /print/<id> and measures, per slide:
 *   - clip:    .v-content scrollHeight > clientHeight  (content cut off)
 *   - oob:     a [data-block-idx] rect escaping the 1280x720 slide rect
 *   - overlap: two sibling block rects intersecting
 *   - floor:   data-fit at the autofit floor (0.8) — shrink exhausted
 *
 *   npx tsx <this> <docId> [<docId> ...]
 */
import { chromium } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

interface SlideReport {
  idx: number;
  archetype: string;
  fit: number;
  clipPx: number;
  oob: string[];
  overlaps: string[];
  blocks: number;
}

async function auditDoc(docId: string, cookie: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value, url: ORIGIN }]);
  const page = await context.newPage();

  await page.goto(`${BASE}/print/${docId}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForSelector("[data-print-ready-target]", { timeout: 30_000 });
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("img")].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      { timeout: 20_000 },
    )
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  await page.waitForTimeout(600);

  const reports: SlideReport[] = await page.evaluate(() => {
    const out: SlideReport[] = [];
    const slides = [...document.querySelectorAll<HTMLElement>(".print-slide")];
    for (const slide of slides) {
      const idx = Number(slide.getAttribute("data-slide-idx") ?? -1);
      const archetype = slide.getAttribute("data-archetype") ?? "(none)";
      const fit = Number(slide.getAttribute("data-fit") ?? "1");
      const sr = slide.getBoundingClientRect();

      // Same measurement the renderer's autofit uses: a centred flex column
      // that overflows spills off BOTH ends and only the bottom half is
      // reachable, so scrollHeight reports half the real overrun. The span
      // from the first child's top to the last child's bottom does not care
      // how the box is aligned.
      const content = slide.querySelector<HTMLElement>("[data-slide-content]");
      let clipPx = 0;
      if (content && content.firstElementChild && content.lastElementChild) {
        const cs = getComputedStyle(content);
        const padding =
          parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const available = content.clientHeight - padding;
        const needed =
          content.lastElementChild.getBoundingClientRect().bottom -
          content.firstElementChild.getBoundingClientRect().top;
        clipPx = Math.max(0, Math.round(needed - available));
      }

      const blocks = [
        ...slide.querySelectorAll<HTMLElement>("[data-block-idx]"),
      ];
      const oob: string[] = [];
      const rects = blocks.map((b) => ({
        t: b.getAttribute("data-block-type") ?? "?",
        r: b.getBoundingClientRect(),
      }));
      // Out of the slide box (1px tolerance for subpixel rounding).
      for (const { t, r } of rects) {
        if (r.width === 0 || r.height === 0) continue;
        const dTop = sr.top - r.top;
        const dBottom = r.bottom - sr.bottom;
        const dLeft = sr.left - r.left;
        const dRight = r.right - sr.right;
        const worst = Math.max(dTop, dBottom, dLeft, dRight);
        if (worst > 1) {
          const side =
            worst === dBottom
              ? "bottom"
              : worst === dTop
                ? "top"
                : worst === dRight
                  ? "right"
                  : "left";
          oob.push(`${t}+${Math.round(worst)}px ${side}`);
        }
      }
      // Sibling overlap (both must have real area; >2px on both axes).
      const overlaps: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].r;
          const b = rects[j].r;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) {
            overlaps.push(
              `${rects[i].t}x${rects[j].t} ${Math.round(ox)}x${Math.round(oy)}px`,
            );
          }
        }
      }
      out.push({
        idx,
        archetype,
        fit,
        clipPx,
        oob,
        overlaps,
        blocks: blocks.length,
      });
    }
    return out;
  });

  await browser.close();
  return reports;
}

async function main() {
  const ids = process.argv.slice(2);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);

  for (const id of ids) {
    const reports = await auditDoc(id, cookie);
    let bad = 0;
    console.log(`\n=== ${id} — ${reports.length} slides ===`);
    console.log(
      "  #  archetype        fit   clip   blocks  problems",
    );
    for (const r of reports) {
      const probs: string[] = [];
      if (r.clipPx > 1) probs.push(`CLIPPED ${r.clipPx}px`);
      if (r.oob.length) probs.push(`OOB ${r.oob.join(", ")}`);
      if (r.overlaps.length) probs.push(`OVERLAP ${r.overlaps.join(", ")}`);
      if (probs.length) bad++;
      console.log(
        `  %s  %s %s %s %s  %s`
          .replace("%s", String(r.idx + 1).padStart(2))
          .replace("%s", r.archetype.padEnd(15))
          .replace("%s", String(r.fit).padEnd(5))
          .replace("%s", (r.clipPx ? `${r.clipPx}px` : "-").padEnd(6))
          .replace("%s", String(r.blocks).padEnd(6))
          .replace("%s", probs.join(" | ") || "ok"),
      );
    }
    console.log(`  --> ${bad}/${reports.length} slides with geometry problems`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
