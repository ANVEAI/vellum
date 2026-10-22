import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  anveResearchEnabled,
  formatAnveContext,
  researchViaAnve,
} from "@/lib/generation/research/anve";

const ENV = ["LLM_BASE_URL", "LLM_API_KEY", "RESEARCH_PROVIDER"] as const;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ANVE web research (RESEARCH_PROVIDER=anve)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ENV) delete process.env[k];
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ENV) delete process.env[k];
  });

  it("is off unless RESEARCH_PROVIDER says anve", () => {
    expect(anveResearchEnabled()).toBe(false);
    process.env.RESEARCH_PROVIDER = "ANVE";
    expect(anveResearchEnabled()).toBe(true);
  });

  it("posts the brief with the key and the deck, and keeps the sources server-side", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1/";
    process.env.LLM_API_KEY = "anve_sk_test";
    fetchMock.mockResolvedValue(
      reply({
        notes: ["Kelp forests store 4.9 million tonnes of carbon a year.", "They shelter otters."],
        sources: [
          { n: 1, title: "pib.gov.in", domain: "pib.gov.in",
            url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA" },
          { n: 2, title: "reuters.com", domain: "www.reuters.com", url: "https://www.reuters.com/b" },
        ],
      }),
    );
    const got = await researchViaAnve({ query: "Kelp forests", limit: 5, documentId: "doc1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8100/v1/web-research");
    expect(init.headers.Authorization).toBe("Bearer anve_sk_test");
    expect(init.headers["X-Vellum-Document"]).toBe("doc1");
    expect(JSON.parse(init.body)).toEqual({ query: "Kelp forests", max_sources: 5 });
    expect(got.sources.map((s) => s.url)).toEqual([
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA",
      "https://www.reuters.com/b",
    ]);
    expect(got.sources.map((s) => s.publisher)).toEqual(["Pib", "Reuters"]);
    expect(got.context).toContain("1. Kelp forests store 4.9 million tonnes of carbon a year.");
    expect(got.context).toContain("[2] Reuters");
    expect(got.context).not.toContain("https://");      // URLs never reach the model
  });

  it("degrades to no research on any failure", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1";
    fetchMock.mockResolvedValueOnce(reply({ error: { message: "nope" } }, 502));
    expect(await researchViaAnve({ query: "x", limit: 3 })).toEqual({ context: "", sources: [] });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await researchViaAnve({ query: "x", limit: 3 })).toEqual({ context: "", sources: [] });
    fetchMock.mockResolvedValueOnce(reply({ notes: [], sources: [{ url: "https://a.b" }] }));
    expect(await researchViaAnve({ query: "x", limit: 3 })).toEqual({ context: "", sources: [] });
  });

  it("does nothing without a gateway", async () => {
    expect(await researchViaAnve({ query: "x", limit: 3 })).toEqual({ context: "", sources: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("formats nothing for no notes", () => {
    expect(formatAnveContext([], [])).toBe("");
  });
});
