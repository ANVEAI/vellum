"use client";

/**
 * Export menu. Downloads via fetch + blob so a failing export shows a toast
 * and keeps the editor intact — previously a raw <a> navigated the user to a
 * JSON error page and destroyed their session state.
 */
import { useState } from "react";
import { withBase } from "@/lib/client/base-path";
import { Icon } from "./icon";
import { MenuItem, Popover, Spinner } from "./primitives";
import { useToast } from "./toast";

export interface Format {
  ext: "pptx" | "pdf" | "docx";
  label: string;
  hint: string;
}

const DECK_FORMATS: Format[] = [
  { ext: "pptx", label: "PowerPoint", hint: "Editable slides" },
  { ext: "pdf", label: "PDF", hint: "Pixel-perfect pages" },
  { ext: "docx", label: "Word", hint: "Handout outline" },
];
const DOC_FORMATS: Format[] = [
  { ext: "pdf", label: "PDF", hint: "Print-ready A4" },
  { ext: "docx", label: "Word", hint: "Editable document" },
];

export function formatsFor(kind: string): Format[] {
  return kind === "doc" ? DOC_FORMATS : DECK_FORMATS;
}

/**
 * Let the browser fetch and save the file itself. The server already sets
 * Content-Disposition: attachment, so this never navigates the page away.
 */
function directDownload(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Fetch + blob download. Shared by the editor toolbar and the library card
 * menu so a failing export never navigates the user to a JSON error page.
 */
export async function downloadExport(
  id: string,
  format: Format,
  title?: string,
): Promise<void> {
  // Prefixed once, here: this URL is both fetched and, on the fallback paths
  // below, handed straight to the browser's download manager via an <a href>.
  // Neither of those goes through Next's routing, so basePath must be explicit.
  const url = withBase(`/api/export/${format.ext}/${id}`);
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // The request died at the network layer (net::ERR_FAILED). Pulling a
    // multi-megabyte export through fetch() into a JS Blob is the fragile
    // path — a download-scanning extension or security suite can kill it even
    // though the server answered 200. Hand the URL to the browser's own
    // download manager instead, which streams straight to disk.
    directDownload(url);
    return;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Export failed (${res.status})`);
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    // Headers arrived but the body never finished.
    directDownload(url);
    return;
  }
  // A short read would still write a file, just an unopenable one — take the
  // browser's own download path rather than saving something broken.
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > 0 && blob.size !== declared) {
    directDownload(url);
    return;
  }

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  const safe = (title ?? "vellum").replace(/[^\w\s-]/g, "").trim() || "vellum";
  anchor.download = `${safe}.${format.ext}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser reads the blob asynchronously after the click. Revoking the
  // URL on the same tick — as this used to — cut the read short, so a large
  // export (an 11 MB PDF) landed on disk truncated and would not open. Hold
  // the URL until the read has certainly finished; the blob is freed when the
  // page unloads regardless.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function ExportMenu({
  id,
  kind,
  title,
}: {
  id: string;
  kind: string;
  title?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const formats = formatsFor(kind);

  const run = async (format: Format, close: () => void) => {
    setBusy(format.ext);
    close();
    toast({
      title: `Preparing ${format.label} export…`,
      description: "Rendering your document — this can take a few seconds.",
      duration: 2500,
    });
    try {
      await downloadExport(id, format, title);
      toast({ title: `${format.label} downloaded`, tone: "success" });
    } catch (error) {
      toast({
        title: `${format.label} export failed`,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
        action: { label: "Try again", onClick: () => void run(format, () => {}) },
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover
      label="Export"
      width={248}
      trigger={(props) => (
        <button type="button" className="btn btn-secondary" {...props}>
          {busy ? <Spinner /> : <Icon name="download" size={16} />}
          Export
          <Icon name="chevronDown" size={13} className="opacity-50" />
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="menu-label">Download as</p>
          {formats.map((format) => (
            <MenuItem
              key={format.ext}
              disabled={busy !== null}
              onClick={() => void run(format, close)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {format.label}{" "}
                  <span className="text-ink-3">.{format.ext}</span>
                </span>
                <span className="t-caption text-ink-3">{format.hint}</span>
              </span>
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  );
}
