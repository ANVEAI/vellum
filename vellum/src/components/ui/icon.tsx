import { ICON_PATHS, type IconName } from "./icon-data";

export type { IconName };

/**
 * Chrome icon. Inline SVG so it inherits `currentColor`, aligns to the text
 * baseline, and scales crisply — replacing the emoji the chrome used to use.
 * Decorative by default; pass `title` only when the icon is the sole label.
 *
 * `fill="currentColor"` on the root is Phosphor's own convention, and the
 * glyphs depend on it: their dots — the three of "more", a drag handle's six,
 * the point of "warning" and "info" — are circles with no fill of their own.
 * Without it they took SVG's initial fill, black, whatever the theme: the
 * Library card's "⋯" measured 1.29:1 against its dark card and only
 * surfaced, faintly, on hover. Stroked shapes say fill="none" themselves.
 */
export function Icon({
  name,
  size = 16,
  weight = 16,
  title,
  className,
}: {
  name: IconName;
  size?: number;
  /** Phosphor stroke width at the 256 viewBox (16 ≈ regular, 20 ≈ bold). */
  weight?: number;
  title?: string;
  className?: string;
}) {
  const body = ICON_PATHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      className={className}
      style={weight !== 16 ? { strokeWidth: weight } : undefined}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{
        __html: (title ? `<title>${title}</title>` : "") + body,
      }}
    />
  );
}
