/**
 * Session management for Vellum's shared-password auth.
 *
 * Vellum has no API-key path: you POST the password to /api/auth/login and get
 * a `vellum_session` cookie (iron-session, 30-day TTL).
 *
 * ## Why a failed login must NEVER be retried
 *
 * `src/app/api/auth/login/route.ts` calls `recordAttempt(ip)` **only in the
 * failure branch** — a successful login does not consume the bucket. The limit
 * is 5 failures per minute per IP, and the key is
 * `x-forwarded-for?.split(",")[0] || "local"`, so a server that sends no XFF
 * header shares the `"local"` bucket **with Vellum's own web UI**.
 *
 * Therefore a wrong password plus any retry loop does not just fail — it locks
 * the human operator out of their own browser session. A 401 here is a
 * configuration fault, not a transient one, so it trips a permanent circuit
 * breaker that fails every subsequent call fast with an actionable message.
 */
import { configuration, upstreamUnavailable, VellumMcpError } from "../infra/errors.js";
import type { Logger } from "../infra/logger.js";

export const SESSION_COOKIE = "vellum_session";

export interface SessionProviderOptions {
  baseUrl: string;
  password: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export class SessionProvider {
  private cookie: string | null = null;
  /** De-duplicates concurrent logins so N callers cause exactly one POST. */
  private inFlight: Promise<string> | null = null;
  /** Set once a login is rejected; never cleared for the process lifetime. */
  private breaker: VellumMcpError | null = null;

  private readonly baseUrl: string;
  private readonly password: string;
  private readonly log: Logger;
  private readonly doFetch: typeof fetch;

  constructor(opts: SessionProviderOptions) {
    this.baseUrl = opts.baseUrl;
    this.password = opts.password;
    this.log = opts.logger;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  /** True once the password has been rejected — every call fails fast after that. */
  get isBroken(): boolean {
    return this.breaker !== null;
  }

  /** Cookie header value, logging in if necessary. */
  async getCookie(signal?: AbortSignal): Promise<string> {
    if (this.breaker) throw this.breaker;
    if (this.cookie) return this.cookie;
    return this.login(signal);
  }

  /**
   * Force a fresh login. Called only after a 401 on a non-login route, i.e. the
   * cached cookie expired or Vellum restarted with a new SESSION_SECRET.
   */
  async refresh(signal?: AbortSignal): Promise<string> {
    if (this.breaker) throw this.breaker;
    this.cookie = null;
    return this.login(signal);
  }

  private login(signal?: AbortSignal): Promise<string> {
    // Single-flight: concurrent callers await the same request.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.doLogin(signal).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doLogin(signal?: AbortSignal): Promise<string> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.password }),
        signal: signal ?? null,
      });
    } catch (cause) {
      // Network-level failure is transient — do NOT trip the breaker.
      throw upstreamUnavailable(this.baseUrl, cause);
    }

    if (res.status === 401) {
      this.breaker = configuration(
        "Vellum rejected the configured password (VELLUM_APP_PASSWORD). " +
          "This server will not retry: Vellum rate-limits FAILED logins to 5 per minute " +
          "per IP, and all callers without an X-Forwarded-For header share one bucket " +
          "with Vellum's own web UI — retrying would lock the operator out of their " +
          "browser. Fix the password and restart this server.",
      );
      this.log.error("login rejected; circuit breaker tripped", { status: 401 });
      throw this.breaker;
    }

    if (res.status === 429) {
      throw new VellumMcpError({
        kind: "busy",
        message:
          "Vellum's login endpoint is rate-limited (5 failed attempts per minute). " +
          "Wait 60 seconds before trying again.",
        details: { retryAfterSeconds: 60 },
        retryable: true,
      });
    }

    if (res.status === 500) {
      // APP_PASSWORD unset on the Vellum side.
      this.breaker = configuration(
        "Vellum reports that APP_PASSWORD is not configured on its side. " +
          "Set it in vellum/.env and restart Vellum.",
      );
      throw this.breaker;
    }

    if (!res.ok) {
      throw new VellumMcpError({
        kind: "upstream_error",
        message: `Unexpected HTTP ${res.status} from Vellum's login endpoint.`,
        details: { status: res.status },
      });
    }

    const cookie = extractSessionCookie(res.headers);
    if (!cookie) {
      throw new VellumMcpError({
        kind: "upstream_error",
        message:
          "Vellum accepted the password but returned no session cookie. " +
          "This usually means SESSION_SECRET is missing or shorter than 32 characters.",
      });
    }

    this.cookie = cookie;
    this.log.info("authenticated with Vellum");
    return cookie;
  }
}

/**
 * Pull `vellum_session=...` out of Set-Cookie.
 *
 * `getSetCookie()` is the correct API — a plain `get("set-cookie")` collapses
 * multiple cookies into one comma-joined string and mangles the value.
 */
export function extractSessionCookie(headers: Headers): string | null {
  const all =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""].filter(Boolean);

  for (const raw of all) {
    const first = raw.split(";")[0];
    if (first && first.startsWith(`${SESSION_COOKIE}=`)) return first;
  }
  return null;
}
