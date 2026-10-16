import { describe, expect, it } from "vitest";
import { SlideParser, type PlateSlide } from "@/lib/generation/parser/slide-parser";

function parse(xml: string): PlateSlide[] {
  const p = new SlideParser({ mode: "deck" });
  p.reset();
  p.parseChunk(xml);
  p.finalize();
  p.clearAllGeneratingMarks();
  return p.getAllSlides();
}

function text(n: unknown): string {
  if (!n || typeof n !== "object") return "";
  const o = n as { text?: string; children?: unknown[] };
  if (typeof o.text === "string") return o.text;
  return (o.children ?? []).map(text).join("");
}

function hasNested(nodes: unknown[], type: string): boolean {
  return nodes.some((n) => {
    const o = n as { type?: string; children?: unknown[] };
    return (o.children ?? []).some(
      (c) => (c as { type?: string }).type === type || hasNested([c], type),
    );
  });
}

/**
 * Regression, from a real deck: the model wrote an HTML line break with no
 * closing slash. The parser opened <br> as a container, swallowed the rest of
 * the paragraph and the slide's root image, then stopped parsing the paragraph
 * when it could not find </br>. The second line was lost and the image ended
 * up inside the paragraph, which measured twelve inches tall.
 */
describe("void tags", () => {
  const thankYou = `<PRESENTATION><SECTION layout="background" role="closing">
<TITLE alignment="left">Thank you!</TITLE>
<H1>Questions? Let's talk.</H1>
<P align="left">Harsh Tiwari<br>Founding Member · Lead Project & AI Engineer, AnveVoice</P>
<IMG query="sound waves rising over a lecture hall" />
</SECTION></PRESENTATION>`;

  it("keeps both lines of a paragraph split by <br>", () => {
    const [slide] = parse(thankYou);
    const p = slide.content.find((n) => (n as { type?: string }).type === "p");
    expect(text(p)).toContain("Harsh Tiwari");
    expect(text(p)).toContain("Founding Member");
  });

  it("keeps the root image out of the paragraph", () => {
    const [slide] = parse(thankYou);
    expect(hasNested(slide.content, "img")).toBe(false);
    expect((slide.rootImage as { query?: string } | undefined)?.query).toContain("sound waves");
  });

  it("treats <br/> and <br /> the same as <br>", () => {
    for (const br of ["<br>", "<br/>", "<br />", "<BR>"]) {
      const [slide] = parse(
        `<PRESENTATION><SECTION><H1>One${br}Two</H1><P>Body.</P></SECTION></PRESENTATION>`,
      );
      expect(text(slide.content[0]).replace(/\s+/g, " ")).toBe("One Two");
      expect(slide.content.length).toBe(2);
    }
  });

  it("does not let an image without its slash adopt the rest of the slide", () => {
    const [slide] = parse(
      `<PRESENTATION><SECTION><H1>Heading</H1><IMG query="a harbour at dawn"><P>After the image.</P></SECTION></PRESENTATION>`,
    );
    expect(slide.content.some((n) => text(n).includes("After the image."))).toBe(true);
  });
});
