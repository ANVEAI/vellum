/**
 * Retry with exponential backoff and full jitter.
 *
 * Deliberately NOT a blanket "retry everything". Vellum's generation and export
 * routes are non-idempotent — a 5xx there may mean the work is already running,
 * and retrying would queue a second generation behind the global lock. The
 * caller must state explicitly what is retryable; see `vellum/client.ts`.
 */
import type { Logger } from "./logger.js";

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts: number;
  /** Base delay; attempt n waits a random value in [0, base * 2^n]. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Return true to retry. Receives the thrown error and the 1-based attempt. */
  shouldRetry: (error: unknown, attempt: number) => boolean;
  signal?: AbortSignal;
  logger?: Logger;
  label?: string;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    if (opts.signal?.aborted) throw abortError();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === opts.attempts;
      if (isLast || !opts.shouldRetry(error, attempt)) throw error;

      const ceiling = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.random() * ceiling; // full jitter
      opts.logger?.debug("retrying", {
        label: opts.label,
        attempt,
        of: opts.attempts,
        delayMs: Math.round(delay),
        reason: error instanceof Error ? error.message : String(error),
      });
      await sleep(delay, opts.signal);
    }
  }
  throw lastError;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Race a promise against a deadline. On expiry the supplied AbortController is
 * fired — for Vellum generation this is not merely tidy, it is the ONLY thing
 * that releases its process-global generation lock.
 */
export async function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  controller: AbortController = new AbortController(),
): Promise<T> {
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
