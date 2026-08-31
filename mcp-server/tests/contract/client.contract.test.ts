/**
 * Contract tests against a REAL http server, not a fetch mock — the auth and
 * error-classification behaviour only means anything over a real socket.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SessionProvider } from "../../src/vellum/auth.js";
import { VellumClient } from "../../src/vellum/client.js";
import { nullLogger } from "../../src/infra/logger.js";

interface Observations {
  logins: number;
  requests: string[];
  failNextWith401: number;
  loginStatus: number;
}

let server: Server;
let baseUrl: string;
let obs: Observations;

beforeAll(async () => {
  obs = { logins: 0, requests: [], failNextWith401: 0, loginStatus: 200 };

  server = createServer((req, res) => {
    const url = req.url ?? "";
    obs.requests.push(`${req.method} ${url}`);

    if (url === "/api/auth/login") {
      obs.logins++;
      if (obs.loginStatus !== 200) {
        res.writeHead(obs.loginStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Incorrect password." }));
        return;
      }
      // Deliberately slow so concurrent callers overlap and the single-flight
      // guard is actually exercised.
      setTimeout(() => {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": `vellum_session=cookie-${obs.logins}; Path=/; HttpOnly`,
        });
        res.end(JSON.stringify({ ok: true }));
      }, 25);
      return;
    }

    if (obs.failNextWith401 > 0) {
      obs.failNextWith401--;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (url.startsWith("/api/generation/")) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Another generation is already running." }));
      return;
    }
    if (url.startsWith("/api/export/")) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "This document has no content yet." }));
      return;
    }
    if (url.startsWith("/api/documents/missing")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, url }));
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function makeClient() {
  const session = new SessionProvider({ baseUrl, password: "pw", logger: nullLogger });
  const client = new VellumClient({
    baseUrl,
    session,
    logger: nullLogger,
    defaultTimeoutMs: 5000,
  });
  return { client, session };
}

describe("VellumClient", () => {
  it("logs in once and reuses the cookie across many concurrent calls", async () => {
    // Vellum rate-limits FAILED logins 5/min against a bucket shared with its
    // own web UI, so a login storm is genuinely dangerous.
    obs.logins = 0;
    const { client } = makeClient();
    await Promise.all(Array.from({ length: 12 }, () => client.json("/api/health")));
    expect(obs.logins).toBe(1);
  });

  it("re-authenticates exactly once on a 401 and replays the request", async () => {
    obs.logins = 0;
    const { client } = makeClient();
    await client.json("/api/health"); // establish a session
    expect(obs.logins).toBe(1);

    obs.failNextWith401 = 1;
    const result = await client.json<{ ok: boolean }>("/api/health");
    expect(result.ok).toBe(true);
    expect(obs.logins).toBe(2);
  });

  it("classifies a generation 409 as retryable busy", async () => {
    const { client } = makeClient();
    await expect(client.json("/api/generation/content", { method: "POST" })).rejects.toMatchObject({
      kind: "busy",
      retryable: true,
    });
  });

  it("classifies an export 409 as a NON-retryable precondition failure", async () => {
    // Same status code, opposite meaning. Discriminated by endpoint, never by
    // status — retrying an empty-deck export can never succeed.
    const { client } = makeClient();
    await expect(client.json("/api/export/pdf/abc")).rejects.toMatchObject({
      kind: "precondition_failed",
      retryable: false,
    });
  });

  it("maps 404 to not_found", async () => {
    const { client } = makeClient();
    await expect(client.json("/api/documents/missing")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("trips a permanent circuit breaker on a rejected password", async () => {
    // A wrong password plus a retry loop would burn the shared 5/min bucket and
    // lock the human operator out of their own browser.
    obs.loginStatus = 401;
    obs.logins = 0;
    const { client, session } = makeClient();

    await expect(client.json("/api/health")).rejects.toMatchObject({ kind: "configuration" });
    expect(session.isBroken).toBe(true);

    // Every later call fails fast without touching the login endpoint again.
    await expect(client.json("/api/health")).rejects.toMatchObject({ kind: "configuration" });
    expect(obs.logins).toBe(1);

    obs.loginStatus = 200;
  });
});
