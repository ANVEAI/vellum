/**
 * Shared headless Chromium for exports. A single browser per process; each
 * export gets a fresh context carrying a minted session cookie so the
 * print route (and image/icon requests) pass the auth middleware like any
 * signed-in browser.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createSessionCookieValue, SESSION_COOKIE } from "@/lib/auth/session";

const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = chromium.launch({ headless: true });
    return browserPromise;
  }
  return browser;
}

export async function withExportPage<T>(
  run: (page: Page, origin: string) => Promise<T>,
): Promise<T> {
  const browser = await getBrowser();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  });
  try {
    const url = new URL(APP_ORIGIN);
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: await createSessionCookieValue(),
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    return await run(page, APP_ORIGIN);
  } finally {
    await context.close();
  }
}

/** Navigate to the print page and wait for charts/images/fonts to settle. */
export async function openPrintPage(
  page: Page,
  origin: string,
  documentId: string,
): Promise<void> {
  await page.goto(`${origin}/print/${documentId}`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.waitForSelector("[data-print-ready-target]", { timeout: 30_000 });
  // Charts render client-side after hydration; wait for their SVG roots.
  const chartCount = await page.locator(".v-chart").count();
  if (chartCount > 0) {
    await page
      .waitForFunction(
        () => {
          const charts = document.querySelectorAll(".v-chart");
          return [...charts].every((c) => c.querySelector("svg"));
        },
        { timeout: 20_000 },
      )
      .catch(() => undefined);
  }
  // `networkidle` only means the bytes arrived — an <img> can still be
  // undecoded when the PDF is taken, which renders as a blank image box.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      { timeout: 20_000 },
    )
    .catch(() => undefined);
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll("img")].map((img) =>
        img.decode().catch(() => undefined),
      ),
    ).then(() => undefined),
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Autofit measures once fonts have settled and then re-renders; give that
  // pass a frame to land so exports match what the editor shows.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.waitForTimeout(250);
}
