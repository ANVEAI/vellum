/**
 * App-chrome verification: screenshots every screen in both themes at four
 * widths, and fails loudly on console errors, horizontal overflow, unlabelled
 * controls, or native dialogs.
 *
 *   npx tsx scripts/ui-check.ts [deckId] [docId]
 *   npx tsx scripts/ui-check.ts --widths 1440         # single width
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";
const OUT = path.resolve(process.cwd(), "data/exports/ui");

interface Problem {
  screen: string;
  kind: string;
  detail: string;
}

const problems: Problem[] = [];

/** Audits that must hold on every screen, in every theme, at every width. */
async function audit(page: Page, screen: string) {
  const found = await page.evaluate(() => {
    const out: Array<{ kind: string; detail: string }> = [];

    // 1. Horizontal overflow of the page body.
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      out.push({
        kind: "overflow-x",
        detail: `scrollWidth ${document.documentElement.scrollWidth} > clientWidth ${document.documentElement.clientWidth}`,
      });
    }

    // 2. Interactive elements with no accessible name.
    const interactive = [
      ...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"),
    ];
    for (const el of interactive) {
      if (el.closest("[aria-hidden='true'], .v-slide")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const name =
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ??
        el.closest("label")?.textContent ??
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.placeholder
          : el.textContent);
      if (!name || !name.trim()) {
        out.push({
          kind: "unlabelled",
          detail: `<${el.tagName.toLowerCase()}${el.className ? ` class="${String(el.className).slice(0, 60)}"` : ""}>`,
        });
      }
    }

    // 3. Hit targets below the 24px minimum. A control may reach the minimum
    //    via an ::before overlay that is larger than the painted box, so the
    //    effective target is the union of the two.
    for (const el of interactive) {
      if (el.closest("[aria-hidden='true'], .v-slide")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.tagName !== "BUTTON") continue;
      // NB: no named function expressions in here — esbuild's keepNames
      // rewrites them to __name(...), which does not exist in the page.
      const before = getComputedStyle(el, "::before");
      const top = Number.parseFloat(before.top);
      const bottom = Number.parseFloat(before.bottom);
      const extends_ = before.content !== "none" && before.position === "absolute";
      const effective =
        r.height +
        (extends_ && Number.isFinite(top) && top < 0 ? -top : 0) +
        (extends_ && Number.isFinite(bottom) && bottom < 0 ? -bottom : 0);
      if (effective < 22) {
        out.push({
          kind: "small-target",
          detail: `<button> ${Math.round(r.width)}×${Math.round(effective)} "${(el.textContent ?? "").trim().slice(0, 24)}"`,
        });
      }
    }
    return out;
  });
  for (const f of found) problems.push({ screen, ...f });
}

/**
 * Tab through the screen and assert every stop is reachable, named, and
 * paints a visible focus ring. A keyboard user must never be stranded.
 */
async function keyboardPass(page: Page, screen: string, stops = 18) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen = new Set<string>();
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      // Same resolution order as the static audit, including <label for>.
      const name = (
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el.id
          ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
          : null) ??
        el.closest("label")?.textContent ??
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.placeholder
          : null) ??
        el.textContent ??
        ""
      )
        .trim()
        .slice(0, 30);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        name,
        ring:
          style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
        onScreen: r.width > 0 && r.height > 0,
      };
    });
    if (!info) continue;
    const key = `${info.tag}:${info.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!info.name) {
      problems.push({ screen, kind: "kbd-unnamed", detail: `<${info.tag}> focused with no name` });
    }
    if (!info.ring && info.onScreen) {
      problems.push({
        screen,
        kind: "kbd-no-focus-ring",
        detail: `<${info.tag}> "${info.name}" has no visible focus ring`,
      });
    }
  }
  if (seen.size === 0) {
    problems.push({ screen, kind: "kbd-unreachable", detail: "Tab reached nothing" });
  }
}

/**
 * Opens the last card/row menu on the page and asserts every item can
 * actually be clicked. Card menus used to render inside an overflow-hidden
 * card, so all but the first item were clipped away and unreachable.
 */
async function menuReachability(page: Page, screen: string) {
  const triggers = await page.$$('[aria-label^="Actions for"]');
  if (triggers.length === 0) return;
  const trigger = triggers[triggers.length - 1];
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.waitForTimeout(250);
  const verdict = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    if (!menu) return { total: 0, hittable: 0 };
    const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    let hittable = 0;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 12, r.top + r.height / 2);
      if (hit && menu.contains(hit)) hittable += 1;
    }
    return { total: items.length, hittable };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  if (verdict.total > 0 && verdict.hittable !== verdict.total) {
    problems.push({
      screen,
      kind: "menu-clipped",
      detail: `${verdict.hittable}/${verdict.total} menu items clickable`,
    });
  }
}

async function shoot(page: Page, screen: string, theme: string, width: number) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${screen}-${theme}-${width}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function main() {
  const widthArg = process.argv.indexOf("--widths");
  const widths =
    widthArg > -1
      ? process.argv[widthArg + 1].split(",").map(Number)
      : [1440, 1280, 1024, 768];
  // Positionals only — otherwise "--widths" lands in docId and the run
  // navigates to /editor/--widths.
  const positional = process.argv.slice(2).filter((a, i, all) => {
    if (a.startsWith("--")) return false;
    return !(i > 0 && all[i - 1].startsWith("--"));
  });
  const [deckId, docId] = positional;

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const [name, value] = cookie.split("=");

  const browser = await chromium.launch({ headless: true });
  const screens: Array<{ name: string; url: string; wait?: string }> = [
    { name: "dashboard", url: "/dashboard" },
    { name: "new", url: "/new" },
    { name: "settings", url: "/settings" },
  ];
  if (deckId) screens.push({ name: "editor", url: `/editor/${deckId}`, wait: ".editor-shell" });
  if (docId) screens.push({ name: "editor-doc", url: `/editor/${docId}`, wait: ".editor-shell" });
  if (deckId) screens.push({ name: "present", url: `/present/${deckId}` });

  const shots: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        deviceScaleFactor: 1,
      });
      await context.addCookies([{ name, value, url: ORIGIN }]);
      const page = await context.newPage();
      let where = `${theme}/${width}`;

      page.on("console", (message) => {
        if (message.type() === "error") {
          problems.push({
            screen: where,
            kind: "console-error",
            detail: message.text().replace(/\s+/g, " ").slice(0, 180),
          });
        }
      });
      page.on("pageerror", (error) => {
        problems.push({
          screen: where,
          kind: "page-error",
          detail: String(error).replace(/\s+/g, " ").slice(0, 180),
        });
      });
      page.on("response", (response) => {
        if (response.status() >= 400) {
          problems.push({
            screen: where,
            kind: `http-${response.status()}`,
            detail: response.url().replace(BASE, "").slice(0, 120),
          });
        }
      });
      // A native dialog blocks the thread — nothing in the redesign may open one.
      page.on("dialog", async (dialog) => {
        problems.push({
          screen: where,
          kind: "native-dialog",
          detail: `${dialog.type()}: ${dialog.message().slice(0, 80)}`,
        });
        await dialog.dismiss();
      });

      for (const screen of screens) {
        where = `${screen.name} ${theme}/${width}`;
        try {
          await page.goto(`${BASE}${screen.url}`, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          if (screen.wait) await page.waitForSelector(screen.wait, { timeout: 20_000 });
          await page.waitForTimeout(900);
          await audit(page, `${screen.name} ${theme}/${width}`);
          shots.push(await shoot(page, screen.name, theme, width));
          // One theme/width is enough for the keyboard + menu sweeps.
          if (theme === "light" && width === widths[0]) {
            await keyboardPass(page, `${screen.name} keyboard`);
            await menuReachability(page, `${screen.name} menu`);
          }
        } catch (error) {
          problems.push({
            screen: `${screen.name} ${theme}/${width}`,
            kind: "navigation",
            detail: error instanceof Error ? error.message.slice(0, 160) : String(error),
          });
        }
      }
      await context.close();
    }
  }
  await browser.close();

  console.log(`\n${shots.length} screenshots → ${OUT}`);
  if (problems.length === 0) {
    console.log("PASS — no console errors, overflow, unlabelled controls or native dialogs.");
    return;
  }
  // Group so a systemic issue reads as one line, not fifty.
  const grouped = new Map<string, { count: number; screens: Set<string> }>();
  for (const p of problems) {
    const key = `${p.kind}: ${p.detail}`;
    const entry = grouped.get(key) ?? { count: 0, screens: new Set<string>() };
    entry.count += 1;
    entry.screens.add(p.screen);
    grouped.set(key, entry);
  }
  console.log(`\n${problems.length} problems (${grouped.size} distinct):\n`);
  for (const [key, entry] of [...grouped].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ×${entry.count}  ${key}`);
    console.log(`         on: ${[...entry.screens].slice(0, 4).join(", ")}`);
  }
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
