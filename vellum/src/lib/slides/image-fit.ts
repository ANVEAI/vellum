/**
 * How a slide's root image sits in its frame.
 *
 * These ride along on `slide.rootImage` (additive — the parser never emits
 * them, and a regenerated image resets to the defaults). One definition is
 * shared by the browser renderer, the print route and the PPTX exporter so
 * the same crop appears in the editor, on screen, in PDF and in PowerPoint.
 */

export type ImageFit = "cover" | "contain";

export type ImageFocus =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const IMAGE_FOCUS_VALUES: ImageFocus[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

export interface RootImagePlacement {
  url?: string;
  query?: string;
  fit?: ImageFit;
  focus?: ImageFocus;
}

/** Fractions along each axis: 0 = start, 0.5 = centre, 1 = end. */
export function focusFractions(focus: ImageFocus | undefined): {
  x: number;
  y: number;
} {
  switch (focus) {
    case "top":
      return { x: 0.5, y: 0 };
    case "bottom":
      return { x: 0.5, y: 1 };
    case "left":
      return { x: 0, y: 0.5 };
    case "right":
      return { x: 1, y: 0.5 };
    case "top-left":
      return { x: 0, y: 0 };
    case "top-right":
      return { x: 1, y: 0 };
    case "bottom-left":
      return { x: 0, y: 1 };
    case "bottom-right":
      return { x: 1, y: 1 };
    default:
      return { x: 0.5, y: 0.5 };
  }
}

/** CSS `object-position` for the focus point. */
export function objectPosition(focus: ImageFocus | undefined): string {
  const { x, y } = focusFractions(focus);
  return `${x * 100}% ${y * 100}%`;
}

export function readPlacement(rootImage: unknown): {
  fit: ImageFit;
  focus: ImageFocus;
} {
  const root = (rootImage ?? {}) as RootImagePlacement;
  return {
    fit: root.fit === "contain" ? "contain" : "cover",
    focus: root.focus ?? "center",
  };
}

/**
 * Geometry for placing an image into a box, in the box's own units.
 *
 * `cover` returns the scaled-up image size plus the sub-rectangle of it that
 * stays visible — exactly what PowerPoint's `srcRect` needs. `contain` returns
 * the letterboxed size and its offset inside the box.
 */
export function fitImage(options: {
  naturalWidth: number;
  naturalHeight: number;
  boxWidth: number;
  boxHeight: number;
  fit: ImageFit;
  focus: ImageFocus;
}): {
  /** Size the whole image occupies once scaled. */
  drawWidth: number;
  drawHeight: number;
  /** Where the visible window sits within that scaled image. */
  offsetX: number;
  offsetY: number;
  /** Size of the visible window. */
  visibleWidth: number;
  visibleHeight: number;
} {
  const { naturalWidth, naturalHeight, boxWidth, boxHeight, fit, focus } = options;
  const imageRatio =
    naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : boxWidth / boxHeight;
  const boxRatio = boxWidth / boxHeight;
  const { x: fx, y: fy } = focusFractions(focus);

  if (fit === "contain") {
    const scaleToWidth = imageRatio > boxRatio;
    const drawWidth = scaleToWidth ? boxWidth : boxHeight * imageRatio;
    const drawHeight = scaleToWidth ? boxWidth / imageRatio : boxHeight;
    return {
      drawWidth,
      drawHeight,
      // Letterboxed: the whole image shows, centred in the leftover space.
      offsetX: (boxWidth - drawWidth) / 2,
      offsetY: (boxHeight - drawHeight) / 2,
      visibleWidth: drawWidth,
      visibleHeight: drawHeight,
    };
  }

  // cover: scale until both axes are filled, then slide the window to the
  // focal point along whichever axis overflows.
  const scaleToHeight = imageRatio > boxRatio;
  const drawWidth = scaleToHeight ? boxHeight * imageRatio : boxWidth;
  const drawHeight = scaleToHeight ? boxHeight : boxWidth / imageRatio;
  return {
    drawWidth,
    drawHeight,
    offsetX: (drawWidth - boxWidth) * fx,
    offsetY: (drawHeight - boxHeight) * fy,
    visibleWidth: boxWidth,
    visibleHeight: boxHeight,
  };
}
