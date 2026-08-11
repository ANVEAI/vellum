import { describe, expect, it } from "vitest";
import {
  fitImage,
  focusFractions,
  objectPosition,
  readPlacement,
} from "@/lib/slides/image-fit";

const cover = (
  naturalWidth: number,
  naturalHeight: number,
  boxWidth: number,
  boxHeight: number,
  focus: Parameters<typeof fitImage>[0]["focus"] = "center",
) =>
  fitImage({ naturalWidth, naturalHeight, boxWidth, boxHeight, fit: "cover", focus });

describe("image placement", () => {
  it("defaults to cover + centre", () => {
    expect(readPlacement(undefined)).toEqual({ fit: "cover", focus: "center" });
    expect(readPlacement({ url: "x" })).toEqual({ fit: "cover", focus: "center" });
    expect(readPlacement({ fit: "contain", focus: "top" })).toEqual({
      fit: "contain",
      focus: "top",
    });
  });

  it("maps focus points to CSS object-position", () => {
    expect(objectPosition("center")).toBe("50% 50%");
    expect(objectPosition("top-left")).toBe("0% 0%");
    expect(objectPosition("bottom-right")).toBe("100% 100%");
    expect(focusFractions("right")).toEqual({ x: 1, y: 0.5 });
  });

  it("never distorts: the drawn box always keeps the source aspect", () => {
    const cases: Array<[number, number, number, number]> = [
      [1920, 1088, 13.333, 7.5], // hero into a full slide
      [832, 1216, 5.333, 7.5], // portrait into a rail
      [1536, 384, 13.333, 3.15], // band into a vertical strip
      [1280, 720, 5.333, 7.5], // 16:9 into a portrait rail (worst case)
      [1000, 1000, 13.333, 3.0], // square into a wide band
    ];
    for (const [nw, nh, bw, bh] of cases) {
      for (const fit of ["cover", "contain"] as const) {
        const geo = fitImage({
          naturalWidth: nw,
          naturalHeight: nh,
          boxWidth: bw,
          boxHeight: bh,
          fit,
          focus: "center",
        });
        expect(geo.drawWidth / geo.drawHeight).toBeCloseTo(nw / nh, 4);
      }
    }
  });

  it("cover fills the box exactly and crops only the overflow", () => {
    // 16:9 source into a portrait rail: width overflows, height matches.
    const geo = cover(1280, 720, 5.333, 7.5);
    expect(geo.visibleWidth).toBeCloseTo(5.333, 3);
    expect(geo.visibleHeight).toBeCloseTo(7.5, 3);
    expect(geo.drawHeight).toBeCloseTo(7.5, 3);
    expect(geo.drawWidth).toBeGreaterThan(5.333);
    // Centred: equal amounts trimmed from each side.
    expect(geo.offsetX).toBeCloseTo((geo.drawWidth - 5.333) / 2, 4);
    expect(geo.offsetY).toBeCloseTo(0, 6);
  });

  it("moves the crop window with the focal point", () => {
    const left = cover(1280, 720, 5.333, 7.5, "left");
    const centre = cover(1280, 720, 5.333, 7.5, "center");
    const right = cover(1280, 720, 5.333, 7.5, "right");
    expect(left.offsetX).toBe(0);
    expect(right.offsetX).toBeCloseTo(right.drawWidth - 5.333, 4);
    expect(centre.offsetX).toBeGreaterThan(left.offsetX);
    expect(centre.offsetX).toBeLessThan(right.offsetX);
    // The visible window never changes size, only position.
    for (const geo of [left, centre, right]) {
      expect(geo.visibleWidth).toBeCloseTo(5.333, 3);
    }
  });

  it("crops the other axis when the source is too wide", () => {
    // A 4:1 band into a 16:9 slide overflows horizontally.
    const top = cover(1536, 384, 13.333, 7.5, "top");
    expect(top.offsetY).toBe(0);
    const bottom = cover(1536, 384, 13.333, 7.5, "bottom");
    expect(bottom.offsetY).toBeCloseTo(bottom.drawHeight - 7.5, 4);
  });

  it("contain shows the whole image, letterboxed", () => {
    const geo = fitImage({
      naturalWidth: 1280,
      naturalHeight: 720,
      boxWidth: 5.333,
      boxHeight: 7.5,
      fit: "contain",
      focus: "center",
    });
    expect(geo.drawWidth).toBeLessThanOrEqual(5.333 + 1e-6);
    expect(geo.drawHeight).toBeLessThanOrEqual(7.5 + 1e-6);
    expect(geo.visibleWidth).toBeCloseTo(geo.drawWidth, 6);
    expect(geo.visibleHeight).toBeCloseTo(geo.drawHeight, 6);
    // Vertically centred inside the taller box.
    expect(geo.offsetY).toBeCloseTo((7.5 - geo.drawHeight) / 2, 4);
  });

  it("falls back to the box aspect when dimensions are unknown", () => {
    const geo = cover(0, 0, 10, 5);
    expect(geo.drawWidth).toBeCloseTo(10, 6);
    expect(geo.drawHeight).toBeCloseTo(5, 6);
    expect(geo.offsetX).toBeCloseTo(0, 6);
  });
});
