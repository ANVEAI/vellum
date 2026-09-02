/**
 * The user's slide count beats the template's default — end to end, through
 * a real generation.
 *
 * Regression: the outline route and prompt both derived the count from
 * `template.sections.length`, so Pitch Deck (8 sections) produced 8 slides no
 * matter what the create form said.
 *
 *   npx tsx scripts/e2e-template-count.ts [templateId] [count...]
 *   npx tsx scripts/e2e-template-count.ts pitch-deck 10 6
 */
import { readSse } from "@/lib/client/sse";
import { getTemplate } from "@/lib/templates/library";
import { parseOutlineMarkdown } from "@/lib/generation/prompts/outline";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function drain(res: Response): Promise<string> {
  let text = "";
  for await (const event of readSse(res)) {
    if (event.type === "chunk") text += (event.data as { chunk: string }).chunk;
    else if (event.type === "error") {
      throw new Error((event.data as { detail: string }).detail);
    }
  }
  return text;
}

async function run(cookie: string, templateId: string, requested: number) {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`unknown template ${templateId}`);
  console.log(
    `\n${template.name}: blueprint ${template.sections.length} → requested ${requested}`,
  );

  const created = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      kind: template.kind,
      prompt: "Aurora Robotics — warehouse robots that cut fulfilment costs 40%",
      templateId,
      // Exactly what the create form sends once the user changes the stepper.
      genParams: { nCards: requested, language: "English", webSearch: false },
    }),
  });
  const doc = (await created.json()) as { id: string };

  try {
    const outlineRes = await fetch(`${BASE}/api/generation/outline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ documentId: doc.id }),
    });
    if (!outlineRes.ok) throw new Error(`outline HTTP ${outlineRes.status}`);
    const markdown = await drain(outlineRes);
    const outlineCards = parseOutlineMarkdown(markdown).cards.length;
    check(
      `outline has ${requested} sections`,
      outlineCards === requested,
      `${outlineCards}`,
    );

    await fetch(`${BASE}/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ outline: markdown }),
    });

    // The local model serves one generation at a time; the outline's lock can
    // still be settling when we ask for content.
    let contentRes: Response | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      contentRes = await fetch(`${BASE}/api/generation/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ documentId: doc.id }),
      });
      if (contentRes.status !== 409) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (!contentRes || !contentRes.ok) {
      throw new Error(`content HTTP ${contentRes?.status ?? "no response"}`);
    }
    await drain(contentRes);

    const finalRes = await fetch(`${BASE}/api/documents/${doc.id}`, {
      headers: { cookie },
    });
    const final = (await finalRes.json()) as { slides: string };
    const slides = JSON.parse(final.slides) as PlateSlide[];
    check(
      `PlateSlide[] contains ${requested} slides`,
      slides.length === requested,
      `${slides.length}`,
    );
    check(
      `every slide has content`,
      slides.every((s) => s.content.length > 0),
      `${slides.filter((s) => s.content.length === 0).length} empty`,
    );
  } finally {
    await fetch(`${BASE}/api/documents/${doc.id}`, {
      method: "DELETE",
      headers: { cookie },
    }).catch(() => undefined);
  }
}

async function main() {
  const templateId = process.argv[2] ?? "pitch-deck";
  const counts = process.argv.slice(3).map(Number).filter(Boolean);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

  for (const count of counts.length ? counts : [10]) {
    await run(cookie, templateId, count);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
