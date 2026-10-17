/**
 * Element structure under the markup the model actually writes.
 *
 * Each case is a shape found in a generated deck. Before these fixes the
 * parser found an element's end with a plain `indexOf("</TAG>")`, so anything
 * nested inside an element of the same name made its parent re-read content —
 * duplicated items and phantom lanes — and a misspelt end tag let one element
 * swallow the rest of the slide. Text written straight into a bullet, lane or
 * card was dropped, leaving empty markers.
 */
import { describe, expect, it } from "vitest";
import { SlideParser, type PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";

function parse(section: string): PlateSlide {
  const parser = new SlideParser({ mode: "deck" });
  parser.parseChunk(`<PRESENTATION>${section}</PRESENTATION>`);
  parser.finalize();
  parser.clearAllGeneratingMarks();
  return parser.getAllSlides()[0]!;
}

function isEl(n: Descendant): n is TElement {
  return typeof (n as TElement).type === "string";
}

function find(nodes: Descendant[], type: string): TElement | undefined {
  for (const n of nodes) {
    if (!isEl(n)) continue;
    if (n.type === type) return n;
    const inner = find(n.children ?? [], type);
    if (inner) return inner;
  }
  return undefined;
}

function texts(nodes: Descendant[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (isEl(n)) out.push(...texts(n.children ?? []));
    else if (n.text.trim()) out.push(n.text.trim());
  }
  return out;
}

function textOf(node: Descendant): string {
  return isEl(node) ? (node.children ?? []).map(textOf).join("") : node.text;
}

const NESTED_LIST = `<SECTION layout="vertical"><H1>Stay safe on calls</H1><COLUMNS><DIV><H3>Incoming call</H3><P>A familiar voice asks for money.</P></DIV><DIV><H3>How to stay safe</H3><BULLETS><DIV><P>Pause first</P></DIV><DIV><P>Call back yourself</P></DIV><DIV><P>Agree a code word</P></DIV></BULLETS></DIV></COLUMNS></SECTION>`;

describe("nested elements of the same name", () => {
  it("keeps a bullet list inside a lane as one lane, each item once", () => {
    const slide = parse(NESTED_LIST);
    const group = find(slide.content, "column_group")!;
    expect(group.children).toHaveLength(2);
    const all = texts(slide.content);
    for (const item of ["Pause first", "Call back yourself", "Agree a code word"]) {
      expect(all.filter((t) => t === item)).toHaveLength(1);
    }
  });

  it("keeps nested COLUMNS inside their lane", () => {
    const slide = parse(
      `<SECTION><H1>Industries</H1><COLUMNS><DIV><P>Left lane</P></DIV><DIV><COLUMNS><DIV><H3>Banking</H3></DIV><DIV><H3>Audit</H3></DIV><DIV><H3>Retail</H3></DIV></COLUMNS></DIV></COLUMNS></SECTION>`,
    );
    const outer = find(slide.content, "column_group")!;
    expect(outer.children).toHaveLength(2);
    const all = texts(slide.content);
    expect(all.filter((t) => t === "Audit")).toHaveLength(1);
    expect(all.filter((t) => t === "Retail")).toHaveLength(1);
  });

  it("does not duplicate anything at any point while streaming", () => {
    const full = `<PRESENTATION>${NESTED_LIST}</PRESENTATION>`;
    const parser = new SlideParser({ mode: "deck" });
    for (let end = 1; end <= full.length; end++) {
      parser.reset();
      parser.parseChunk(full.slice(0, end));
      parser.finalize();
      const all = parser.getAllSlides().flatMap((s) => texts(s.content));
      expect(new Set(all).size, `prefix of ${end} chars`).toBe(all.length);
    }
  });
});

describe("malformed end tags", () => {
  it("closes an element whose end tag is misspelt at its parent's end", () => {
    const slide = parse(
      `<SECTION><H1>Voice scams</H1><COLUMNS><DIV><CALLOUT><P>Seconds of audio can clone a voice.</P></CALOUT></DIV><DIV><H3>How to stay safe</H3><P>Call back on a known number.</P></DIV></COLUMNS></SECTION>`,
    );
    const group = find(slide.content, "column_group")!;
    expect(group.children).toHaveLength(2);
    const callout = find(slide.content, "callout")!;
    expect(texts([callout])).toEqual(["Seconds of audio can clone a voice."]);
    expect(texts(slide.content).filter((t) => t === "How to stay safe")).toHaveLength(1);
  });

  it("matches end tags regardless of case", () => {
    const slide = parse(
      `<SECTION><H1>Two lines</H1><COLUMNS><DIV><p>First line</P><P>Second line</P></DIV></COLUMNS></SECTION>`,
    );
    expect(texts(slide.content)).toEqual(["Two lines", "First line", "Second line"]);
  });

  it("ignores an end tag that closes nothing", () => {
    const slide = parse(`<SECTION><H1>Heading</H1></DIV><P>Body text</P></SECTION>`);
    expect(texts(slide.content)).toEqual(["Heading", "Body text"]);
  });

  /**
   * Regression: `<TTITLE>…</TITLE>` left the misspelt element open, and it
   * adopted the rest of the slide — steps, picture and speaker notes, which
   * then showed on the slide as text.
   */
  it("closes a misspelt heading at the end tag it meant, as that heading", () => {
    const slide = parse(
      `<SECTION layout="right"><TTITLE>The Research Frontier</TITLE><P>AI drives discovery.</P><STEPS><DIV><H3>Discover</H3><P>Fold proteins.</P></DIV><DIV><H3>Review</H3><P>Read papers.</P></DIV></STEPS><IMG query="a scientist at a microscope" /><NOTES>Spoken only.</NOTES></SECTION>`,
    );
    expect(slide.content.map((n) => (n as TElement).type)).toEqual(["presentation-title", "p", "steps"]);
    expect(texts(slide.content)).not.toContain("Spoken only.");
    expect(slide.speakerNote).toBe("Spoken only.");
    expect((slide.rootImage as { query?: string }).query).toBe("a scientist at a microscope");
  });

  it("closes an item whose end tag has one letter wrong", () => {
    const slide = parse(
      `<SECTION><H1>Skills</H1><BULLETS><DIV><H3>Scarce</H3><P>User needs.</P></DEV><DIV><H3>Strategic</H3><P>What to build.</P></DIV></BULLETS></SECTION>`,
    );
    expect(find(slide.content, "bullets")!.children.map(textOf)).toEqual([
      "ScarceUser needs.",
      "StrategicWhat to build.",
    ]);
  });

  it("does not let a stray singular end tag close its plural group", () => {
    const slide = parse(
      `<SECTION><H1>Three steps</H1><STEPS><DIV><H3>One</H3></DIV></STEP><DIV><H3>Two</H3></DIV><DIV><H3>Three</H3></DIV></STEPS></SECTION>`,
    );
    expect(find(slide.content, "steps")!.children.map(textOf)).toEqual(["One", "Two", "Three"]);
  });

  it("reads a '<' that starts no tag as text", () => {
    const slide = parse(`<SECTION><H1>Odds</H1><P>2 < 3 holds</P></SECTION>`);
    expect(textOf(slide.content[1]!)).toBe("2 < 3 holds");
  });
});

describe("text written straight into a container", () => {
  it("is each bullet's text, with its formatting", () => {
    const slide = parse(
      `<SECTION><H1>Stay safe</H1><BULLETS><DIV icon="pause">Pause before you pay</DIV><DIV icon="key"><B>Agree</B> a family code word</DIV></BULLETS></SECTION>`,
    );
    const bullets = find(slide.content, "bullets")!;
    expect(bullets.children).toHaveLength(2);
    const [first, second] = bullets.children as TElement[];
    expect(first.icon).toBe("pause");
    expect(textOf(first)).toBe("Pause before you pay");
    expect(textOf(second)).toBe("Agree a family code word");
    const leaves = (second.children[0] as TElement).children as Array<{ bold?: boolean }>;
    expect(leaves[0]?.bold).toBe(true);
  });

  it("is a lane's paragraph", () => {
    const slide = parse(
      `<SECTION><H1>Two sides</H1><COLUMNS><DIV>Left side text</DIV><DIV>Right side text</DIV></COLUMNS></SECTION>`,
    );
    const group = find(slide.content, "column_group")!;
    expect(group.children.map(textOf)).toEqual(["Left side text", "Right side text"]);
  });

  it("is kept beside the blocks it sits between", () => {
    const slide = parse(
      `<SECTION><H1>Mixed</H1><BOXES><DIV><H3>Title</H3>Some <B>bold</B> words</DIV></BOXES></SECTION>`,
    );
    const box = (find(slide.content, "boxes")!.children as TElement[])[0]!;
    expect((box.children as TElement[]).map((c) => c.type)).toEqual(["h3", "p"]);
    expect(textOf(box.children[1]!)).toBe("Some bold words");
  });

  it("keeps the words of spans and links inside a paragraph", () => {
    const slide = parse(
      `<SECTION><H1>Links</H1><P>Visit <A href="https://example.com">our site</A> today</P></SECTION>`,
    );
    expect(textOf(slide.content[1]!)).toBe("Visit our site today");
  });
});

describe("items written as an attribute", () => {
  it("become the group's items when it has none", () => {
    const slide = parse(
      `<SECTION><H1>Layers of AI</H1><CIRCULAR-GRID centerText="Gen AI" items="Deep Learning,Machine Learning,Artificial Intelligence" /></SECTION>`,
    );
    const grid = find(slide.content, "circular-grid")!;
    expect(grid.children.map(textOf)).toEqual([
      "Deep Learning",
      "Machine Learning",
      "Artificial Intelligence",
    ]);
    expect(grid.items).toBeUndefined();
  });

  it("are ignored when the group already has items", () => {
    const slide = parse(
      `<SECTION><H1>Loop</H1><CYCLE items="X,Y"><DIV><P>Plan</P></DIV><DIV><P>Act</P></DIV></CYCLE></SECTION>`,
    );
    expect(find(slide.content, "cycle")!.children.map(textOf)).toEqual(["Plan", "Act"]);
  });

  it("leaves a hub with no label empty rather than printing a placeholder", () => {
    const slide = parse(
      `<SECTION><H1>Loop</H1><CIRCULAR-GRID><DIV><P>One</P></DIV><DIV><P>Two</P></DIV></CIRCULAR-GRID></SECTION>`,
    );
    expect(find(slide.content, "circular-grid")!.centerText).toBe("");
  });
});

describe("markup the model lays out like a web page", () => {
  const types = (slide: PlateSlide) => slide.content.map((n) => (n as TElement).type);

  it("keeps a row of styled cards as a card group, with their icons", () => {
    // An agenda that kept only its heading: every card was an unknown tag.
    const slide = parse(
      `<SECTION><TITLE>What we'll cover</TITLE><DIV style="display:flex"><DIV style="width:16%"><DIV icon="lightbulb" style="width:44px"></DIV><P>01</P><P>AI Basics</P></DIV><DIV style="width:16%"><DIV icon="sparkles"></DIV><P>02</P><P>Trends</P></DIV><DIV><DIV icon="microphone"></DIV><P>03</P><P>Voice AI</P></DIV></DIV></SECTION>`,
    );
    const boxes = find(slide.content, "boxes")!;
    expect(boxes.children.map((b) => (b as TElement).icon)).toEqual(["lightbulb", "sparkles", "microphone"]);
    expect(boxes.children.map(textOf)).toEqual(["01AI Basics", "02Trends", "03Voice AI"]);
  });

  it("reads a wrapper DIV's blocks as the slide's, however deep", () => {
    const slide = parse(
      `<SECTION><H1>India's AI moment</H1><DIV><DIV><P>₹10,372 Cr IndiaAI Mission outlay</P></DIV></DIV></SECTION>`,
    );
    expect(texts(slide.content)).toEqual(["India's AI moment", "₹10,372 Cr IndiaAI Mission outlay"]);
  });

  it("gathers loose list items into one bullet list, at slide level or in a wrapper", () => {
    const slide = parse(
      `<SECTION><H1>Stay safe</H1><DIV icon="warning"><H3>How to stay safe</H3><LI>Pause first</LI><LI>Call back yourself</LI></DIV><LI>Dial 1930</LI></SECTION>`,
    );
    expect(types(slide)).toEqual(["h1", "h3", "bullets", "bullets"]);
    expect(texts(slide.content).slice(1)).toEqual(["How to stay safe", "Pause first", "Call back yourself", "Dial 1930"]);
  });

  it("reads UL and OL as lists", () => {
    const slide = parse(`<SECTION><H1>Steps</H1><OL><LI>Listen</LI><LI>Think</LI><LI>Speak</LI></OL></SECTION>`);
    const list = find(slide.content, "bullets")!;
    expect(list.bulletType).toBe("numbered");
    expect(list.children.map(textOf)).toEqual(["Listen", "Think", "Speak"]);
  });

  it("keeps the content of an element it does not know, and drops style sheets", () => {
    const slide = parse(
      `<SECTION><H1>Voice scams</H1><BETA><I>"Beta, I'm in trouble. Send money now."</I></BETA><STYLE>.card { color: red }</STYLE></SECTION>`,
    );
    expect(texts(slide.content)).toEqual(["Voice scams", `"Beta, I'm in trouble. Send money now."`]);
  });

  it("keeps an icon list's labels and an icon's label", () => {
    const slide = parse(
      `<SECTION><H1>Agenda</H1><ICONS><DIV icon="lightbulb">AI basics</DIV><DIV icon="sparkles">Trends</DIV></ICONS><COLUMNS><DIV><ICON variant="icon"><DIV icon="shield">Fraud alerts</DIV></ICON><P>Banks flag payments</P></DIV><DIV><P>Other lane</P></DIV></COLUMNS></SECTION>`,
    );
    expect(find(slide.content, "icons")!.children.map(textOf)).toEqual(["AI basics", "Trends"]);
    expect(texts(slide.content)).toContain("Fraud alerts");
  });

  it("keeps LI items in a group, and moves other blocks out beside it", () => {
    const slide = parse(
      `<SECTION><H1>Rates</H1><BULLETS><H3>Why it matters</H3><LI>First</LI><LI>Second</LI></BULLETS><STATS><DIV stat="4.25%"><P>Fed funds</P></DIV><DIV stat="-0.5%"><P>ECB</P></DIV><CHART charttype="bar">\n| label | v |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n</CHART></STATS></SECTION>`,
    );
    expect(types(slide)).toEqual(["h1", "h3", "bullets", "stats", "chart-bar"]);
    expect(find(slide.content, "bullets")!.children.map(textOf)).toEqual(["First", "Second"]);
  });
});
