/**
 * Per-request caller context.
 *
 * Vellum itself is single-tenant — there is no user, owner or tenant column
 * anywhere in its schema — so today this carries an anonymous subject. It exists
 * so that when a host platform starts propagating identity, every layer already
 * accepts it and no tool signature has to change.
 *
 * The 2026-07-28 spec makes this the right shape: the core is stateless and
 * "credentials are per-request input, not connection state", and a server MAY
 * vary its advertised tool set by the authorization presented on the request.
 */
import { randomUUID } from "node:crypto";

export interface CallerContext {
  /** Stable id for the calling principal, when the host supplies one. */
  readonly subject?: string;
  /** Granted scopes, for future per-caller tool filtering. */
  readonly scopes: readonly string[];
  /** Correlates every log line and upstream call for one tool invocation. */
  readonly requestId: string;
  /** BCP-47 tag, if the host knows the user's locale. */
  readonly locale?: string;
  /** Absolute deadline (epoch ms) if the host imposes one. */
  readonly deadline?: number;
  /**
   * Cancellation for everything done on behalf of this call.
   *
   * Not a convenience: aborting is the only thing that releases Vellum's
   * process-global generation lock when a generation is cut short, so this
   * signal has to reach every downstream fetch.
   */
  readonly signal: AbortSignal;
}

export function anonymousContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    scopes: [],
    requestId: randomUUID(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

export function hasScope(ctx: CallerContext, scope: string): boolean {
  // With no inbound auth, scopes are empty and everything is permitted.
  return ctx.scopes.length === 0 || ctx.scopes.includes(scope);
}

/** Remaining milliseconds before the caller's deadline, or `undefined`. */
export function remainingMs(ctx: CallerContext): number | undefined {
  if (ctx.deadline === undefined) return undefined;
  return Math.max(0, ctx.deadline - Date.now());
}
