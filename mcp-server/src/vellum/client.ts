/**
 * HTTP client for Vellum.
 *
 * Owns: base URL, session cookie attachment, 401 recovery, timeouts, and the
 * retry policy. Contains no business logic — the domain layer composes these
 * calls into capabilities.
 *
 * Retry policy is deliberately narrow. Vellum's generation and export routes
 * are non-idempotent: a 5xx there may mean the work is already running behind a
 * process-global lock, and a blind retry would queue a second generation.
 */
import {
  upstreamError,
  upstreamUnavailable,
  VellumMcpError,
  busy,
  preconditionFailed,
} from "../infra/errors.js";
import type { Logger } from "../infra/logger.js";
import { withRetry } from "../infra/retry.js";
import { SessionProvider } from "./auth.js";

export interface VellumClientOptions {
  baseUrl: string;
  session: SessionProvider;
  logger: Logger;
  defaultTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON body. Mutually exclusive with `form`. */
  body?: unknown;
  /** multipart/form-data body. */
  form?: FormData;
  /**
   * Overall deadline. Pass 0 to disable — required for SSE, where a fetch-level
   * timeout would abort the generation mid-stream. Streaming callers must
   * supply their own inter-byte watchdog and abort through `signal`.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Whether a transport/5xx failure may be retried. Default false.
   * Set true ONLY for reads and other genuinely idempotent calls.
   */
  retryable?: boolean;
  /** Suppress the automatic 401 → re-login → replay. */
  noReauth?: boolean;
}

export class VellumClient {
  readonly baseUrl: string;
  private readonly session: SessionProvider;
  private readonly log: Logger;
  private readonly defaultTimeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(opts: VellumClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.session = opts.session;
    this.log = opts.logger;
    this.defaultTimeoutMs = opts.defaultTimeoutMs;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  /* ---------------------------------------------------------------------- */
  /* Core                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Perform a request and return the raw Response.
   *
   * Handles cookie attachment and one 401-triggered re-login. Does NOT read the
   * body, so it serves JSON, SSE and binary callers alike.
   */
  async raw(path: string, opts: RequestOptions = {}): Promise<Response> {
    const attempt = async (cookie: string): Promise<Response> => {
      const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
      const controller = new AbortController();
      const onOuterAbort = () => controller.abort();
      opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
      // timeoutMs === 0 means "no deadline" — see RequestOptions.timeoutMs.
      const timer =
        timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

      try {
        const headers: Record<string, string> = { cookie };
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";

        return await this.doFetch(`${this.baseUrl}${path}`, {
          method: opts.method ?? "GET",
          headers,
          body:
            opts.form ??
            (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
          signal: controller.signal,
        });
      } catch (cause) {
        if (opts.signal?.aborted) {
          const e = new Error("Aborted");
          e.name = "AbortError";
          throw e;
        }
        if (controller.signal.aborted) {
          throw new VellumMcpError({
            kind: "timeout",
            message: `Request to ${path} exceeded ${timeoutMs}ms and was aborted.`,
            retryable: true,
          });
        }
        throw upstreamUnavailable(this.baseUrl, cause);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onOuterAbort);
      }
    };

    const run = async (): Promise<Response> => {
      let res = await attempt(await this.session.getCookie(opts.signal));

      // Session expired or Vellum restarted with a new SESSION_SECRET.
      if (res.status === 401 && !opts.noReauth) {
        this.log.debug("401 from Vellum; refreshing session once", { path });
        // Drain the discarded body so the socket is released.
        await res.text().catch(() => undefined);
        res = await attempt(await this.session.refresh(opts.signal));
      }
      return res;
    };

    if (!opts.retryable) return run();

    return withRetry(run, {
      attempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 3_000,
      signal: opts.signal,
      logger: this.log,
      label: path,
      shouldRetry: (error) => {
        if (error instanceof VellumMcpError) {
          return error.kind === "upstream_unavailable" || error.kind === "timeout";
        }
        return false;
      },
    });
  }

  /** Request expecting JSON. Throws a typed error on non-2xx. */
  async json<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.raw(path, opts);
    if (!res.ok) throw await this.toError(res, path);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Open an SSE stream. Returns the body for the caller to drain.
   *
   * Pre-stream failures (400/404/409) arrive as ordinary JSON with a real status
   * code and are thrown here. Failures *during* generation arrive as
   * `event: error` inside an already-committed 200 and must be detected by the
   * consumer — see `sse.ts`.
   */
  async stream(path: string, opts: RequestOptions = {}): Promise<ReadableStream<Uint8Array>> {
    const res = await this.raw(path, { ...opts, retryable: false });
    if (!res.ok) throw await this.toError(res, path);
    if (!res.body) {
      throw new VellumMcpError({
        kind: "upstream_error",
        message: `Vellum returned no body for the ${path} stream.`,
      });
    }
    return res.body;
  }

  /** Request expecting binary bytes (exports). */
  async binary(
    path: string,
    opts: RequestOptions = {},
  ): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; filename: string | null }> {
    const res = await this.raw(path, { ...opts, retryable: false });
    if (!res.ok) throw await this.toError(res, path);
    if (!res.body) {
      throw new VellumMcpError({
        kind: "upstream_error",
        message: `Vellum returned no body for ${path}.`,
      });
    }
    return {
      body: res.body,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      filename: parseFilename(res.headers.get("content-disposition")),
    };
  }

  /* ---------------------------------------------------------------------- */

  /** Map a non-2xx response onto the error taxonomy. */
  private async toError(res: Response, path: string): Promise<VellumMcpError> {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* not JSON — use the raw text */
    }

    if (res.status === 409) {
      // 409 carries TWO incompatible meanings in Vellum, distinguishable only
      // by endpoint — never by status code:
      //   /api/generation/*  -> the process-global lock is held. Retryable.
      //   /api/export/*      -> the deck has no slides (or corrupt slides JSON).
      //                         A precondition failure that will never clear on
      //                         its own; retrying is pure waste.
      if (path.startsWith("/api/export/")) {
        return preconditionFailed(
          message ||
            "This document has no slides yet, so there is nothing to export. " +
              "Generate content first.",
          { status: 409 },
        );
      }
      return busy(message || "Vellum is busy with another generation.");
    }
    if (res.status === 404) {
      return new VellumMcpError({
        kind: "not_found",
        message: message || `Not found: ${path}`,
        details: { status: 404 },
      });
    }
    if (res.status === 400 || res.status === 415 || res.status === 422) {
      return new VellumMcpError({
        kind: "invalid_input",
        message: message || `Vellum rejected the request to ${path}.`,
        details: { status: res.status },
      });
    }
    if (res.status === 413) {
      return new VellumMcpError({
        kind: "invalid_input",
        message: message || "Upload exceeds Vellum's 25 MB limit.",
        details: { status: 413 },
      });
    }
    return upstreamError(res.status, message || res.statusText, { path });
  }
}

/** `attachment; filename="Deck.pptx"` -> `Deck.pptx` */
export function parseFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const quoted = /filename="([^"]+)"/.exec(disposition);
  if (quoted?.[1]) return quoted[1];
  const bare = /filename=([^;]+)/.exec(disposition);
  return bare?.[1]?.trim() ?? null;
}
