/**
 * Document text extraction for the import pipeline.
 *
 * Supported inputs: .pdf (pdf-parse), .docx (mammoth), .md/.markdown/.txt
 * (utf8). The binary parsers are imported lazily inside their branches so the
 * plain-text paths never pay for pdfjs/mammoth, and so tests can mock them
 * without binary fixtures.
 */

export type ImportKind = "pdf" | "docx" | "md" | "txt";

export interface ExtractResult {
  text: string;
  kind: ImportKind;
  title?: string;
}

/** Hard cap on extracted text; anything beyond gets a truncation note. */
export const MAX_IMPORT_CHARS = 60_000;

/** Maximum title length, in characters. */
export const MAX_TITLE_CHARS = 120;

const TRUNCATION_NOTE =
  "\n\n[Note: import truncated — the original document exceeded 60,000 characters.]";

const KIND_BY_EXTENSION: Record<string, ImportKind> = {
  pdf: "pdf",
  docx: "docx",
  md: "md",
  markdown: "md",
  txt: "txt",
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** Normalize line endings, strip trailing spaces, collapse 3+ newlines to 2. */
function normalizeWhitespace(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampTitle(candidate: string): string {
  const title = candidate.trim();
  return title.length > MAX_TITLE_CHARS
    ? title.slice(0, MAX_TITLE_CHARS).trimEnd()
    : title;
}

/** First markdown H1 if present, else the first non-empty line (≤120 chars). */
function detectTitle(text: string): string | undefined {
  const lines = text.split("\n");
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line.trim());
    if (h1) return clampTitle(h1[1]);
  }
  const first = lines.find((line) => line.trim().length > 0);
  if (!first) return undefined;
  // Strip a leading lower-level heading marker so "## Intro" titles as "Intro".
  return clampTitle(first.trim().replace(/^#{2,6}\s+/, ""));
}

function capLength(text: string): string {
  if (text.length <= MAX_IMPORT_CHARS) return text;
  return text.slice(0, MAX_IMPORT_CHARS).trimEnd() + TRUNCATION_NOTE;
}

async function pdfToText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  // Copy: pdfjs may transfer/detach the array it is handed.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function docxToText(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Extract plain text (plus a best-effort title) from an uploaded document.
 * Routing is by file extension; unsupported extensions throw.
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
): Promise<ExtractResult> {
  const ext = extensionOf(filename);
  const kind = KIND_BY_EXTENSION[ext];
  if (!kind) {
    const label = ext ? `".${ext}"` : `"${filename}"`;
    throw new Error(
      `Unsupported file type ${label} — expected .pdf, .docx, .md, .markdown, or .txt.`,
    );
  }

  let raw: string;
  switch (kind) {
    case "pdf":
      raw = await pdfToText(buffer);
      break;
    case "docx":
      raw = await docxToText(buffer);
      break;
    default:
      raw = buffer.toString("utf8");
  }

  const normalized = normalizeWhitespace(raw);
  const title = detectTitle(normalized);
  return { text: capLength(normalized), kind, ...(title ? { title } : {}) };
}
