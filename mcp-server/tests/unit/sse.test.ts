/**
 * SSE framing. These cover the three things a naive parser gets wrong, each of
 * which was read out of Vellum's src/lib/sse.ts rather than guessed.
 */
import { describe, expect, it } from "vitest";
import { parseFrame, SseSession } from "../../src/vellum/sse.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

async function collect(chunks: string[]) {
  const controller = new AbortController();
  const session = new SseSession(streamOf(chunks), { controller });
  const events = [];
  for await (const e of session.events()) events.push(e);
  return { events, session };
}

describe("parseFrame", () => {
  it("parses a normal event", () => {
    expect(parseFrame('event: status\ndata: {"status":"Drafting"}')).toEqual({
      type: "status",
      data: { status: "Drafting" },
    });
  });

  it("treats a ': ping' comment as a heartbeat, not data", () => {
    // Vellum writes this every 5s (sse.ts:52-60). It is the only liveness
    // signal during a long silent Ollama stretch, so it must not be dropped
    // silently, and it must never be parsed as JSON.
    expect(parseFrame(": ping")).toEqual({ type: "heartbeat", data: null });
  });

  it("concatenates multi-line data WITHOUT a separator", () => {
    // Deliberately matches Vellum's own reader (src/lib/client/sse.ts:29)
    // rather than the SSE spec, which joins with "\n".
    expect(parseFrame('event: chunk\ndata: {"chunk":"a\ndata: b"}')).toEqual({
      type: "chunk",
      data: { chunk: "ab" },
    });
  });

  it("falls back to the raw string when data is not JSON", () => {
    expect(parseFrame("event: chunk\ndata: not json")).toEqual({ type: "chunk", data: "not json" });
  });

  it("tolerates CRLF", () => {
    expect(parseFrame('event: status\r\ndata: {"status":"x"}\r')).toEqual({
      type: "status",
      data: { status: "x" },
    });
  });

  it("ignores an empty frame", () => {
    expect(parseFrame("   ")).toBeNull();
  });
});

describe("SseSession", () => {
  it("yields events across arbitrary chunk boundaries", async () => {
    // Split mid-frame to prove buffering works.
    const { events } = await collect([
      'event: sta',
      'tus\ndata: {"status":"Researching"}\n\n',
      'event: complete\ndata: {"slideCount":3}\n\n',
    ]);
    expect(events.map((e) => e.type)).toEqual(["status", "complete"]);
  });

  it("captures an error that arrives INSIDE a 200 response", async () => {
    // This is the failure mode that status-code-only handling misses entirely.
    const { events, session } = await collect([
      'event: status\ndata: {"status":"Designing"}\n\n',
      'event: error\ndata: {"detail":"Ollama HTTP 500"}\n\n',
    ]);
    expect(events.map((e) => e.type)).toContain("error");
    expect(session.errorDetail).toBe("Ollama HTTP 500");
    expect(session.outcome?.sawTerminal).toBe("error");
  });

  it("flags a stream that ends with neither complete nor error", async () => {
    // Means Vellum aborted or crashed mid-generation.
    const { session } = await collect(['event: chunk\ndata: {"chunk":"x"}\n\n']);
    expect(session.outcome?.sawTerminal).toBeNull();
  });

  it("does NOT abort on a clean completion", async () => {
    // Aborting a completed stream would stop Vellum's own writer.close() from
    // running and make the connection unreusable.
    const { session } = await collect(['event: complete\ndata: {"slideCount":1}\n\n']);
    expect(session.outcome?.aborted).toBe(false);
    expect(session.outcome?.sawTerminal).toBe("complete");
  });

  it("aborts FIRST when cancelled, then drains", async () => {
    // Ordering is the whole correctness argument: aborting is what releases
    // Vellum's process-global generation lock. Draining first would block for
    // the remainder of the generation.
    const controller = new AbortController();
    const session = new SseSession(streamOf(['event: chunk\ndata: {"chunk":"x"}\n\n']), { controller });
    const outcome = await session.cancel("client-cancel");
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.aborted).toBe(true);
    expect(outcome.reason).toBe("client-cancel");
  });

  it("is idempotent — a second finish returns the same outcome", async () => {
    const controller = new AbortController();
    const session = new SseSession(streamOf([]), { controller });
    const a = await session.cancel("client-cancel");
    const b = await session.cancel("shutdown");
    expect(b).toBe(a);
  });
});
