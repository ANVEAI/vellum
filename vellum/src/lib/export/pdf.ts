/**
 * PDF export via headless Chromium print of /print/[id].
 * Decks: exact 1280×720 pages (one per slide), no chrome.
 * Docs: A4 with running header (document title) and page-number footer;
 * margins reserve room for that chrome (70px top / 60px bottom).
 */
import { db } from "@/lib/db";
import { openPrintPage, withExportPage } from "./browser";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CHROME_STYLE =
  "font-size:8px;font-family:Helvetica,Arial,sans-serif;color:#8b8b8b;width:100%;padding:0 16mm;";

export async function exportPdf(
  documentId: string,
  kind: "deck" | "doc",
): Promise<Buffer> {
  const title =
    kind === "doc"
      ? ((
          await db.document.findUnique({
            where: { id: documentId },
            select: { title: true },
          })
        )?.title ?? "")
      : "";

  return withExportPage(async (page, origin) => {
    await openPrintPage(page, origin, documentId);
    if (kind === "deck") {
      return await page.pdf({
        width: "1280px",
        height: "720px",
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        printBackground: true,
        pageRanges: "",
      });
    }
    return await page.pdf({
      format: "A4",
      margin: { top: "70px", right: "16mm", bottom: "60px", left: "16mm" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="${CHROME_STYLE}text-align:center;letter-spacing:0.04em;">${escapeHtml(title)}</div>`,
      footerTemplate: `<div style="${CHROME_STYLE}text-align:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  });
}
