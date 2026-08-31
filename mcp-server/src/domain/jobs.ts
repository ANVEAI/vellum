/**
 * Job registry for long-running operations.
 *
 * One registry is the source of truth, projected two ways:
 *
 *   - clients that declare `io.modelcontextprotocol/tasks` get a real task
 *     handle (the spec forbids returning one to a client that did not);
 *   - everyone else gets `{jobId, documentId, status}` immediately and polls
 *     `vellum.get_generation_status`.
 *
 * Every job owns an AbortController. Cancellation, TTL expiry and the caller's
 * deadline ALL abort it — and aborting is the only thing that releases Vellum's
 * process-global generation lock when Ollama wedges, because Vellum imposes no
 * timeout of its own.
 *
 * Jobs are in-memory. A restart loses job records but never Vellum state: the
 * `documentId` is minted before any generation begins and remains the durable
 * handle, so an agent can always recover with `vellum.get_document`.
 */
import { randomUUID } from "node:crypto";
import type { Logger } from "../infra/logger.js";

export type JobStatus = "working" | "completed" | "failed" | "cancelled";

export interface JobRecord<T = unknown> {
  jobId: string;
  kind: string;
  status: JobStatus;
  /** Available from the moment the document row exists. */
  documentId?: string;
  /** Last human-readable progress line, taken verbatim from Vellum's SSE. */
  statusMessage?: string;
  /** Machine-readable progress, when the stage emits it. */
  progress?: { current: number; total: number };
  result?: T;
  error?: { kind: string; message: string };
  createdAt: number;
  updatedAt: number;
  /** Idempotency key, when the caller supplied one. */
  key?: string;
}

export interface JobHandle<T> extends JobRecord<T> {
  readonly signal: AbortSignal;
}

export interface JobRegistryOptions {
  ttlMs: number;
  maxJobs: number;
  logger: Logger;
}

interface Entry<T> {
  record: JobRecord<T>;
  controller: AbortController;
  promise: Promise<void>;
}

export class JobRegistry {
  private readonly jobs = new Map<string, Entry<unknown>>();
  private readonly byKey = new Map<string, string>();

  constructor(private readonly opts: JobRegistryOptions) {}

  /**
   * Start a job. `run` receives the record (so it can post progress) and an
   * AbortSignal it MUST honour.
   */
  start<T>(
    kind: string,
    run: (job: JobRecord<T>, signal: AbortSignal) => Promise<T>,
    options: { key?: string; documentId?: string } = {},
  ): JobRecord<T> {
    // Idempotency: an in-flight or completed job with the same key is reused.
    if (options.key) {
      const existingId = this.byKey.get(options.key);
      const existing = existingId ? this.jobs.get(existingId) : undefined;
      if (existing) {
        this.opts.logger.info("reusing job for idempotency key", {
          jobId: existing.record.jobId,
          kind,
        });
        return existing.record as JobRecord<T>;
      }
    }

    this.evictIfNeeded();

    const controller = new AbortController();
    const now = Date.now();
    const record: JobRecord<T> = {
      jobId: randomUUID(),
      kind,
      status: "working",
      createdAt: now,
      updatedAt: now,
      ...(options.documentId ? { documentId: options.documentId } : {}),
      ...(options.key ? { key: options.key } : {}),
    };

    const promise = run(record, controller.signal)
      .then((result) => {
        if (record.status === "working") {
          record.status = "completed";
          record.result = result;
        }
      })
      .catch((err: unknown) => {
        if (record.status === "cancelled") return;
        record.status = "failed";
        record.error = {
          kind: (err as { kind?: string })?.kind ?? "upstream_error",
          message: err instanceof Error ? err.message : String(err),
        };
        this.opts.logger.warn("job failed", {
          jobId: record.jobId,
          kind,
          reason: record.error.message,
        });
      })
      .finally(() => {
        record.updatedAt = Date.now();
        this.scheduleExpiry(record.jobId);
      });

    this.jobs.set(record.jobId, { record, controller, promise } as Entry<unknown>);
    if (options.key) this.byKey.set(options.key, record.jobId);
    return record;
  }

  get<T>(jobId: string): JobRecord<T> | undefined {
    return this.jobs.get(jobId)?.record as JobRecord<T> | undefined;
  }

  /**
   * Cancel a job. Aborting propagates into the in-flight fetch, which is what
   * makes Vellum's `request.signal` fire and its `finally` release the lock.
   */
  cancel(jobId: string): boolean {
    const entry = this.jobs.get(jobId);
    if (!entry) return false;
    if (entry.record.status !== "working") return false;
    entry.record.status = "cancelled";
    entry.record.updatedAt = Date.now();
    entry.controller.abort();
    this.opts.logger.info("job cancelled", { jobId, kind: entry.record.kind });
    return true;
  }

  /** Await terminal state — used by tests and by synchronous tool paths. */
  async wait(jobId: string): Promise<JobRecord | undefined> {
    const entry = this.jobs.get(jobId);
    if (!entry) return undefined;
    await entry.promise;
    return entry.record;
  }

  list(): readonly JobRecord[] {
    return [...this.jobs.values()].map((e) => e.record);
  }

  /** Abort everything — called on shutdown so no generation is left dangling. */
  abortAll(): void {
    for (const entry of this.jobs.values()) {
      if (entry.record.status === "working") {
        entry.record.status = "cancelled";
        entry.controller.abort();
      }
    }
  }

  private scheduleExpiry(jobId: string): void {
    const timer = setTimeout(() => {
      this.remove(jobId);
    }, this.opts.ttlMs);
    // Never hold the event loop open for a job record.
    timer.unref?.();
  }

  private remove(jobId: string): void {
    const entry = this.jobs.get(jobId);
    if (!entry) return;
    if (entry.record.key) this.byKey.delete(entry.record.key);
    this.jobs.delete(jobId);
  }

  /** Drop the oldest terminal job when at capacity; never drop a running one. */
  private evictIfNeeded(): void {
    if (this.jobs.size < this.opts.maxJobs) return;
    const terminal = [...this.jobs.values()]
      .filter((e) => e.record.status !== "working")
      .sort((a, b) => a.record.updatedAt - b.record.updatedAt);
    const oldest = terminal[0];
    if (oldest) this.remove(oldest.record.jobId);
  }
}
