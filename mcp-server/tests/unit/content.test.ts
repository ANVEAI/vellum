import { describe, expect, it } from "vitest";
import { ok, withContent, isContentEnvelope, type ContentBlock } from "../../src/mcp/tool.js";

describe("tool result content blocks", () => {
  it("puts content blocks before the JSON text block", () => {
    const link: ContentBlock = {
      type: "resource_link",
      uri: "http://127.0.0.1:8765/exports/abc-pdf-1234abcd.pdf",
      name: "Deck.pdf",
      mimeType: "application/pdf",
    };
    const result = ok(withContent({ documentId: "abc", bytes: 17_715_000 }, [link]));

    expect(result.content[0]).toEqual(link);
    // The model still gets something to describe.
    expect(result.content.at(-1)?.type).toBe("text");
    expect(result.structuredContent).toMatchObject({ documentId: "abc" });
  });

  it("keeps the JSON summary in a text block even when a blob is embedded", () => {
    const blob: ContentBlock = {
      type: "resource",
      resource: { uri: "file:///x/a.pdf", mimeType: "application/pdf", blob: "AAAA" },
    };
    const result = ok(withContent({ documentId: "abc", slideCount: 12 }, [blob]));

    const text = result.content.find((c) => c.type === "text");
    expect(text).toBeDefined();
    expect(JSON.parse((text as { text: string }).text)).toMatchObject({ slideCount: 12 });
  });

  it("does not count content blocks against the structuredContent size limit", () => {
    // A 6 MB base64 blob would blow the 64 KB result guard if blocks were
    // measured. They are deliberately exempt: a blob is not competing for the
    // model's context the way a JSON body is.
    const huge = "A".repeat(6_000_000);
    const result = ok(
      withContent({ documentId: "abc" }, [
        { type: "resource", resource: { uri: "file:///x/a.pptx", blob: huge } },
      ]),
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.type).toBe("resource");
  });

  it("still enforces the size limit on the JSON payload itself", () => {
    const result = ok({ blob: "x".repeat(70_000) });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain("result_too_large");
  });

  it("recognises an envelope and passes plain payloads through untouched", () => {
    expect(isContentEnvelope(withContent({ a: 1 }, []))).toBe(true);
    expect(isContentEnvelope({ a: 1 })).toBe(false);

    const plain = ok({ a: 1 });
    expect(plain.content).toHaveLength(1);
    expect(plain.content[0]?.type).toBe("text");
  });

  it("keeps a download URL out of everything the model can read", () => {
    // The host intercepts the resource_link and re-serves the file from its own
    // origin. A URL anywhere the model can see it gets pasted into prose as a
    // download link — but it is a loopback address on the server, dead in any
    // browser, and prose is invisible to the interception path.
    const uri = "http://127.0.0.1:8765/exports/abc-pptx-6b9fdee0.pptx";
    const result = ok(
      withContent({ documentId: "abc", slideCount: 15, bytes: 26_173_340, delivery: "link" }, [
        { type: "resource_link", uri, name: "Deck.pptx", mimeType: "application/x" },
      ]),
    );

    const link = result.content.find((c) => c.type === "resource_link");
    expect(link).toMatchObject({ uri });

    // ...and nowhere else.
    expect(JSON.stringify(result.structuredContent)).not.toContain("http");
    const text = result.content.find((c) => c.type === "text") as { text: string };
    expect(text.text).not.toContain("http");
  });

  it("uses the supplied summary as the text block when the JSON is large", () => {
    const payload = { documentId: "abc", filler: "y".repeat(2_000) };
    const result = ok(withContent(payload, [], "Exported \"Deck.pdf\" — 12 slides, 17.7 MB PDF."));
    const text = result.content.find((c) => c.type === "text") as { text: string };
    expect(text.text).toBe('Exported "Deck.pdf" — 12 slides, 17.7 MB PDF.');
  });
});
