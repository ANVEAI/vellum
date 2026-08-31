/**
 * The single chokepoint for keeping secrets out of tool responses and logs.
 *
 * Two independent mechanisms, because either alone is insufficient:
 *
 *  1. Key-name matching. Vellum's `GET /api/settings` returns `geminiApiKey`
 *     and `pexelsApiKey` in plaintext (src/app/api/settings/route.ts:6-8), so
 *     anything proxied from it must be scrubbed by field name.
 *  2. Value matching. Our own Vellum password and inbound bearer tokens are
 *     redacted wherever they appear, including inside free-text error messages
 *     that we did not construct.
 */
import { knownSecrets } from "./config.js";

export const REDACTED = "***redacted***";
/** Distinguishes "a key is configured" from "the field is empty", without leaking it. */
export const PRESENT = "***set***";

/**
 * Field names whose values are secret regardless of where they appear.
 * Matched case-insensitively against the whole key.
 */
/**
 * Normalize a key to letters only, so `apiKey`, `api_key`, `api-key` and
 * `API KEY` all collapse to the same token. Keeping separators here was a bug:
 * `api-key` slipped past a set that only contained `api_key`.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

const SECRET_KEYS = new Set(
  [
    "password",
    "apikey",
    "geminiapikey",
    "pexelsapikey",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "cookie",
    "setcookie",
    "secret",
    "sessionsecret",
    "vellumsession",
  ].map(normalizeKey),
);

/** Keys that should report presence rather than vanish — useful for settings UX. */
const PRESENCE_KEYS = new Set(["geminiApiKey", "pexelsApiKey"].map(normalizeKey));

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizeKey(key));
}

/** Strip any registered secret value out of a string. */
export function redactString(input: string): string {
  let out = input;
  for (const secret of knownSecrets()) {
    if (secret.length < 4) continue; // too short to match safely
    while (out.includes(secret)) out = out.replace(secret, REDACTED);
  }
  // Cookie headers, wherever they were stringified from.
  out = out.replace(/(vellum_session=)[^;\s"]+/gi, `$1${REDACTED}`);
  out = out.replace(/(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, `$1${REDACTED}`);
  return out;
}

/**
 * Deep-clone `value` with secrets removed. Safe on cycles, and bounded in depth
 * so a pathological payload cannot blow the stack.
 */
export function redact<T>(value: T, maxDepth = 12): T {
  return walk(value, maxDepth, new WeakSet()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (depth <= 0) return "[redacted: max depth]";

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, depth - 1, seen));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return "[circular]";
    seen.add(obj);

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const normalized = normalizeKey(k);
      if (PRESENCE_KEYS.has(normalized)) {
        // Report whether it is configured without revealing it.
        out[k] = typeof v === "string" && v.length > 0 ? PRESENT : "";
      } else if (isSecretKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(v, depth - 1, seen);
      }
    }
    return out;
  }
  return String(value);
}
