/**
 * Behind ANVE, lists show only the documents the signed-in person may see
 * (src/lib/auth/anve-scope.ts) - the library page and GET /api/documents - and
 * a request without a valid token sees nothing.
 *
 * The bug this guards (21 Oct 2026): ANVE filtered the JSON of GET
 * /api/documents, but the library is rendered here on the server, so a
 * non-admin opening Slides saw the admin's deck titles, thumbnails and slide
 * counts. The page itself now filters, from a token ANVE signs.
 *
 * Real SQLite in a temp dir, as in api-documents.test.ts; next/headers is
 * mocked so the server component can be called as a function.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  documentScope,
  scopeEnforced,
  scopeKey,
  scopeWhere,
  signScope,
  verifyScope,
} from "@/lib/auth/anve-scope";

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => currentHeaders }));
// The page's own query is under test, not its components (which pull in CSS).
vi.mock("@/app/(app)/dashboard/library", () => ({ Library: () => null }));
vi.mock("@/components/ui/chrome", () => ({ TopNav: () => null }));
vi.mock("@/components/ui/icon", () => ({ Icon: () => null }));

const repoRoot = path.resolve(__dirname, "..");
const ENV = { ANVE_SCOPE: "required", APP_PASSWORD: "test-password" };
const NOW = 1_999_999_900;

/** Same vectors as ANVE's test_vellum_embed.py: the two sides must agree byte for byte. */
const VECTOR_IDS = "v1.2000000000.doc1,doc2.e8fea5af5bef8f260231a6faddb169376aa52951c80ea32a8232befbeadaf3d0";
const VECTOR_ALL = "v1.2000000000.*.a01587199b079976c23e90aae191430ae459de9e975768d722e3f2a7304824ea";
const VECTOR_SECRET = "v1.2000000000.doc1.4b8c3bfb6ce436fbc1b9812d3205c7df4fa79346d27d9224188220e08813cb49";

describe("the scope token", () => {
  const key = scopeKey(ENV)!;

  it("matches ANVE's signer", () => {
    expect(signScope(key, 2_000_000_000, "doc1,doc2")).toBe(VECTOR_IDS);
    expect(signScope(key, 2_000_000_000, "*")).toBe(VECTOR_ALL);
    expect(verifyScope(VECTOR_IDS, key, NOW)).toEqual({ all: false, ids: ["doc1", "doc2"] });
    expect(verifyScope(VECTOR_ALL, key, NOW)).toEqual({ all: true });
    const explicit = scopeKey({ ANVE_SCOPE_SECRET: "explicit-secret" })!;
    expect(verifyScope(VECTOR_SECRET, explicit, NOW)).toEqual({ all: false, ids: ["doc1"] });
  });

  it("refuses anything altered, expired, long-lived or from another key", () => {
    const widened = VECTOR_IDS.replace("doc1,doc2", "doc1,doc2,doc3");
    expect(verifyScope(widened, key, NOW)).toBeNull();
    expect(verifyScope(VECTOR_IDS.replace("doc1,doc2", "*"), key, NOW)).toBeNull();
    expect(verifyScope(VECTOR_IDS, key, 2_000_000_001)).toBeNull(); // expired
    expect(verifyScope(VECTOR_IDS, key, 2_000_000_000 - 3600)).toBeNull(); // claims an hour
    expect(verifyScope(VECTOR_IDS, scopeKey({ ...ENV, APP_PASSWORD: "other" })!, NOW)).toBeNull();
    expect(verifyScope("v1.2000000000.doc1", key, NOW)).toBeNull();
    expect(verifyScope("", key, NOW)).toBeNull();
    expect(verifyScope(null, key, NOW)).toBeNull();
    const odd = signScope(key, 2_000_000_000, "doc1,../etc");
    expect(verifyScope(odd, key, NOW)).toBeNull(); // ids are ids, nothing else
  });

  it("is enforced only when configured, and fails closed when it is", () => {
    const none = new Headers();
    expect(scopeEnforced({})).toBe(false);
    expect(documentScope(none, {})).toEqual({ all: true }); // standalone Vellum: unchanged
    expect(scopeEnforced(ENV)).toBe(true);
    expect(documentScope(none, ENV, NOW)).toEqual({ all: false, ids: [] });
    expect(documentScope(new Headers({ "x-anve-scope": "garbage" }), ENV, NOW)).toEqual({
      all: false,
      ids: [],
    });
    expect(documentScope(new Headers({ "x-anve-scope": VECTOR_IDS }), ENV, NOW)).toEqual({
      all: false,
      ids: ["doc1", "doc2"],
    });
    // required, but no password to derive the key from: nothing, not everything
    expect(documentScope(new Headers({ "x-anve-scope": VECTOR_ALL }), { ANVE_SCOPE: "required" }, NOW))
      .toEqual({ all: false, ids: [] });
    expect(scopeWhere({ all: true })).toBeUndefined();
    expect(scopeWhere({ all: false, ids: [] })).toEqual({ id: { in: [] } });
  });
});

describe("lists behind ANVE", () => {
  let tmp: string;
  let db: typeof import("@/lib/db").db;
  let GET: typeof import("@/app/api/documents/route").GET;
  let DashboardPage: typeof import("@/app/(app)/dashboard/page").default;
  const saved: Record<string, string | undefined> = {};

  const token = (scope: string) =>
    signScope(scopeKey(ENV)!, Math.floor(Date.now() / 1000) + 60, scope);

  /** The `cards` prop the page hands its Library component. */
  function cardsOf(node: unknown): { id: string; title: string }[] | undefined {
    if (!node || typeof node !== "object") return undefined;
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return undefined;
    if (Array.isArray(props.cards)) return props.cards as { id: string; title: string }[];
    const kids = props.children;
    for (const kid of Array.isArray(kids) ? kids : [kids]) {
      const found = cardsOf(kid);
      if (found) return found;
    }
    return undefined;
  }

  async function page(h: Record<string, string>) {
    currentHeaders = new Headers(h);
    return cardsOf(await DashboardPage())!.map((c) => c.title).sort();
  }

  async function api(h: Record<string, string>) {
    const res = await GET(new NextRequest("http://test/api/documents", { headers: h }));
    return ((await res.json()) as { title: string }[]).map((d) => d.title).sort();
  }

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "vellum-scope-"));
    process.env.VELLUM_DATA_DIR = tmp;
    process.env.DATABASE_URL = `file:${path.join(tmp, "app.db").replace(/\\/g, "/")}`;
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      cwd: repoRoot,
      env: process.env,
      stdio: "pipe",
    });
    ({ db } = await import("@/lib/db"));
    ({ GET } = await import("@/app/api/documents/route"));
    DashboardPage = (await import("@/app/(app)/dashboard/page")).default;
    await db.document.create({
      data: { id: "adminDeck", kind: "deck", title: "Optimizing GST Compliance", slides: "[]" },
    });
    await db.document.create({
      data: { id: "userDeck", kind: "deck", title: "My own deck", slides: "[]" },
    });
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
  }, 120_000);

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  afterAll(async () => {
    await db?.$disconnect();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("standalone, the library and the API list everything", async () => {
    delete process.env.ANVE_SCOPE;
    delete process.env.ANVE_SCOPE_SECRET;
    expect(await page({})).toEqual(["My own deck", "Optimizing GST Compliance"]);
    expect(await api({})).toEqual(["My own deck", "Optimizing GST Compliance"]);
  });

  it("behind ANVE, a person sees only their own decks - on the page and in the API", async () => {
    Object.assign(process.env, ENV);
    const mine = { "x-anve-scope": token("userDeck") };
    expect(await page(mine)).toEqual(["My own deck"]);
    expect(await api(mine)).toEqual(["My own deck"]);
    const admin = { "x-anve-scope": token("*") };
    expect(await page(admin)).toEqual(["My own deck", "Optimizing GST Compliance"]);
  });

  it("behind ANVE, no token, a bad token or an empty scope shows nothing", async () => {
    Object.assign(process.env, ENV);
    expect(await page({})).toEqual([]);
    expect(await api({})).toEqual([]);
    const forged = token("userDeck").replace("userDeck", "adminDeck");
    expect(await page({ "x-anve-scope": forged })).toEqual([]);
    expect(await page({ "x-anve-scope": token("") })).toEqual([]);
    expect(await api({ "x-anve-scope": token("nobodysDeck") })).toEqual([]);
  });
});

describe("middleware", () => {
  it("says on every response whether lists are scoped, so ANVE can refuse one that is not", async () => {
    const { middleware } = await import("@/middleware");
    const before = { ...process.env };
    try {
      delete process.env.ANVE_SCOPE;
      delete process.env.ANVE_SCOPE_SECRET;
      const plain = await middleware(new NextRequest("http://test/api/documents"));
      expect(plain.status).toBe(401);
      expect(plain.headers.get("x-vellum-scope")).toBeNull();
      process.env.ANVE_SCOPE = "required";
      for (const url of ["http://test/api/documents", "http://test/dashboard", "http://test/login"]) {
        const res = await middleware(new NextRequest(url));
        expect(res.headers.get("x-vellum-scope"), url).toBe("enforced");
      }
    } finally {
      process.env = before;
    }
  });
});
