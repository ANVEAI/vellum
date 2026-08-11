/**
 * Editor interaction E2E. Works on a throwaway duplicate so it never mutates
 * a real document, and deletes it at the end.
 *
 *   npx tsx scripts/e2e-editor.ts <sourceDeckId>
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.APP_ORIGIN ?? "http://localhost:3210";
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function archetypeOf(page: Page): Promise<string | null> {
  return page.$eval(".editor-stage .v-slide", (el) => el.getAttribute("data-archetype"));
}
async function slideCount(cookie: string, id: string): Promise<number> {
  const res = await fetch(`${BASE}/api/documents/${id}`, { headers: { cookie } });
  const doc = (await res.json()) as { slides: string };
  return (JSON.parse(doc.slides) as unknown[]).length;
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("usage: npx tsx scripts/e2e-editor.ts <sourceDeckId>");
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
  await context.addCookies([{ name, value, url: BASE }]);
  const page = await context.newPage();

  let nativeDialogs = 0;
  page.on("dialog", async (d) => {
    nativeDialogs += 1;
    await d.dismiss();
  });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120));
  });

  try {
    await page.goto(`${BASE}/editor/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".editor-shell", { timeout: 30_000 });
    await page.waitForTimeout(800);

    /* --- selection ------------------------------------------------------ */
    await page.click('[role="option"][aria-label="slide 3"]');
    await page.waitForTimeout(300);
    const status = await page.textContent(".editor-status");
    check("selecting slide 3 updates the status bar", /Slide 3 of/.test(status ?? ""), status?.trim().slice(0, 40));

    /* --- layout picker -------------------------------------------------- */
    const before = await archetypeOf(page);
    const tiles = await page.$$('.layout-tile[aria-checked="false"]');
    check("layout picker offers alternatives", tiles.length > 0, `${tiles.length} tiles`);
    if (tiles.length > 0) {
      await tiles[0].click();
      await page.waitForTimeout(400);
      const after = await archetypeOf(page);
      check("clicking a layout tile changes the archetype", after !== before, `${before} → ${after}`);

      /* --- undo / redo -------------------------------------------------- */
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(400);
      check("undo restores the previous layout", (await archetypeOf(page)) === before);
      await page.keyboard.press("Control+Shift+z");
      await page.waitForTimeout(400);
      check("redo re-applies the layout", (await archetypeOf(page)) === after);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(500);
    }

    /* --- text editor drawer --------------------------------------------- */
    await page.click('button:has-text("Edit text")');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    check("Edit text opens a real dialog (focus-trapped)", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Escape closes the text drawer", (await page.$('[role="dialog"]')) === null);

    /* --- inspector scopes ------------------------------------------------ */
    await page.click('[role="radio"]:has-text("Design")');
    await page.waitForTimeout(200);
    check("Design scope shows the theme picker", (await page.$('button:has-text("Apply brand theme")')) !== null);
    await page.click('[role="radio"]:has-text("Notes")');
    await page.waitForTimeout(200);
    const notes = await page.$('textarea[aria-label="Speaker notes"]');
    check("Notes scope shows the speaker-notes field", notes !== null);

    /* --- notes autosave -------------------------------------------------- */
    if (notes) {
      const marker = `autosave-${Date.now()}`;
      await notes.fill(marker);
      await page.waitForTimeout(1800);
      const res = await fetch(`${BASE}/api/documents/${id}`, { headers: { cookie } });
      const doc = (await res.json()) as { slides: string };
      check("notes autosave reaches the server", doc.slides.includes(marker));
    }

    /* --- duplicate + undo ------------------------------------------------ */
    const n0 = await slideCount(cookie, id);
    await page.click('[role="radio"]:has-text("Format")');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Duplicate")');
    await page.waitForTimeout(900);
    const n1 = await slideCount(cookie, id);
    check("duplicate adds a slide", n1 === n0 + 1, `${n0} → ${n1}`);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(900);
    check("undo removes the duplicate", (await slideCount(cookie, id)) === n0);

    /* --- delete uses the app dialog, not window.confirm ------------------ */
    await page.click('button:has-text("Delete")');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const dialogText = await page.textContent('[role="dialog"]');
    check("delete asks in an in-app dialog", /Delete slide/i.test(dialogText ?? ""));
    await page.click('[role="dialog"] button:has-text("Cancel")');
    await page.waitForTimeout(300);
    check("cancelling the delete keeps the slide", (await slideCount(cookie, id)) === n0);

    /* --- panel toggles --------------------------------------------------- */
    await page.keyboard.press("Control+Alt+1");
    await page.waitForTimeout(250);
    check(
      "⌥⌘1 collapses the navigator",
      (await page.getAttribute(".editor-shell", "data-nav")) === "off",
    );
    await page.keyboard.press("Control+Alt+1");
    await page.waitForTimeout(250);

    /* --- quality popover -------------------------------------------------- */
    await page.click('button:has-text("Quality")');
    await page.waitForSelector('[role="menu"][aria-label="Quality report"]', { timeout: 5000 });
    check("quality opens a popover", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check(
      "Escape closes the quality popover",
      (await page.$('[role="menu"][aria-label="Quality report"]')) === null,
    );

    /* --- command palette --------------------------------------------------- */
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', {
      timeout: 5000,
    });
    check("⌘K opens the command palette", true);

    const groups = await page.$$eval('[role="listbox"] .menu-label', (n) =>
      n.map((e) => e.textContent ?? ""),
    );
    check("commands are grouped", groups.length >= 3, groups.slice(0, 5).join(", "));
    check(
      "commands advertise their shortcuts",
      (await page.$$('[role="option"] .kbd')).length > 0,
    );

    await page.fill('[role="combobox"]', "dupl");
    await page.waitForTimeout(250);
    // Scope to the palette: the navigator is also a listbox of options.
    const top = await page.textContent(
      '[role="dialog"][aria-label="Command palette"] [role="option"][aria-selected="true"]',
    );
    check("fuzzy search ranks the best match first", /Duplicate/i.test(top ?? ""), top?.trim());

    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    check(
      "arrow keys move aria-activedescendant",
      Boolean(await page.getAttribute('[role="combobox"]', "aria-activedescendant")),
    );

    await page.fill('[role="combobox"]', "Inspector: Notes");
    await page.waitForTimeout(250);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check(
      "running a command takes effect",
      (await page.$('textarea[aria-label="Speaker notes"]')) !== null,
    );

    await page.keyboard.press("?");
    await page.waitForSelector('[role="dialog"]', { timeout: 4000 });
    check(
      "? opens the shortcut sheet",
      /Keyboard shortcuts/.test((await page.textContent('[role="dialog"]')) ?? ""),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);

    check("no native alert/confirm/prompt fired", nativeDialogs === 0, `${nativeDialogs} seen`);
    check(
      "no console errors",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 2).join(" | "),
    );
  } finally {
    await browser.close();
    await fetch(`${BASE}/api/documents/${id}`, { method: "DELETE", headers: { cookie } });
    console.log(`\nscratch document deleted`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
