import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractText, MAX_IMPORT_CHARS } from "@/lib/import/extract";

// Binary parsers are mocked — extension routing is what's under test here, so
// no PDF/DOCX fixtures need to exist (or be committed).
const mocks = vi.hoisted(() => ({
  pdfGetText: vi.fn(),
  pdfDestroy: vi.fn(),
  extractRawText: vi.fn(),
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = mocks.pdfGetText;
    destroy = mocks.pdfDestroy;
  },
}));

vi.mock("mammoth", () => ({
  default: { extractRawText: mocks.extractRawText },
}));

const buf = (s: string) => Buffer.from(s, "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pdfGetText.mockResolvedValue({ text: "Parsed PDF body text." });
  mocks.pdfDestroy.mockResolvedValue(undefined);
  mocks.extractRawText.mockResolvedValue({
    value: "Parsed DOCX body text.",
    messages: [],
  });
});

describe("extractText — markdown and plain text", () => {
  it("extracts markdown with kind md and an H1 title", async () => {
    const md = "# Quarterly Plan\n\nGoals for the quarter.\n\n- item one";
    const result = await extractText(buf(md), "plan.md");
    expect(result.kind).toBe("md");
    expect(result.title).toBe("Quarterly Plan");
    expect(result.text).toContain("Goals for the quarter.");
  });

  it("maps .markdown to kind md", async () => {
    const result = await extractText(buf("# Notes\n\nBody."), "notes.markdown");
    expect(result.kind).toBe("md");
    expect(result.title).toBe("Notes");
  });

  it("extracts txt with kind txt and first non-empty line as title", async () => {
    const txt = "\n\nMeeting notes from March\nAttendees: everyone\n";
    const result = await extractText(buf(txt), "notes.txt");
    expect(result.kind).toBe("txt");
    expect(result.title).toBe("Meeting notes from March");
    expect(result.text.startsWith("Meeting notes from March")).toBe(true);
  });

  it("prefers a later H1 over an earlier non-empty line", async () => {
    const md = "front-matter preamble\n\n# The Real Title\n\nBody text.";
    const result = await extractText(buf(md), "doc.md");
    expect(result.title).toBe("The Real Title");
  });

  it("caps the title at 120 characters", async () => {
    const longLine = "a".repeat(200);
    const result = await extractText(buf(`${longLine}\nmore`), "long.txt");
    expect(result.title).toBe("a".repeat(120));
  });

  it("normalizes CRLF and collapses 3+ newlines to 2", async () => {
    const messy = "one\r\n\r\n\r\n\r\ntwo\r\nthree\n\n\n\n\nfour";
    const result = await extractText(buf(messy), "messy.txt");
    expect(result.text).toBe("one\n\ntwo\nthree\n\nfour");
  });
});

describe("extractText — truncation", () => {
  it("caps text at 60,000 chars and appends a truncation note", async () => {
    const long = "word ".repeat(20_000); // 100,000 chars
    const result = await extractText(buf(long), "long.txt");
    expect(result.text.length).toBeLessThan(long.length);
    expect(result.text.length).toBeLessThanOrEqual(MAX_IMPORT_CHARS + 200);
    expect(result.text).toMatch(/truncated/i);
    expect(result.text.endsWith("characters.]")).toBe(true);
  });

  it("leaves short documents untouched", async () => {
    const result = await extractText(buf("short body"), "short.txt");
    expect(result.text).toBe("short body");
    expect(result.text).not.toMatch(/truncated/i);
  });
});

describe("extractText — unsupported extensions", () => {
  it("rejects unknown extensions with a clear error", async () => {
    await expect(extractText(buf("x"), "layout.rtf")).rejects.toThrow(
      /Unsupported file type ".rtf"/,
    );
  });

  it("rejects filenames without an extension", async () => {
    await expect(extractText(buf("x"), "Makefile")).rejects.toThrow(
      /Unsupported file type/,
    );
  });
});

describe("extractText — binary formats route by extension", () => {
  it("routes .pdf (case-insensitively) through pdf-parse", async () => {
    const result = await extractText(buf("%PDF-1.7 stub"), "report.PDF");
    expect(result.kind).toBe("pdf");
    expect(result.text).toBe("Parsed PDF body text.");
    expect(mocks.pdfGetText).toHaveBeenCalledTimes(1);
    expect(mocks.pdfDestroy).toHaveBeenCalledTimes(1);
    expect(mocks.extractRawText).not.toHaveBeenCalled();
  });

  it("routes .docx through mammoth.extractRawText", async () => {
    const buffer = buf("PK stub");
    const result = await extractText(buffer, "brief.docx");
    expect(result.kind).toBe("docx");
    expect(result.text).toBe("Parsed DOCX body text.");
    expect(mocks.extractRawText).toHaveBeenCalledWith({ buffer });
    expect(mocks.pdfGetText).not.toHaveBeenCalled();
  });

  it("still derives a title from parsed binary text", async () => {
    mocks.pdfGetText.mockResolvedValue({
      text: "\nAnnual Report 2026\n\nRevenue grew.",
    });
    const result = await extractText(buf("%PDF stub"), "annual.pdf");
    expect(result.title).toBe("Annual Report 2026");
  });
});
