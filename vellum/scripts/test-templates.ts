/**
 * Full template E2E matrix: generate every template, verify structure, QA
 * report, and exports. Serial (one Ollama slot). ~2 min per template.
 *
 *   npx tsx scripts/test-templates.ts [templateId]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { templates } from "../src/lib/templates/library";

const BASE = process.env.APP_ORIGIN ?? "http://localhost:3210";
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";
const PROMPTS: Record<string, string> = {
  "pitch-deck": "An AI-powered cold-chain logistics startup raising a $3M seed round",
  "sales-deck": "Selling a workforce-scheduling SaaS to mid-size hospital networks",
  "corporate-deck": "Q2 2026 board review for a consumer electronics brand",
  "research-deck": "Study of remote-work productivity across 2,000 engineers",
  "product-launch": "Launching a solar-powered e-bike for urban commuters",
  "training-workshop": "Onboarding workshop for new customer-support agents",
  "marketing-overview": "H2 marketing plan for a specialty coffee subscription",
  "business-proposal": "Proposal to migrate a retailer's on-prem ERP to the cloud",
  "research-report": "State of small modular nuclear reactors in 2026",
  whitepaper: "Zero-trust security architecture for mid-size enterprises",
  "case-study": "How a logistics firm cut fuel costs 23% with route AI",
  "executive-one-pager": "One-pager on adopting on-device AI assistants company-wide",
};

let cookie = "";
async function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", cookie, ...(init?.headers ?? {}) },
  });
}
async function drainSse(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  while (!(await reader.read()).done) { /* drain */ }
}

async function testTemplate(id: string): Promise<string> {
  const tpl = templates.find((t) => t.id === id)!;
  const t0 = Date.now();
  const create = await api("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      kind: tpl.kind, prompt: PROMPTS[id] ?? tpl.tagline, templateId: id,
      // product-launch doubles as the premium-image E2E case (per-deck override)
      genParams: { webSearch: false, ...(id === "product-launch" ? { imageModel: "qwen-image" } : {}) },
    }),
  });
  const doc = (await create.json()) as { id: string };
  await drainSse(await api("/api/generation/outline", { method: "POST", body: JSON.stringify({ documentId: doc.id }) }));
  await drainSse(await api("/api/generation/content", { method: "POST", body: JSON.stringify({ documentId: doc.id }) }));

  // wait for assets + QA (max 4 min). QA is done when status is back to
  // "ready" AND a qualityReport exists (content route briefly reports
  // "ready" before the deferred QA pass flips to "reviewing").
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const assets = (await (await api(`/api/documents/${doc.id}/assets`)).json()) as { pending: number };
    const d = (await (await api(`/api/documents/${doc.id}`)).json()) as { status: string; qualityReport: string | null };
    if (assets.pending === 0 && d.status === "ready" && d.qualityReport) break;
  }

  const full = (await (await api(`/api/documents/${doc.id}`)).json()) as {
    status: string; slides: string; qualityReport: string | null; title: string;
  };
  const slides = JSON.parse(full.slides) as Array<{
    content: unknown[]; archetype?: string; speakerNote?: string;
  }>;
  const qa = full.qualityReport ? (JSON.parse(full.qualityReport) as { score: number | null; lint: unknown[]; critique: unknown[] }) : null;

  // Design-engine columns: archetype diversity + cadence + notes coverage.
  const archetypes = slides.map((s) => s.archetype ?? "-");
  const distinct = new Set(archetypes.filter((a) => a !== "-")).size;
  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < archetypes.length; i++) {
    run = archetypes[i] === archetypes[i - 1] ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  const notes = slides.filter((s) => (s.speakerNote ?? "").trim().length > 0).length;

  const fmts = tpl.kind === "deck" ? ["pptx", "pdf"] : ["pdf", "docx"];
  const sizes: string[] = [];
  for (const fmt of fmts) {
    const res = await api(`/api/export/${fmt}/${doc.id}`);
    const buffer = await res.arrayBuffer();
    sizes.push(`${fmt}:${res.ok && buffer.byteLength > 10_000 ? "OK" : "FAIL"}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const ok = slides.length >= tpl.sections.length - 1 && full.status === "ready";
  return `| ${id} | ${tpl.kind} | ${slides.length}/${tpl.sections.length} | ${tpl.kind === "deck" ? distinct : "-"} | ${tpl.kind === "deck" ? maxRun : "-"} | ${notes}/${slides.length} | ${qa?.score ?? "-"} | ${(qa?.lint.length ?? 0) + (qa?.critique.length ?? 0)} | ${sizes.join(" ")} | ${secs}s | ${ok ? "✅" : "❌"} |`;
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

  // Any number of template ids as args; none = all 12. Rows append to the
  // report file per template so partial runs keep their progress.
  const only = process.argv.slice(2);
  const list = only.length ? templates.filter((t) => only.includes(t.id)) : templates;
  const reportFile = path.resolve(__dirname, "../data/exports/template-test-report.md");
  const header =
    "| template | kind | slides | archetypes | max-run | notes | QA score | issues | exports | time | pass |\n|---|---|---|---|---|---|---|---|---|---|---|\n";
  if (!existsSync(reportFile)) writeFileSync(reportFile, header);
  for (const tpl of list) {
    process.stdout.write(`${tpl.id}… `);
    let row: string;
    try {
      row = await testTemplate(tpl.id);
      console.log(row.includes("✅") ? "pass" : "FAIL");
    } catch (error) {
      row = `| ${tpl.id} | - | - | - | - | ERROR ${String(error).slice(0, 60)} | - | ❌ |`;
      console.log("ERROR");
    }
    appendFileSync(reportFile, row + "\n");
  }
  console.log("\n" + readFileSync(reportFile, "utf8"));
}

main().catch((e) => { console.error(e); process.exit(1); });
