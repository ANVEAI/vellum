/**
 * Export regression test.
 *
 * Validates BOTH paths, because they fail differently:
 *  - the API response (is the generated file well-formed?)
 *  - the real browser download through the export menu (does it arrive
 *    intact?). The client used to revoke the blob URL on the same tick as the
 *    click, so the browser's asynchronous read of an 11 MB PDF was cut short
 *    and the file landed on disk truncated — a valid response that produced
 *    an unopenable document.
 *
 *   npx tsx scripts/e2e-export.ts <deckId>
 */
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";
const OUT = path.resolve("data/exports/ui");

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Page objects in the page tree, ignoring the /Pages container nodes. */
function pdfPageCount(buf: Buffer): number {
  const text = buf.toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![sA-Za-z])/g) ?? []).length;
}

function validatePdf(label: string, buf: Buffer, expectedPages: number) {
  const head = buf.subarray(0, 5).toString("latin1");
  check(`${label}: starts with a PDF header`, head === "%PDF-", head);
  // The trailer can carry trailing whitespace; look near the end.
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString("latin1");
  check(`${label}: ends with %%EOF`, tail.includes("%%EOF"));
  check(`${label}: has a cross-reference table`, tail.includes("startxref"));
  const pages = pdfPageCount(buf);
  check(
    `${label}: page count matches the deck`,
    pages === expectedPages,
    `${pages} pages, expected ${expectedPages}`,
  );
  check(`${label}: is not a stub`, buf.length > 20_000, `${(buf.length / 1024).toFixed(0)} KB`);
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx scripts/e2e-export.ts <deckId>");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const [name, value] = cookie.split("=");

  const docRes = await fetch(`${BASE}/api/documents/${id}`, { headers: { cookie } });
  const doc = (await docRes.json()) as { slides: string; title: string };
  const slideCount = (JSON.parse(doc.slides) as unknown[]).length;
  console.log(`deck: "${doc.title}" — ${slideCount} slides\n`);

  /* ---------- 1. the API response itself ---------- */
  console.log("API response:");
  const apiRes = await fetch(`${BASE}/api/export/pdf/${id}`, { headers: { cookie } });
  check("responds 200", apiRes.status === 200, String(apiRes.status));
  check(
    "declares application/pdf",
    (apiRes.headers.get("content-type") ?? "").includes("application/pdf"),
    apiRes.headers.get("content-type") ?? "none",
  );
  check(
    "declares an attachment filename",
    (apiRes.headers.get("content-disposition") ?? "").includes("attachment"),
  );
  const apiBuf = Buffer.from(await apiRes.arrayBuffer());
  const declared = Number(apiRes.headers.get("content-length") ?? 0);
  if (declared) {
    check("body length matches Content-Length", apiBuf.length === declared, `${apiBuf.length} vs ${declared}`);
  }
  validatePdf("api", apiBuf, slideCount);

  /* ---------- 2. the real download through the UI ---------- */
  console.log("\nbrowser download:");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await context.addCookies([{ name, value, url: ORIGIN }]);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/editor/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".editor-shell", { timeout: 30_000 });
    await page.waitForTimeout(700);

    await page.click('button:has-text("Export")');
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 300_000 });
    await page.click('[role="menuitem"]:has-text("PDF")');
    const download = await downloadPromise;

    const saved = path.join(OUT, "download.pdf");
    await download.saveAs(saved);
    const diskBuf = readFileSync(saved);
    check(
      "downloaded filename ends in .pdf",
      download.suggestedFilename().endsWith(".pdf"),
      download.suggestedFilename(),
    );
    check(
      "downloaded bytes match the API response exactly",
      diskBuf.length === apiBuf.length,
      `${diskBuf.length} vs ${apiBuf.length}`,
    );
    validatePdf("downloaded", diskBuf, slideCount);
  } finally {
    await browser.close();
  }

  /* ---------- 3. a document with nothing to render ---------- */
  console.log("\nempty document:");
  const empty = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ kind: "deck", prompt: "export guard probe" }),
  });
  const emptyDoc = (await empty.json()) as { id: string };
  const emptyRes = await fetch(`${BASE}/api/export/pdf/${emptyDoc.id}`, {
    headers: { cookie },
  });
  const emptyBody = (await emptyRes.json().catch(() => null)) as {
    error?: string;
  } | null;
  check(
    "refuses fast instead of timing out in the renderer",
    emptyRes.status === 409,
    String(emptyRes.status),
  );
  check(
    "explains itself in plain language",
    Boolean(emptyBody?.error && !emptyBody.error.includes("waitForSelector")),
    emptyBody?.error?.slice(0, 60),
  );
  await fetch(`${BASE}/api/documents/${emptyDoc.id}`, {
    method: "DELETE",
    headers: { cookie },
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
