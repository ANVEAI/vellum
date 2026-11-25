/**
 * Who may call /mcp: the bearer token and the client allowlist.
 *
 * The endpoint ANVE Box's cloud calls is published through a Cloudflare
 * tunnel, so the visitor's address arrives in CF-Connecting-IP on a loopback
 * connection. That header is believed only from loopback: a request from
 * anywhere else is judged by its own address, whatever it claims.
 */
import { describe, expect, it } from "vitest";
import { checkAccess, clientAddress } from "../../src/mcp/transports/guard.js";

const open = { requireAuth: false, authTokens: [], allowClients: [] };
const tokenOnly = { requireAuth: true, authTokens: ["s3cret-token", "second"], allowClients: [] };
const anveOnly = { requireAuth: true, authTokens: ["s3cret-token"], allowClients: ["8.234.105.212"] };

describe("checkAccess", () => {
  it("lets everything through when nothing is configured, as before", () => {
    expect(checkAccess({ peer: "127.0.0.1" }, open).ok).toBe(true);
    expect(checkAccess({ peer: "10.0.0.9", authorization: "Bearer nonsense" }, open).ok).toBe(true);
  });

  it("asks for the bearer token when auth is on", () => {
    expect(checkAccess({ peer: "127.0.0.1" }, tokenOnly)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess({ peer: "127.0.0.1", authorization: "Bearer wrong" }, tokenOnly)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess({ peer: "127.0.0.1", authorization: "s3cret-token" }, tokenOnly)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess({ peer: "127.0.0.1", authorization: "Bearer s3cret-token" }, tokenOnly).ok).toBe(true);
    expect(checkAccess({ peer: "127.0.0.1", authorization: "bearer second " }, tokenOnly).ok).toBe(true);
  });

  it("believes CF-Connecting-IP only from this machine's loopback", () => {
    const auth = "Bearer s3cret-token";
    // Through the tunnel: loopback peer, Cloudflare's header names the visitor.
    expect(checkAccess({ peer: "127.0.0.1", connectingIp: "8.234.105.212", authorization: auth }, anveOnly).ok).toBe(true);
    expect(checkAccess({ peer: "::ffff:127.0.0.1", connectingIp: "8.234.105.212", authorization: auth }, anveOnly).ok).toBe(true);
    expect(checkAccess({ peer: "127.0.0.1", connectingIp: "202.3.77.212", authorization: auth }, anveOnly)).toMatchObject({ ok: false, status: 403 });
    // Straight from another machine, a forged header changes nothing.
    expect(checkAccess({ peer: "203.0.113.7", connectingIp: "8.234.105.212", authorization: auth }, anveOnly)).toMatchObject({ ok: false, status: 403 });
    // Loopback with no header is judged as loopback, which is not on the list.
    expect(checkAccess({ peer: "127.0.0.1", authorization: auth }, anveOnly)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses an address off the list before looking at the token", () => {
    expect(checkAccess({ peer: "127.0.0.1", connectingIp: "198.51.100.1" }, anveOnly)).toMatchObject({ status: 403 });
    expect(checkAccess({ peer: "127.0.0.1", connectingIp: "8.234.105.212" }, anveOnly)).toMatchObject({ status: 401 });
  });
});

describe("clientAddress", () => {
  it("reads IPv4 out of IPv6-mapped peers and trims the forwarded address", () => {
    expect(clientAddress({ peer: "::ffff:10.1.2.3" })).toBe("10.1.2.3");
    expect(clientAddress({ peer: "::1", connectingIp: " 8.234.105.212 " })).toBe("8.234.105.212");
  });
});
