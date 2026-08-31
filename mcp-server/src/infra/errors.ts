/**
 * Error taxonomy and its mapping onto MCP semantics.
 *
 * The 2026-07-28 spec draws a hard line:
 *
 *   - **Protocol errors** (JSON-RPC `error`) are for malformed requests and
 *     unknown tools — things a model cannot fix by trying again.
 *   - **Tool execution errors** (`isError: true` in the result) carry
 *     actionable feedback the model *can* self-correct from.
 *
 * Almost everything Vellum can do to us is the second kind, so the default here
 * is a tool execution error with a message written for an agent to act on.
 */
import { redactString } from "./redact.js";

export type ErrorKind =
  /** Caller supplied something invalid. Agent should fix the arguments. */
  | "invalid_input"
  /** Named document/slide/template does not exist. */
  | "not_found"
  /** Vellum is busy with another generation (its lock is global). */
  | "busy"
  /** The operation ran past our own deadline and was aborted. */
  | "timeout"
  /** The caller (or a TTL) cancelled the operation. */
  | "cancelled"
  /** Vellum is unreachable or unhealthy. */
  | "upstream_unavailable"
  /** Vellum answered, but with a failure we cannot classify further. */
  | "upstream_error"
  /** Generation itself failed (SSE `event: error`, or a stranded document). */
  | "generation_failed"
  /** A precondition is unmet, e.g. exporting a deck with no slides. */
  | "precondition_failed"
  /** We are misconfigured; the operator must fix it, not the agent. */
  | "configuration"
  /** Inbound authorization failed (only reachable when REQUIRE_AUTH is on). */
  | "unauthorized";

export interface McpErrorOptions {
  kind: ErrorKind;
  /** Message written for the agent. Must say what to do next where possible. */
  message: string;
  /** Machine-readable extras merged into the structured error payload. */
  details?: Record<string, unknown>;
  /** True when the same call, unchanged, might succeed later. */
  retryable?: boolean;
  cause?: unknown;
}

export class VellumMcpError extends Error {
  override readonly name = "VellumMcpError";
  readonly kind: ErrorKind;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(opts: McpErrorOptions) {
    super(redactString(opts.message));
    this.kind = opts.kind;
    this.details = opts.details ?? {};
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  /** The shape returned to the agent inside `structuredContent`. */
  toPayload(): Record<string, unknown> {
    return {
      ok: false,
      error: { kind: this.kind, message: this.message, retryable: this.retryable, ...this.details },
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Constructors for the failures we actually expect                            */
/* -------------------------------------------------------------------------- */

export const invalidInput = (message: string, details?: Record<string, unknown>) =>
  new VellumMcpError({ kind: "invalid_input", message, details });

export const notFound = (what: string, id: string) =>
  new VellumMcpError({
    kind: "not_found",
    message: `${what} "${id}" does not exist. Use vellum.list_documents to see what is available.`,
    details: { id },
  });

export const busy = (message: string) =>
  new VellumMcpError({
    kind: "busy",
    message,
    retryable: true,
  });

export const timedOut = (op: string, ms: number, details?: Record<string, unknown>) =>
  new VellumMcpError({
    kind: "timeout",
    message:
      `${op} exceeded the ${Math.round(ms / 1000)}s limit and was aborted. ` +
      `Vellum's generation lock has been released, so a retry is safe.`,
    details,
    retryable: true,
  });

export const cancelled = (op: string, details?: Record<string, unknown>) =>
  new VellumMcpError({ kind: "cancelled", message: `${op} was cancelled.`, details });

export const upstreamUnavailable = (baseUrl: string, cause?: unknown) =>
  new VellumMcpError({
    kind: "upstream_unavailable",
    message:
      `Cannot reach Vellum at ${baseUrl}. Confirm the app is running ` +
      `(scripts\\vellum-autostart.ps1 registers it) and that VELLUM_BASE_URL is correct.`,
    retryable: true,
    cause,
  });

export const upstreamError = (status: number, body: string, details?: Record<string, unknown>) =>
  new VellumMcpError({
    kind: "upstream_error",
    message: `Vellum returned HTTP ${status}: ${body.slice(0, 400)}`,
    details: { status, ...details },
    retryable: status >= 500,
  });

export const generationFailed = (detail: string, details?: Record<string, unknown>) =>
  new VellumMcpError({
    kind: "generation_failed",
    message: `Generation failed: ${detail}`,
    details,
  });

export const preconditionFailed = (message: string, details?: Record<string, unknown>) =>
  new VellumMcpError({ kind: "precondition_failed", message, details });

export const configuration = (message: string) =>
  new VellumMcpError({ kind: "configuration", message });

export const unauthorized = (message = "Missing or invalid bearer token.") =>
  new VellumMcpError({ kind: "unauthorized", message });

/** Wrap anything unknown so it still reaches the agent as a clean payload. */
export function toMcpError(err: unknown): VellumMcpError {
  if (err instanceof VellumMcpError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new VellumMcpError({ kind: "cancelled", message: "The operation was aborted." });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new VellumMcpError({ kind: "upstream_error", message, cause: err });
}
