/**
 * Which documents a request may LIST, when Vellum runs behind ANVE.
 *
 * Vellum has no users: one password, one library. ANVE embeds it for many
 * people and keeps the record of whose deck is whose; its proxy already refuses
 * to open, export or edit somebody else's deck. Listing is different: the
 * library page is rendered here, on the server, so a proxy that only filters
 * the JSON of GET /api/documents never sees it, and every signed-in ANVE user
 * saw every title, thumbnail and slide count.
 *
 * So ANVE tells Vellum, on every request, which documents the person may see:
 *
 *   x-anve-scope: v1.<expires, unix seconds>.<scope>.<hex HMAC-SHA256>
 *
 * where <scope> is "*" (an admin: everything) or a comma-separated list of
 * document ids, and the HMAC is over "v1.<expires>.<scope>" with a key both
 * sides hold. The proxy sets the header itself and drops any copy the browser
 * sent, so the browser never sees a token and cannot bring one.
 *
 * Enforcement is on when ANVE_SCOPE_SECRET is set (the key itself) or
 * ANVE_SCOPE=required (the key is derived from APP_PASSWORD, which ANVE already
 * shares as ANVE_VELLUM_PASSWORD - no second secret to configure). With it on,
 * a list query without a valid, unexpired token returns NOTHING: fail closed.
 * With it off this is standalone Vellum and every list is the whole library,
 * exactly as before.
 *
 * Only the lists are scoped here (the library page, GET /api/documents). A
 * single document is reached by id, and ANVE's proxy already decides those per
 * request; Vellum's own headless export and ANVE's server-side generator reach
 * them without going through the proxy, so scoping them here would break both.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SCOPE_HEADER = "x-anve-scope";
/** Set on every response while enforcement is on, so ANVE can refuse a Vellum that is not. */
export const ENFORCED_HEADER = "x-vellum-scope";
const KEY_LABEL = "anve-vellum-scope-v1";
/** A token is minted per request; anything claiming a long life is not ANVE's. */
const MAX_LIFETIME_S = 600;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type DocScope = { all: true } | { all: false; ids: string[] };

const NOTHING: DocScope = { all: false, ids: [] };

type Env = Record<string, string | undefined>;

export function scopeEnforced(env: Env = process.env): boolean {
  return Boolean(env.ANVE_SCOPE_SECRET) || env.ANVE_SCOPE === "required";
}

/** The shared key: the explicit secret, else derived from the shared password. */
export function scopeKey(env: Env = process.env): Buffer | null {
  if (env.ANVE_SCOPE_SECRET) return Buffer.from(env.ANVE_SCOPE_SECRET, "utf8");
  if (env.ANVE_SCOPE === "required" && env.APP_PASSWORD) {
    return createHmac("sha256", env.APP_PASSWORD).update(KEY_LABEL).digest();
  }
  return null;
}

export function signScope(key: Buffer, expires: number, scope: string): string {
  const body = `v1.${expires}.${scope}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("hex")}`;
}

/** The scope a token grants, or null if it is not a valid, current token for this key. */
export function verifyScope(
  token: string | null | undefined,
  key: Buffer,
  nowS: number = Math.floor(Date.now() / 1000),
): DocScope | null {
  if (!token || token.length > 64 * 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, exp, scope, sig] = parts;
  if (!/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const want = Buffer.from(signScope(key, Number(exp), scope).split(".")[3], "hex");
  const got = Buffer.from(sig, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const expires = Number(exp);
  if (expires < nowS || expires - nowS > MAX_LIFETIME_S) return null;
  if (scope === "*") return { all: true };
  if (scope === "") return NOTHING;
  const ids = scope.split(",");
  if (!ids.every((id) => ID_RE.test(id))) return null;
  return { all: false, ids };
}

/** What this request may list. Not behind ANVE: everything. Behind it: the token's say-so. */
export function documentScope(
  headers: Pick<Headers, "get">,
  env: Env = process.env,
  nowS?: number,
): DocScope {
  if (!scopeEnforced(env)) return { all: true };
  const key = scopeKey(env);
  if (!key) return NOTHING; // ANVE_SCOPE=required without a password: nothing to verify with
  return verifyScope(headers.get(SCOPE_HEADER), key, nowS) ?? NOTHING;
}

/** A Prisma `where` for Document lists under this scope (undefined = no filter). */
export function scopeWhere(scope: DocScope): { id: { in: string[] } } | undefined {
  return scope.all ? undefined : { id: { in: scope.ids } };
}
