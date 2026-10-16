/**
 * Document import, end to end, against the running server.
 *
 * Uploads a PDF, a DOCX, a Markdown and a text file through /api/import the
 * way the import panel does (multipart/form-data, field "file") and checks
 * the text that comes back. The unit tests mock pdf-parse and mammoth, so
 * they cannot see a fault in the production build — and that is where PDF
 * import broke: bundled into .next/server/chunks, pdf.js could not find its
 * worker ("Setting up fake worker failed: Cannot find module
 * '.next/server/chunks/pdf.worker.mjs'"). See serverExternalPackages in
 * next.config.ts.
 *
 * The PDF and DOCX are generated here, so the script needs no binary fixtures.
 *
 *   npx tsx scripts/e2e-import.ts
 */
import { Document, HeadingLevel, Packer, Paragraph } from "docx";

const ORIGIN = process.env.APP_ORIGIN ?? "http://127.0.0.1:3210";
const BASE = `${ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;

const HEADING = "Rising Youth Unemployment in India";
const LINE = "Skills mismatch between degrees and jobs";

/**
 * A one-page PDF with real text in the standard Helvetica font, written by
 * hand: catalog, page tree, page, font, content stream, and an xref table
 * with exact byte offsets.
 */
function minimalPdf(lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 18 Tf",
    "22 TL",
    "72 720 Td",
    ...lines.map((line, i) => `${i === 0 ? "" : "T* "}(${escape(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function minimalDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: HEADING, heading: HeadingLevel.HEADING_1 }),
          new Paragraph(LINE),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

interface Case {
  name: string;
  type: string;
  bytes: Buffer;
  kind: string;
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);

  const cases: Case[] = [
    { name: "brief.pdf", type: "application/pdf", bytes: minimalPdf([HEADING, LINE]), kind: "pdf" },
    {
      name: "brief.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await minimalDocx(),
      kind: "docx",
    },
    { name: "brief.md", type: "text/markdown", bytes: Buffer.from(`# ${HEADING}\n\n- ${LINE}\n`), kind: "md" },
    { name: "brief.txt", type: "text/plain", bytes: Buffer.from(`${HEADING}\n${LINE}\n`), kind: "txt" },
  ];

  let failures = 0;
  for (const c of cases) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(c.bytes)], { type: c.type }), c.name);
    const res = await fetch(`${BASE}/api/import`, { method: "POST", headers: { Cookie: cookie }, body: form });
    const body = (await res.json()) as { text?: string; kind?: string; title?: string; error?: string };
    const text = (body.text ?? "").replace(/\s+/g, " ");
    const problems: string[] = [];
    if (!res.ok) problems.push(`HTTP ${res.status}: ${body.error ?? "no error message"}`);
    if (res.ok && body.kind !== c.kind) problems.push(`kind ${body.kind}, expected ${c.kind}`);
    if (res.ok && !text.includes(HEADING)) problems.push(`heading missing from "${text.slice(0, 80)}"`);
    if (res.ok && !text.includes(LINE)) problems.push("body line missing");
    if (res.ok && body.title !== HEADING) problems.push(`title ${JSON.stringify(body.title)}`);
    if (problems.length) failures += 1;
    console.log(`  ${problems.length ? "FAIL" : "ok  "} ${c.name.padEnd(11)} ${problems.length ? problems.join("; ") : `"${text.slice(0, 60)}"`}`);
  }

  console.log(`\n${cases.length - failures}/${cases.length} uploads extracted`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
