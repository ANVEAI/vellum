/**
 * The two tools ANVE Box's cloud uses: start_presentation and
 * check_presentation, on their own endpoint (VELLUM_MCP_TOOLSET=anve-box).
 *
 * ANVE's brief: the start answers within seconds with an id and never waits on
 * a busy Vellum; every option has a default; the check is read-only and says
 * working, done or failed; each description fits in 500 characters.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ANVE_BOX_TOOLS, DEFAULT_SLIDES, STYLES } from "../../src/mcp/tools/anve-box.js";
import { TOOLS } from "../../src/mcp/tools/index.js";
import { toolsFor } from "../../src/mcp/server.js";
import { runTool, type ToolDefinition } from "../../src/mcp/tool.js";
import { TEMPLATES } from "../../src/domain/templates.js";
import { JobRegistry } from "../../src/domain/jobs.js";
import { GenerationMutex } from "../../src/domain/mutex.js";
import { nullLogger } from "../../src/infra/logger.js";
import { anonymousContext } from "../../src/infra/context.js";
import { VellumMcpError } from "../../src/infra/errors.js";
import type { Services } from "../../src/domain/services.js";

const start = ANVE_BOX_TOOLS.find((t) => t.name === "start_presentation") as ToolDefinition;
const check = ANVE_BOX_TOOLS.find((t) => t.name === "check_presentation") as ToolDefinition;

/** What the 26-tool set advertised before these tools existed, in order. */
const FULL_SET = [
  "vellum.health", "vellum.list_templates", "vellum.list_documents", "vellum.get_document",
  "vellum.generate_presentation", "vellum.generate_document", "vellum.get_generation_status",
  "vellum.cancel_generation", "vellum.generate_outline", "vellum.set_outline",
  "vellum.generate_slides_from_outline", "vellum.regenerate_slide", "vellum.set_theme",
  "vellum.export_document", "vellum.repair_document", "vellum.get_asset_status",
  "vellum.retry_failed_images", "vellum.request_slide_image", "vellum.generate_image",
  "vellum.update_document", "vellum.duplicate_document", "vellum.delete_document",
  "vellum.import_source", "vellum.search_icons", "vellum.get_settings", "vellum.update_settings",
];

type Doc = { status: string; title: string; slideCount: number; cardCount: number; truncated: boolean; errorMessage: string | null };

/** Services with a real queue and job registry, and a scripted Vellum. */
function fakeServices(opts: {
  queueDepth?: number;
  docs?: Record<string, Doc>;
  generate?: (sink: { documentCreated?(id: string): void; status?(m: string): void }) => Promise<unknown>;
} = {}) {
  const calls: unknown[] = [];
  const mutex = new GenerationMutex({ maxDepth: opts.queueDepth ?? 8, maxWaitMs: 60_000, logger: nullLogger });
  const services = {
    config: { queueDepth: opts.queueDepth ?? 8, queueWaitMs: 60_000, toolset: "anve-box" },
    logger: nullLogger,
    mutex,
    jobs: new JobRegistry({ ttlMs: 60_000, maxJobs: 50, logger: nullLogger }),
    presentations: {
      generate: (input: unknown, _signal: AbortSignal, sink: { documentCreated?(id: string): void }) => {
        calls.push(input);
        return (opts.generate ?? ((s) => {
          s.documentCreated?.(`doc${calls.length}`);
          return new Promise(() => undefined); // still working
        }))(sink);
      },
    },
    documents: {
      status: async (id: string) => {
        const doc = opts.docs?.[id];
        if (!doc) throw new VellumMcpError({ kind: "not_found", message: "no such document" });
        return { documentId: id, ...doc };
      },
    },
  } as unknown as Services;
  return { services, calls, mutex };
}

const call = (def: ToolDefinition, args: Record<string, unknown>, s: Services) =>
  runTool(def, z.object(def.inputSchema).parse(args), anonymousContext(), s);

const payload = (r: { structuredContent?: unknown }) => r.structuredContent as Record<string, unknown>;

/* -------------------------------------------------------------------------- */

describe("the tool set", () => {
  it("is exactly the two tools, and the full set is untouched", () => {
    expect(toolsFor("anve-box").map((t) => t.name)).toEqual(["start_presentation", "check_presentation"]);
    expect(toolsFor("full")).toBe(TOOLS);
    expect(TOOLS.map((t) => t.name)).toEqual(FULL_SET);
  });

  it("keeps each description under 500 characters", () => {
    for (const def of ANVE_BOX_TOOLS) expect(def.description.length, def.name).toBeLessThan(500);
  });

  it("marks the check read-only", () => {
    expect(check.annotations.readOnlyHint).toBe(true);
    expect(start.annotations.readOnlyHint).toBe(false);
  });

  it("needs only a topic: everything else has a default", () => {
    expect(() => z.object(start.inputSchema).parse({})).toThrow();
    expect(z.object(start.inputSchema).parse({ topic: "Solar power for schools" })).toEqual({
      topic: "Solar power for schools",
      slides: DEFAULT_SLIDES,
      style: "general",
      detail: "concise",
      tone: "professional",
      language: "English",
    });
    expect(() => z.object(start.inputSchema).parse({ topic: "x", slides: 31 })).toThrow();
  });

  it("offers every deck template as a style, and no document templates", () => {
    const decks = TEMPLATES.filter((t) => t.kind === "deck").map((t) => t.id);
    expect(STYLES).toEqual(["general", ...decks]);
    const help = (start.inputSchema.style as z.ZodTypeAny).description ?? "";
    for (const id of decks) expect(help).toContain(`${id}:`);
  });
});

describe("start_presentation", () => {
  it("answers at once with the document id", async () => {
    const { services, calls } = fakeServices();
    const out = payload(await call(start, { topic: "Solar power for schools", style: "pitch-deck", slides: 6 }, services));
    expect(out).toMatchObject({ id: "doc1", status: "working" });
    expect(String(out.message)).toMatch(/^Started\./);
    expect(calls[0]).toMatchObject({
      prompt: "Solar power for schools",
      kind: "deck",
      templateId: "pitch-deck",
      genParams: { nCards: 6, textDensity: "concise", tone: "professional", language: "English" },
      busyRetryMs: 60_000,
    });
  });

  it("sends no template for the general style", async () => {
    const { services, calls } = fakeServices();
    await call(start, { topic: "x" }, services);
    expect(calls[0]).not.toHaveProperty("templateId");
  });

  it("says when it is queued behind another deck", async () => {
    const { services, mutex } = fakeServices();
    await mutex.acquire("content:someone-else");
    const out = payload(await call(start, { topic: "x" }, services));
    expect(out).toMatchObject({ status: "working", queued: true, ahead: 1 });
    expect(String(out.message)).toContain("Queued behind 1 other deck");
  });

  it("refuses at once when the queue is full, never waiting", async () => {
    const { services, mutex } = fakeServices({ queueDepth: 1 });
    await mutex.acquire("content:a");
    void mutex.acquire("content:b"); // fills the one queue place
    const result = await call(start, { topic: "x" }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toMatch(/^busy: 2 decks are being made or waiting; try again in about 2 minutes\.$/);
  });

  it("returns the same deck for the same request id", async () => {
    const { services, calls } = fakeServices();
    const first = payload(await call(start, { topic: "x", requestId: "r-1" }, services));
    const again = payload(await call(start, { topic: "x", requestId: "r-1" }, services));
    expect(again.id).toBe(first.id);
    expect(calls).toHaveLength(1);
  });

  it("reports a start that fails before Vellum makes the document", async () => {
    const { services } = fakeServices({
      generate: () => Promise.reject(new Error("Cannot reach Vellum")),
    });
    const result = await call(start, { topic: "x" }, services);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Cannot reach Vellum");
  });
});

describe("check_presentation", () => {
  it("is working while the deck is being made, with Vellum's own stage", async () => {
    const { services } = fakeServices({
      docs: { doc1: { status: "generating", title: "Untitled", slideCount: 0, cardCount: 8, truncated: false, errorMessage: null } },
      generate: (sink) => {
        sink.documentCreated?.("doc1");
        sink.status?.("Designing your slides");
        return new Promise(() => undefined);
      },
    });
    await call(start, { topic: "x" }, services);
    expect(payload(await call(check, { id: "doc1" }, services))).toEqual({
      id: "doc1",
      status: "working",
      stage: "Designing your slides",
    });
  });

  it("is done once the slides are saved, even while pictures are still drawn", async () => {
    const { services } = fakeServices({
      docs: { doc1: { status: "ready", title: "Solar for Schools", slideCount: 8, cardCount: 8, truncated: false, errorMessage: null } },
    });
    await call(start, { topic: "x" }, services);
    expect(payload(await call(check, { id: "doc1" }, services))).toEqual({
      id: "doc1",
      status: "done",
      documentId: "doc1",
      title: "Solar for Schools",
      slides: 8,
    });
  });

  it("fails with one line when the run fails", async () => {
    const { services } = fakeServices({
      generate: (sink) => {
        sink.documentCreated?.("doc1");
        return new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("Generation failed: Ollama HTTP 500\nstack trace here")), 10),
        );
      },
    });
    await call(start, { topic: "x" }, services);
    await new Promise((r) => setTimeout(r, 30));
    expect(payload(await call(check, { id: "doc1" }, services))).toEqual({
      id: "doc1",
      status: "failed",
      reason: "Generation failed: Ollama HTTP 500",
    });
  });

  it("reads Vellum's record when this server has no job for the id", async () => {
    const { services } = fakeServices({
      docs: {
        old: { status: "ready", title: "Kept", slideCount: 5, cardCount: 5, truncated: false, errorMessage: null },
        broken: { status: "error", title: "Untitled", slideCount: 0, cardCount: 0, truncated: false, errorMessage: "Outline failed" },
        busy: { status: "generating", title: "Untitled", slideCount: 0, cardCount: 6, truncated: false, errorMessage: null },
        cut: { status: "ready", title: "Half", slideCount: 3, cardCount: 8, truncated: true, errorMessage: null },
      },
    });
    expect(payload(await call(check, { id: "old" }, services))).toMatchObject({ status: "done", title: "Kept", slides: 5 });
    expect(payload(await call(check, { id: "broken" }, services))).toMatchObject({ status: "failed", reason: "Outline failed" });
    expect(payload(await call(check, { id: "busy" }, services))).toMatchObject({ status: "working" });
    expect(payload(await call(check, { id: "cut" }, services))).toMatchObject({
      status: "failed",
      reason: "It stopped before it finished: 3 of 8 slides were made.",
    });
  });

  it("says plainly when the id is unknown", async () => {
    const { services } = fakeServices();
    const result = await call(check, { id: "nope" }, services);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('No presentation has the id "nope"');
  });
});
