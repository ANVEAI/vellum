import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAnveImage, generateImage } from "@/lib/images/provider";
import { envImageProvider, settingsSchema } from "@/lib/settings";

const ENV = ["LLM_BASE_URL", "LLM_API_KEY", "IMAGE_BASE_URL", "IMAGE_PROVIDER"] as const;
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function ok() {
  return new Response(
    JSON.stringify({ data: [{ b64_json: PNG.toString("base64"), anve: { mime: "image/png" } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("ANVE image provider (IMAGE_PROVIDER=anve)", () => {
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

  it("posts to the gateway's /images/generations with the key and the deck", async () => {
    process.env.LLM_BASE_URL = "http://127.0.0.1:8100/v1/";
    process.env.LLM_API_KEY = "anve_sk_test";
    fetchMock.mockResolvedValue(ok());
    const out = await generateAnveImage("a lighthouse", "band", "doc-1");
    expect(out.ext).toBe("png");
    expect(out.bytes.equals(PNG)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8100/v1/images/generations");
    expect(init.headers.Authorization).toBe("Bearer anve_sk_test");
    expect(init.headers["X-Vellum-Document"]).toBe("doc-1");
    expect(JSON.parse(init.body)).toEqual({
      prompt: "a lighthouse",
      n: 1,
      size: "21:9",
      response_format: "b64_json",
    });
  });

  it("is dispatched by generateImage and passes the document through", async () => {
    process.env.LLM_BASE_URL = "http://anve/v1";
    fetchMock.mockResolvedValue(ok());
    const settings = settingsSchema.parse({ images: { provider: "anve" } });
    await generateImage(settings, "a kite", "portrait", undefined, undefined, "doc-9");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://anve/v1/images/generations");
    expect(JSON.parse(init.body).size).toBe("2:3");
    expect(init.headers["X-Vellum-Document"]).toBe("doc-9");
  });

  it("says why ANVE refused, and fails without a gateway", async () => {
    await expect(generateAnveImage("x")).rejects.toThrow(/LLM_BASE_URL is not set/);
    process.env.LLM_BASE_URL = "http://anve/v1";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Blocked by the workspace's cloud policy" } }),
        { status: 451 },
      ),
    );
    await expect(generateAnveImage("x")).rejects.toThrow(/451: Blocked by the workspace/);
  });

  it("IMAGE_PROVIDER wins over the saved setting, and only a known value", () => {
    expect(envImageProvider()).toBeNull();
    process.env.IMAGE_PROVIDER = "ANVE";
    expect(envImageProvider()).toBe("anve");
    process.env.IMAGE_PROVIDER = "dall-e";
    expect(envImageProvider()).toBeNull();
  });
});
