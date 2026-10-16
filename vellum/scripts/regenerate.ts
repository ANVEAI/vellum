/**
 * Re-run a past generation with its exact prompt, template and genParams, so
 * a change to the prompt, the gate or the parser can be compared like for
 * like against a deck that already exists. Creates a new document; the
 * source is left untouched.
 *
 *   npx tsx scripts/regenerate.ts <sourceDocId> [themeOverride]
 */
const ORIGIN = "http://127.0.0.1:3210";
const BASE = `${ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;

async function drain(res: Response, label: string) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`${label}: no body (HTTP ${res.status})`);
  const dec = new TextDecoder();
  let buf = "";
  let last = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const ev = /^event: (.+)$/m.exec(f)?.[1];
      const data = /^data: (.+)$/m.exec(f)?.[1];
      if (ev === "status" && data) {
        const s = JSON.parse(data).status;
        if (s !== last) {
          console.log(`   ${label}: ${s}`);
          last = s;
        }
      }
      if (ev === "error") throw new Error(`${label}: ${data}`);
    }
  }
}

async function main() {
  const src = process.argv[2];
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const h = { "Content-Type": "application/json", Cookie: cookie };

  const source = (await (
    await fetch(`${BASE}/api/documents/${src}`, { headers: { Cookie: cookie } })
  ).json()) as { prompt: string; templateId: string | null; genParams: string | null };
  const genParams = source.genParams ? JSON.parse(source.genParams) : {};

  const created = (await (
    await fetch(`${BASE}/api/documents`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        kind: "deck",
        prompt: source.prompt,
        templateId: source.templateId ?? undefined,
        genParams,
      }),
    })
  ).json()) as { id: string };
  if (process.argv[3]) {
    await fetch(`${BASE}/api/documents/${created.id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ themeName: process.argv[3] }),
    });
  }
  console.log(`   new document: ${created.id}`);

  const t0 = Date.now();
  await drain(
    await fetch(`${BASE}/api/generation/outline`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ documentId: created.id }),
    }),
    "outline",
  );
  await drain(
    await fetch(`${BASE}/api/generation/content`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ documentId: created.id }),
    }),
    "content",
  );
  console.log(`   done in ${Math.round((Date.now() - t0) / 1000)}s -> ${created.id}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
