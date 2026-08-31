/**
 * Redaction. Vellum's GET /api/settings returns geminiApiKey and pexelsApiKey
 * in plaintext, so anything proxied from it must be scrubbed before it can
 * reach a model's context or a log file.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { registerSecrets } from "../../src/infra/config.js";
import { PRESENT, REDACTED, redact, redactString } from "../../src/infra/redact.js";

const PASSWORD = "sup3r-secret-password";

beforeAll(() => {
  registerSecrets({
    vellumAppPassword: PASSWORD,
    authTokens: ["inbound-token-abcdef"],
  } as never);
});

describe("redact", () => {
  it("reports API keys as present without revealing them", () => {
    const out = redact({ images: { geminiApiKey: "AIzaSyREAL_KEY_VALUE", pexelsApiKey: "" } }) as any;
    expect(out.images.geminiApiKey).toBe(PRESENT);
    expect(out.images.pexelsApiKey).toBe("");
    expect(JSON.stringify(out)).not.toContain("AIzaSy");
  });

  it("redacts secret-named fields entirely", () => {
    const out = redact({ password: "x", cookie: "vellum_session=abc", authorization: "Bearer y" }) as any;
    expect(out.password).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
    expect(out.authorization).toBe(REDACTED);
  });

  it("removes the registered password even from free text we did not author", () => {
    const msg = `login failed for ${PASSWORD} at host`;
    expect(redactString(msg)).not.toContain(PASSWORD);
    expect(redactString(msg)).toContain(REDACTED);
  });

  it("scrubs session cookies wherever they appear in a string", () => {
    expect(redactString("cookie: vellum_session=abc123def; Path=/")).not.toContain("abc123def");
  });

  it("walks nested structures and arrays", () => {
    const out = redact({ a: [{ b: { geminiApiKey: "AIzaXYZ" } }] }) as any;
    expect(out.a[0].b.geminiApiKey).toBe(PRESENT);
  });

  it("survives circular references", () => {
    const obj: any = { name: "x" };
    obj.self = obj;
    expect(() => redact(obj)).not.toThrow();
  });

  it("matches key names case- and separator-insensitively", () => {
    const out = redact({ API_KEY: "abc", "api-key": "def" }) as any;
    expect(out.API_KEY).toBe(REDACTED);
    expect(out["api-key"]).toBe(REDACTED);
  });
});
