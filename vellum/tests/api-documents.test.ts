/**
 * Document deletion + asset GC, against a real SQLite database in a temp
 * directory. Route handlers are plain async functions (auth lives in
 * middleware), so they can be called directly.
 *
 * DATABASE_URL and VELLUM_DATA_DIR must be set BEFORE anything imports the
 * Prisma client — it binds the URL at module load — hence the dynamic imports.
 * Without the data-dir override the GC would sweep the real image library.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");
let tmp: string;
let imagesDir: string;

// Bound lazily in beforeAll, after the env is in place.
let db: typeof import("@/lib/db").db;
let DELETE: typeof import("@/app/api/documents/[id]/route").DELETE;
let gc: typeof import("@/lib/storage/gc");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest("http://test/api", { method: "DELETE" });

/** Writes a file and backdates it past the GC's write-race guard. */
function putFile(name: string, ageMs = 60 * 60 * 1000) {
  const full = path.join(imagesDir, name);
  writeFileSync(full, "x");
  const when = new Date(Date.now() - ageMs);
  utimesSync(full, when, when);
  return full;
}

const slidesWith = (file: string) =>
  JSON.stringify([
    { id: "s1", content: [], rootImage: { url: `/api/images/file/${file}` } },
  ]);

let seq = 0;
async function seedDoc(options: { slides?: string; customThemeId?: string } = {}) {
  seq += 1;
  return db.document.create({
    data: {
      id: `doc${seq}`,
      kind: "deck",
      title: `Doc ${seq}`,
      slides: options.slides ?? "[]",
      ...(options.customThemeId ? { customThemeId: options.customThemeId } : {}),
    },
  });
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "vellum-test-"));
  imagesDir = path.join(tmp, "images");
  mkdirSync(imagesDir, { recursive: true });

  process.env.VELLUM_DATA_DIR = tmp;
  process.env.DATABASE_URL = `file:${path.join(tmp, "app.db").replace(/\\/g, "/")}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: repoRoot,
    env: process.env,
    stdio: "pipe",
  });

  ({ db } = await import("@/lib/db"));
  ({ DELETE } = await import("@/app/api/documents/[id]/route"));
  gc = await import("@/lib/storage/gc");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(tmp, { recursive: true, force: true });
});

describe("DELETE /api/documents/[id]", () => {
  it("removes the row, cascades image rows, and sweeps the unreferenced file", async () => {
    const file = "aaa1.png";
    putFile(file);
    const doc = await seedDoc({ slides: slidesWith(file) });
    await db.generatedImage.create({
      data: { documentId: doc.id, slideId: "s1", prompt: "p", provider: "comfyui", path: file },
    });

    const res = await DELETE(req(), params(doc.id));
    expect(res.status).toBe(200);
    expect(await db.document.findUnique({ where: { id: doc.id } })).toBeNull();
    expect(await db.generatedImage.count({ where: { documentId: doc.id } })).toBe(0);
    expect(existsSync(path.join(imagesDir, file))).toBe(false);
  });

  it("404s for an unknown id, and a repeat delete is a no-op", async () => {
    expect((await DELETE(req(), params("nope"))).status).toBe(404);
    const doc = await seedDoc();
    expect((await DELETE(req(), params(doc.id))).status).toBe(200);
    expect((await DELETE(req(), params(doc.id))).status).toBe(404);
  });

  it("keeps a file that a duplicate still references", async () => {
    // Duplicating copies the slides JSON verbatim but not the image rows, so
    // the file belongs to both documents.
    const file = "shared1.png";
    putFile(file);
    const original = await seedDoc({ slides: slidesWith(file) });
    const copy = await seedDoc({ slides: slidesWith(file) });

    await DELETE(req(), params(original.id));
    expect(existsSync(path.join(imagesDir, file))).toBe(true);

    await DELETE(req(), params(copy.id));
    expect(existsSync(path.join(imagesDir, file))).toBe(false);
  });

  it("keeps a shared custom theme until its last document goes", async () => {
    const theme = await db.customTheme.create({ data: { name: "Brand", data: "{}" } });
    const a = await seedDoc({ customThemeId: theme.id });
    const b = await seedDoc({ customThemeId: theme.id });

    await DELETE(req(), params(a.id));
    expect(await db.customTheme.findUnique({ where: { id: theme.id } })).not.toBeNull();

    await DELETE(req(), params(b.id));
    expect(await db.customTheme.findUnique({ where: { id: theme.id } })).toBeNull();
  });

  it("sweeps historical theme orphans too", async () => {
    await db.customTheme.create({ data: { name: "Old A", data: "{}" } });
    await db.customTheme.create({ data: { name: "Old B", data: "{}" } });
    const doc = await seedDoc();

    await DELETE(req(), params(doc.id));
    expect(await db.customTheme.count({ where: { documents: { none: {} } } })).toBe(0);
  });

  it("protects files referenced only by an upload or by the brand kit", async () => {
    const uploaded = "upload1.png"; // no GeneratedImage row at all
    const logo = "logo1.png"; // referenced only from settings
    putFile(uploaded);
    putFile(logo);
    const keeper = await seedDoc({ slides: slidesWith(uploaded) });
    await db.setting.create({
      data: {
        key: "brand",
        value: JSON.stringify({ name: "Acme", logoUrl: `/api/images/file/${logo}` }),
      },
    });

    const unrelated = await seedDoc();
    await DELETE(req(), params(unrelated.id));
    expect(existsSync(path.join(imagesDir, uploaded))).toBe(true);
    expect(existsSync(path.join(imagesDir, logo))).toBe(true);

    await DELETE(req(), params(keeper.id));
    expect(existsSync(path.join(imagesDir, uploaded))).toBe(false);
    expect(existsSync(path.join(imagesDir, logo))).toBe(true); // still pinned by settings
  });
});

describe("asset GC", () => {
  it("does not collect a file that was just written", async () => {
    const fresh = "fresh1.png";
    putFile(fresh, 0); // written now — a queue job may still be finishing
    const { deleted } = await gc.gcOrphanImages();
    expect(deleted).not.toContain(fresh);

    putFile(fresh, 60 * 60 * 1000); // an hour old
    const second = await gc.gcOrphanImages();
    expect(second.deleted).toContain(fresh);
  });

  it("is idempotent", async () => {
    putFile("orphan1.png");
    const first = await gc.gcOrphanImages();
    expect(first.deleted.length).toBeGreaterThan(0);
    const second = await gc.gcOrphanImages();
    expect(second.deleted).toEqual([]);
    expect(second.errors).toEqual([]);
  });
});
