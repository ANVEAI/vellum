/**
 * Navigator geometry regression test.
 *
 * The original bug: ScaledSlide derived its container HEIGHT from its measured
 * WIDTH, and inside an `overflow-y: auto` list width depends on whether a
 * scrollbar is showing. So the two chased each other — scrollbar appears →
 * thumbnails narrow → shorter → content fits → scrollbar goes → wider → taller
 * → overflows → repeat, forever, with no user input. It reproduced at exactly
 * 9 slides because that is the count whose content height straddles the
 * container height at a typical maximised window.
 *
 * Rather than hardcode "9", this walks a range of counts and, for each, sizes
 * the viewport so the list is *deliberately* within one scrollbar-width of
 * overflowing — the worst case for any such loop, on any machine.
 *
 *   npx tsx scripts/nav-stability.ts <sourceDeckId>
 */
import { chromium, type Page } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";
const RATIO = 720 / 1280;

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

interface Geometry {
  navWidth: number;
  listClientWidth: number;
  scrollbar: number;
  frameWidth: number;
  frameHeight: number;
  innerWidth: number;
  contentHeight: number;
  clientHeight: number;
}

async function measure(page: Page): Promise<Geometry | null> {
  return page.evaluate(() => {
    const nav = document.querySelector(".editor-nav");
    const list = document.querySelector(".editor-navlist");
    const frame = document.querySelector(".nav-item-frame");
    if (!nav || !list || !frame) return null;
    // The 1280px-wide slide surface painted inside the thumbnail. If it is
    // wider than its frame the scale is stale — the exact desync the old code
    // could freeze into, clipping the right edge of every thumbnail.
    const surface = frame.querySelector(".v-slide");
    const fr = frame.getBoundingClientRect();
    const sr = surface?.getBoundingClientRect();
    return {
      navWidth: Math.round(nav.getBoundingClientRect().width * 100) / 100,
      listClientWidth: list.clientWidth,
      scrollbar: (list as HTMLElement).offsetWidth - list.clientWidth,
      frameWidth: Math.round(fr.width * 100) / 100,
      frameHeight: Math.round(fr.height * 100) / 100,
      innerWidth: sr ? Math.round(sr.width * 100) / 100 : 0,
      contentHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
    };
  });
}

/** Samples geometry over `ms` and reports every distinct state seen. */
async function sampleStates(page: Page, ms: number): Promise<string[]> {
  return page.evaluate(async (duration) => {
    const list = document.querySelector(".editor-navlist");
    const frame = document.querySelector(".nav-item-frame");
    if (!list || !frame) return ["missing"];
    const seen = new Set<string>();
    const started = Date.now();
    while (Date.now() - started < duration) {
      const r = frame.getBoundingClientRect();
      seen.add(
        `w${Math.round(r.width * 10) / 10} h${Math.round(r.height * 10) / 10} sb${
          (list as HTMLElement).offsetWidth - list.clientWidth
        }`,
      );
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    return [...seen];
  }, ms);
}

async function setSlideCount(
  cookie: string,
  id: string,
  target: number,
): Promise<number> {
  const res = await fetch(`${BASE}/api/documents/${id}`, { headers: { cookie } });
  const doc = (await res.json()) as { slides: string };
  const slides = JSON.parse(doc.slides) as Array<Record<string, unknown>>;
  const next = [...slides];
  while (next.length > target) next.pop();
  let n = 0;
  while (next.length < target) {
    const copy = JSON.parse(JSON.stringify(next[n % slides.length])) as Record<string, unknown>;
    copy.id = `pad${target}-${n}`;
    next.push(copy);
    n += 1;
  }
  await fetch(`${BASE}/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ slides: JSON.stringify(next) }),
  });
  return next.length;
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("usage: npx tsx scripts/nav-stability.ts <sourceDeckId>");
    process.exit(1);
  }

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const [name, value] = cookie.split("=");

  const dup = await fetch(`${BASE}/api/documents/${source}/duplicate`, {
    method: "POST",
    headers: { cookie },
  });
  const { id } = (await dup.json()) as { id: string };
  console.log(`scratch document: ${id}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name, value, url: ORIGIN }]);
  const page = await context.newPage();

  try {
    // Calibrate against the real rendered geometry so the assertions hold on
    // any machine, scrollbar width or DPI.
    await setSlideCount(cookie, id, 9);
    await page.goto(`${BASE}/editor/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".nav-item-frame", { timeout: 30_000 });
    await page.waitForTimeout(900);
    const base = await measure(page);
    if (!base) throw new Error("navigator did not render");
    const itemPitch = base.frameHeight + 4; // gap-1 between rows
    const chromeHeight = 900 - base.clientHeight; // toolbar + status + add row
    console.log(
      `calibration: frame ${base.frameWidth}×${base.frameHeight}, pitch ${Math.round(itemPitch)}, chrome ${chromeHeight}, scrollbar ${base.scrollbar}\n`,
    );

    const widths: number[] = [];
    for (const count of [8, 9, 10, 12]) {
      const real = await setSlideCount(cookie, id, count);
      // Height where the list is one thumbnail-row away from overflowing: the
      // knife edge the old implementation oscillated on.
      const content = real * itemPitch + 12;
      for (const offset of [-6, 2, 10]) {
        const viewportHeight = Math.round(content + chromeHeight + offset);
        await page.setViewportSize({ width: 1440, height: viewportHeight });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(".nav-item-frame", { timeout: 20_000 });
        await page.waitForTimeout(700);

        const states = await sampleStates(page, 1500);
        const geo = await measure(page);
        const label = `${real} slides @ ${viewportHeight}px`;

        check(`${label}: geometry settles to one state`, states.length === 1, states.join(" | "));
        if (!geo) {
          check(`${label}: measurable`, false);
          continue;
        }
        const expectedHeight = geo.frameWidth * RATIO;
        check(
          `${label}: thumbnail keeps 16:9 (no stale scale)`,
          Math.abs(geo.frameHeight - expectedHeight) <= 0.75,
          `h=${geo.frameHeight} expected=${Math.round(expectedHeight * 100) / 100}`,
        );
        check(
          `${label}: slide surface not clipped by its frame`,
          geo.innerWidth <= geo.frameWidth + 0.75,
          `surface=${geo.innerWidth} frame=${geo.frameWidth}`,
        );
        widths.push(geo.navWidth);
      }
    }

    const distinctWidths = [...new Set(widths)];
    check(
      "navigator column width identical at every slide count",
      distinctWidths.length === 1,
      distinctWidths.join(", "),
    );
  } finally {
    await browser.close();
    await fetch(`${BASE}/api/documents/${id}`, { method: "DELETE", headers: { cookie } });
    console.log("\nscratch document deleted");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
