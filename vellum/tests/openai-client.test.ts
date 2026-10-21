import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatOnce, streamChat } from "@/lib/generation/llm/ollama";
import { openAIConfig, probeOpenAI } from "@/lib/generation/llm/openai";

const ENV = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_MAX_TOKENS"] as const;

function sse(...chunks: unknown[]): Response {
  const text =
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("OpenAI-compatible provider (LLM_BASE_URL)", () => {
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

  it("is off unless LLM_BASE_URL is set, so Ollama stays the default", async () => {
    expect(openAIConfig()).toBeNull();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "hi" }, done: true }) + "\n"),
    );
    await chatOnce({ baseUrl: "http://ollama:11434", model: "qwen", messages: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("http://ollama:11434/api/chat");
  });

  it("streams through the gateway with the key, the model, stop and the document", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1/";
    process.env.LLM_API_KEY = "anve_sk_test";
    fetchMock.mockResolvedValue(
      sse(
        { choices: [{ delta: { role: "assistant", content: "" } }] },
        { choices: [{ delta: { content: "<PRESENTATION>" } }] },
        { choices: [{ delta: { content: "<SECTION>" } }] },
      ),
    );
    const deltas: string[] = [];
    const out = await streamChat({
      baseUrl: "http://ignored:11434",
      model: "qwen3.6:35b",
      messages: [{ role: "user", content: "deck" }],
      stop: ["</PRESENTATION>"],
      documentId: "doc-1",
      onDelta: (d) => deltas.push(d),
    });
    expect(out).toBe("<PRESENTATION><SECTION>");
    expect(deltas).toEqual(["<PRESENTATION>", "<SECTION>"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8100/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer anve_sk_test");
    expect(init.headers["X-Vellum-Document"]).toBe("doc-1");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "default", // the gateway's model, not the Ollama tag in settings
      stream: true,
      stop: ["</PRESENTATION>"],
      max_tokens: 16384,
    });
    expect(body.response_format).toBeUndefined();
  });

  it("sends a structured call as json_schema and reads it whole", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1";
    process.env.LLM_MODEL = "google/gemini-2.5-flash";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] })),
    );
    const schema = { type: "object", properties: { a: { type: "number" } } };
    const out = await chatOnce({
      baseUrl: "x",
      model: "x",
      messages: [{ role: "user", content: "json" }],
      format: schema,
    });
    expect(out).toBe('{"a":1}');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "output", schema },
    });
  });

  it("surfaces gateway errors instead of returning an empty deck", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1";
    fetchMock.mockResolvedValueOnce(new Response("no key", { status: 401 }));
    await expect(chatOnce({ baseUrl: "x", model: "x", messages: [] })).rejects.toThrow(
      /LLM HTTP 401/,
    );
    fetchMock.mockResolvedValueOnce(sse({ error: { message: "Model provider error" } }));
    await expect(chatOnce({ baseUrl: "x", model: "x", messages: [] })).rejects.toThrow(
      /Model provider error/,
    );
  });

  it("health reports the model ANVE's default resolves to", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "default", anve: { resolves_to: "google/gemini-2.5-flash" } }],
        }),
      ),
    );
    const cfg = openAIConfig();
    expect(cfg).not.toBeNull();
    expect(await probeOpenAI(cfg!)).toEqual({ ok: true, model: "google/gemini-2.5-flash" });
  });
});
