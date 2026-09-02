/**
 * URL-prefix helpers for running Vellum under a `basePath`.
 *
 * Next's `basePath` only rewrites what Next itself controls: `next/link`,
 * `router.push`, `redirect()`, middleware redirects built from `nextUrl`, and
 * `/_next/*` assets. It does NOT touch a root-absolute string handed to
 * `fetch()`, `navigator.sendBeacon()`, an `<img src>`, a raw `<a href>`, or a
 * CSS `url()`. Everything in that second category has to be prefixed by hand,
 * and this module is the single place that knows how.
 *
 * With the variable unset every function here is the identity, so the default
 * build is unchanged.
 */

/**
 * Inlined at build time by Next because of the NEXT_PUBLIC_ prefix, so this
 * works in both server and client bundles. Must be read as a full property
 * access (not destructured from `process.env`) for that substitution to happen.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Prefix a root-relative path with the configured base.
 *
 * Deliberately narrow: it only touches strings that start with a single `/`.
 * Anything already absolute, protocol-relative, a data/blob URI, or relative is
 * returned untouched, because those are either not ours to rewrite or already
 * resolved against the right origin.
 *
 * Idempotent — passing an already-prefixed path returns it unchanged. That
 * matters because some values (stored image URLs, export URLs) can flow through
 * more than one helper on their way to the DOM.
 */
export function withBase(path: string): string {
  return applyBase(BASE_PATH, path);
}

/**
 * The rule itself, with the base passed in.
 *
 * Separate from `withBase` purely so tests can exercise every case without
 * rebuilding: `BASE_PATH` is inlined at build time, so a test cannot vary it by
 * setting an environment variable.
 */
export function applyBase(base: string, path: string): string {
  if (!base) return path;
  if (!path.startsWith("/")) return path; // relative, or bare filename
  if (path.startsWith("//")) return path; // protocol-relative — another origin
  if (path === base || path.startsWith(`${base}/`)) return path; // already prefixed
  return `${base}${path}`;
}

/**
 * `fetch` against a root-relative API path.
 *
 * Drop-in for `fetch("/api/…")`; the second argument is passed through
 * untouched, so method, headers, body and signal all behave exactly as before.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(withBase(input), init);
}

/**
 * Resolve a stored asset URL for rendering.
 *
 * Image URLs are persisted in the database as canonical root-relative paths
 * (`/api/images/file/<name>`) and deliberately stay that way — the prefix is a
 * deployment concern, not data. This applies it at render time only.
 *
 * Null and undefined pass through as an empty string so callers can hand it a
 * possibly-missing `rootImage.url` without a guard.
 */
export function assetUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  return withBase(url);
}
