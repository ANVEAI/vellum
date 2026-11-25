/**
 * Who may call /mcp: a bearer token, and optionally only certain client
 * addresses.
 *
 * Both are off unless configured (VELLUM_MCP_REQUIRE_AUTH,
 * VELLUM_MCP_ALLOW_CLIENTS), so the loopback endpoint a local host drives
 * behaves exactly as it always has.
 *
 * The client address. A request from another machine is judged by its own
 * address; its headers are ignored, since anyone can write them. A request
 * from this machine's loopback came through a proxy on this machine — the
 * Cloudflare tunnel — and Cloudflare sets CF-Connecting-IP to the visitor's
 * address, replacing whatever the visitor sent, so that header names the
 * client. The server binds to loopback, so only local processes could write
 * the header themselves, and they are trusted already.
 */
import { timingSafeEqual } from "node:crypto";

export interface AccessRequest {
  /** The Authorization header, as sent. */
  authorization?: string;
  /** The TCP peer address. */
  peer?: string;
  /** CF-Connecting-IP, as sent. */
  connectingIp?: string;
}

export interface AccessPolicy {
  requireAuth: boolean;
  authTokens: readonly string[];
  allowClients: readonly string[];
}

export type AccessDecision =
  | { ok: true; client?: string }
  | { ok: false; status: 401 | 403; message: string; client?: string };

/** An IPv4 address carried in IPv6 form (::ffff:a.b.c.d) as plain IPv4. */
export function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const value = ip.trim();
  return value.toLowerCase().startsWith("::ffff:") ? value.slice(7) : value;
}

export function isLoopback(ip: string | undefined): boolean {
  return ip === "::1" || (ip?.startsWith("127.") ?? false);
}

/** The address a request should be judged by — see the header comment. */
export function clientAddress(req: AccessRequest): string | undefined {
  const peer = normalizeIp(req.peer);
  if (isLoopback(peer) && req.connectingIp) return normalizeIp(req.connectingIp);
  return peer;
}

/** Constant-time comparison against every accepted token. */
function tokenAccepted(presented: string, accepted: readonly string[]): boolean {
  const given = Buffer.from(presented);
  return accepted.some((token) => {
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function checkAccess(req: AccessRequest, policy: AccessPolicy): AccessDecision {
  const client = clientAddress(req);
  if (policy.allowClients.length > 0 && (!client || !policy.allowClients.includes(client))) {
    return { ok: false, status: 403, message: "This address may not use this endpoint.", client };
  }
  if (policy.requireAuth) {
    const presented = /^Bearer\s+(\S+)\s*$/i.exec(req.authorization ?? "")?.[1];
    if (!presented || !tokenAccepted(presented, policy.authTokens)) {
      return { ok: false, status: 401, message: "Missing or invalid bearer token.", client };
    }
  }
  return { ok: true, client };
}
