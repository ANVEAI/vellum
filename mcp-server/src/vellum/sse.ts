/**
 * Consumer for Vellum's SSE streams, and the drain discipline that keeps
 * Vellum's generation lock healthy.
 *
 * ## Wire format (src/lib/sse.ts:31-34)
 *
 *     event: <type>\ndata: <json>\n\n
 *
 * Three things a naive parser gets wrong, all verified in the source:
 *
 *  1. A bare comment heartbeat `": ping\n\n"` is written every 5000 ms
 *     (sse.ts:52-60). It carries no `data:` line and must be skipped — but it
 *     is also the ONLY liveness signal during a long silent Ollama stretch, so
 *     it is surfaced as a `heartbeat` frame rather than swallowed.
 *  2. Failures arrive as `event: error {detail}` INSIDE an already-committed
 *     200 response. Checking the HTTP status alone misses every generation
 *     failure.
 *  3. There is no terminal sentinel. A stream ending with neither `complete`
 *     nor `error` means Vellum aborted or crashed mid-generation.
 *
 * ## Why the ordering in `finish()` is the whole point
 *
 * Vellum's generation lock is process-global, has no TTL, and is released only
 * by the `finally` inside its SSE `run()` callback. `streamChat` has no timeout
 * of its own, so if we merely stop awaiting a response, Vellum keeps generating
 * — holding the lock — for minutes while we believe we cancelled.
 *
 * Therefore, on any non-happy exit we **abort first, then drain**:
 *
 *   abort()  ->  Vellum's `request.signal` fires  ->  AbortError inside
 *   streamChat  ->  catch at content/route.ts:401  ->  partial save  ->
 *   `finally`  ->  releaseGenerationLock.  Milliseconds.
 *
 * Draining first would block for the full remaining generation, which is
 * exactly backwards. On the happy path we do NOT abort: we read to EOF so
 * Vellum's own `writer.close()` runs and the connection stays reusable.
 */
import type { VellumSseEvent } from "./types.js";

export type DrainReason =
  | "completed"
  | "terminal-error"
  | "client-cancel"
  | "deadline"
  | "idle-timeout"
  | "consumer-throw"
  | "shutdown";

export interface DrainOutcome {
  reason: DrainReason;
  /** null means Vellum ended the stream without telling us why. */
  sawTerminal: "complete" | "error" | null;
  aborted: boolean;
  drainedBytes: number;
  drainedMs: number;
  /** false means the post-abort budget expired — worth alerting on. */
  drainCompleted: boolean;
}

const DRAIN_AFTER_ABORT_MS = 5_000;

export interface SseSessionOptions {
  /** The controller whose signal was handed to fetch. Aborting it is what frees Vellum's lock. */
  controller: AbortController;
  /** Milliseconds of total silence (no bytes, not even a heartbeat) before giving up. */
  idleTimeoutMs?: number;
  onEvent?: (event: VellumSseEvent) => void;
}

export class SseSession {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private finished = false;
  private outcomeValue: DrainOutcome | null = null;
  private sawTerminal: "complete" | "error" | null = null;
  private lastByteAt = Date.now();

  complete: unknown;
  errorDetail: string | null = null;

  constructor(
    body: ReadableStream<Uint8Array>,
    private readonly opts: SseSessionOptions,
  ) {
    this.reader = body.getReader();
  }

  get outcome(): DrainOutcome | null {
    return this.outcomeValue;
  }

  /**
   * Iterate events. The `finally` guarantees the stream is retired on every
   * exit — normal, `break`, `throw` or `return`.
   */
  async *events(): AsyncGenerator<VellumSseEvent, void, undefined> {
    let reason: DrainReason = "completed";
    try {
      for (;;) {
        const { done, value } = await this.readWithIdleGuard();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });

        let split: number;
        while ((split = this.buffer.indexOf("\n\n")) !== -1) {
          const frame = this.buffer.slice(0, split);
          this.buffer = this.buffer.slice(split + 2);
          const event = parseFrame(frame);
          if (!event) continue;

          if (event.type === "complete") {
            this.sawTerminal = "complete";
            this.complete = event.data;
          } else if (event.type === "error") {
            this.sawTerminal = "error";
            const d = event.data as { detail?: string } | string;
            this.errorDetail = typeof d === "string" ? d : (d?.detail ?? "unknown error");
          }
          this.opts.onEvent?.(event);
          yield event;
        }
      }
      reason = this.sawTerminal === "error" ? "terminal-error" : "completed";
    } catch (err) {
      reason =
        (err as Error)?.name === "AbortError"
          ? "client-cancel"
          : (err as { drainReason?: DrainReason })?.drainReason ?? "consumer-throw";
      throw err;
    } finally {
      await this.finish(reason);
    }
  }

  /** Abort the upstream request, then drain what is left. Idempotent, never throws. */
  async cancel(reason: DrainReason = "client-cancel"): Promise<DrainOutcome> {
    return this.finish(reason);
  }

  /**
   * Retire the stream.
   *
   * Aborts first for every reason except a clean terminal event, then reads
   * whatever remains within a bounded budget so the socket is released.
   */
  async finish(reason: DrainReason): Promise<DrainOutcome> {
    if (this.finished) return this.outcomeValue!;
    this.finished = true;

    const startedAt = Date.now();
    let drainedBytes = 0;
    let aborted = false;
    let drainCompleted = true;

    const cleanExit = reason === "completed" || reason === "terminal-error";
    if (!cleanExit && !this.opts.controller.signal.aborted) {
      // FIRST. This is what releases Vellum's generation lock.
      this.opts.controller.abort();
      aborted = true;
    }

    const deadline = startedAt + DRAIN_AFTER_ABORT_MS;
    try {
      for (;;) {
        if (Date.now() > deadline) {
          drainCompleted = false;
          break;
        }
        const { done, value } = await this.reader.read();
        if (done) break;
        drainedBytes += value?.byteLength ?? 0;
      }
    } catch {
      // An aborted reader throwing IS a valid end of stream.
    }

    if (!drainCompleted) {
      await this.reader.cancel().catch(() => undefined);
    }
    this.reader.releaseLock?.();

    this.outcomeValue = {
      reason,
      sawTerminal: this.sawTerminal,
      aborted,
      drainedBytes,
      drainedMs: Date.now() - startedAt,
      drainCompleted,
    };
    return this.outcomeValue;
  }

  /**
   * Read with an idle guard. Vellum pings every 5s, so prolonged total silence
   * means a dead socket rather than a slow model — which is why the budget is
   * on silence, never on total elapsed time.
   */
  private async readWithIdleGuard(): Promise<
    Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>
  > {
    const idle = this.opts.idleTimeoutMs;
    if (!idle || idle <= 0) {
      const r = await this.reader.read();
      this.lastByteAt = Date.now();
      return r;
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(
          `No data from Vellum for ${idle}ms (it sends a heartbeat every 5s) — treating the stream as dead.`,
        );
        (e as { drainReason?: DrainReason }).drainReason = "idle-timeout";
        reject(e);
      }, idle);
    });

    try {
      const r = await Promise.race([this.reader.read(), timeout]);
      this.lastByteAt = Date.now();
      return r;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Parse one `\n\n`-delimited frame. Returns null for frames carrying no data. */
export function parseFrame(frame: string): VellumSseEvent | null {
  if (!frame.trim()) return null;

  let type = "message";
  let data = "";
  let sawData = false;
  let sawComment = false;

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith(":")) {
      sawComment = true;
      continue;
    }
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      sawData = true;
      // No separator between continuation lines. This deliberately matches
      // Vellum's own reader (src/lib/client/sse.ts:29) rather than the SSE
      // spec, which joins with "\n". Vellum only ever emits single-line
      // JSON.stringify payloads, so the two never diverge in practice.
      data += line.slice(5).trimStart();
    }
  }

  // Surface the heartbeat: during a silent Ollama stretch it is the only
  // evidence the connection is alive.
  if (!sawData) return sawComment ? ({ type: "heartbeat", data: null } as VellumSseEvent) : null;

  try {
    return { type, data: JSON.parse(data) } as VellumSseEvent;
  } catch {
    return { type, data } as VellumSseEvent;
  }
}
