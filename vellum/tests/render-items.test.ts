/**
 * What the renderer draws for a group's items.
 *
 * A stored deck has bullets with no text — parsed before text written straight
 * into a bullet was kept — and each still drew its dot: five markers with
 * nothing beside them. An item with no content is not drawn, and a group
 * with none is not drawn at all.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Node } from "@/components/slides/render/renderer";
import { columnLanes, contentItems, hasContent } from "@/lib/slides/walk";
import type { TElement } from "@/lib/slides/plate-shim";

const p = (text: string): TElement => ({ type: "p", children: [{ text }] });
const empty = (icon: string): TElement => ({ type: "bullet", icon, children: [] });
const render = (node: TElement) => renderToStaticMarkup(React.createElement(Node, { node }));

describe("group items", () => {
  it("draws only the bullets that have text", () => {
    const html = render({
      type: "bullets",
      children: [empty("pause"), { type: "bullet", children: [p("Call back on a number you know")] }, empty("key")],
    });
    expect(html.match(/class="v-bullet"/g)).toHaveLength(1);
    expect(html).toContain("Call back on a number you know");
  });

  it("draws nothing for a group whose items are all empty", () => {
    expect(render({ type: "bullets", children: [empty("pause"), empty("key")] })).toBe("");
    expect(render({ type: "boxes", children: [{ type: "box", children: [p("  ")] }] })).toBe("");
  });

  it("draws nothing for an empty callout, and keeps an empty paragraph", () => {
    expect(render({ type: "callout", children: [p("")] })).toBe("");
    // "Add slide" gives the user an empty paragraph to type into.
    expect(render(p(""))).toContain("v-p");
  });

  it("counts a stat carried only by its attribute as content", () => {
    const stat: TElement = { type: "stats-item", stat: "₹10,372 Cr", children: [{ text: "" }] };
    expect(hasContent(stat)).toBe(true);
    expect(contentItems({ type: "stats", children: [stat] })).toHaveLength(1);
  });

  it("drops a lane whose only child is itself empty", () => {
    const lanes = columnLanes({
      type: "column_group",
      children: [
        { type: "column", children: [{ type: "bullets", children: [empty("pause")] }] },
        { type: "column", children: [p("The lane with words")] },
      ],
    });
    expect(lanes).toHaveLength(1);
  });

  it("does not treat an icon on its own as content", () => {
    expect(hasContent({ type: "bullet", children: [{ type: "icon", query: "key", children: [{ text: "" }] }] })).toBe(false);
  });
});
