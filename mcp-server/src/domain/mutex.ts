/**
 * FIFO mutex serializing every call that touches Vellum's generation lock.
 *
 * Vellum's lock (src/lib/generation/pipeline/lock.ts) is a process-global single
 * slot with no queue, no TTL and no fairness: contention just returns 409 with a
 * prose message. Queueing here instead is strictly better than bouncing a
 * "try again" to the model, because this server knows exactly when its own job
 * finished, and the model does not.
 *
 * Also used for `/api/generation/theme`, which does NOT take Vellum's lock but
 * does call Ollama — running it alongside content generation contends for the
 * GPU. Vellum's omission there is arguably a bug; we simply decline to exploit it.
 */
import { busy, timedOut } from "../infra/errors.js";
import type { Logger } from "../infra/logger.js";

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
  label: string;
  enqueuedAt: number;
  timer?: NodeJS.Timeout;
}

export interface MutexOptions {
  /** Reject rather than enqueue beyond this many waiters. */
  maxDepth: number;
  /** Reject a waiter that has been queued longer than this. */
  maxWaitMs: number;
  logger: Logger;
}

export class GenerationMutex {
  private held = false;
  private heldBy: string | null = null;
  private heldSince = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly opts: MutexOptions) {}

  get isHeld(): boolean {
    return this.held;
  }

  get holder(): string | null {
    return this.heldBy;
  }

  get depth(): number {
    return this.queue.length;
  }

  /** Milliseconds the current holder has been running, or 0. */
  get heldForMs(): number {
    return this.held ? Date.now() - this.heldSince : 0;
  }

  /**
   * Acquire the mutex. Resolves with a release function that MUST be called —
   * always from a `finally`.
   */
  acquire(label: string, signal?: AbortSignal): Promise<() => void> {
    if (!this.held) {
      this.take(label);
      return Promise.resolve(() => this.release());
    }

    if (this.queue.length >= this.opts.maxDepth) {
      return Promise.reject(
        busy(
          `Too many generations are already queued (${this.queue.length}). ` +
            `Vellum runs one at a time; wait for the current work to finish and retry.`,
        ),
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, label, enqueuedAt: Date.now() };

      waiter.timer = setTimeout(() => {
        this.remove(waiter);
        reject(timedOut(`Waiting for the generation slot`, this.opts.maxWaitMs, { label }));
      }, this.opts.maxWaitMs);

      const onAbort = () => {
        this.remove(waiter);
        const e = new Error("Aborted while queued");
        e.name = "AbortError";
        reject(e);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const originalResolve = waiter.resolve;
      waiter.resolve = (release) => {
        signal?.removeEventListener("abort", onAbort);
        originalResolve(release);
      };

      this.queue.push(waiter);
      this.opts.logger.debug("queued for generation slot", {
        label,
        depth: this.queue.length,
      });
    });
  }

  private take(label: string): void {
    this.held = true;
    this.heldBy = label;
    this.heldSince = Date.now();
  }

  private release(): void {
    const next = this.queue.shift();
    if (!next) {
      this.held = false;
      this.heldBy = null;
      this.heldSince = 0;
      return;
    }
    if (next.timer) clearTimeout(next.timer);
    this.take(next.label);
    next.resolve(() => this.release());
  }

  private remove(waiter: Waiter): void {
    const i = this.queue.indexOf(waiter);
    if (i !== -1) this.queue.splice(i, 1);
    if (waiter.timer) clearTimeout(waiter.timer);
  }
}
