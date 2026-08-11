/**
 * Brand kit from a corporate .pptx: reads ppt/theme/theme1.xml for the
 * Office color scheme (dk1/lt1/dk2/lt2/accent1-6) and the major/minor
 * latin typefaces. Approach derived from allweonedev/presentation-ai's
 * pptx-theme-extractor (MIT) — see THIRD_PARTY_LICENSES.md; reimplemented
 * minimally on jszip (already a transitive dependency of pptxgenjs).
 */
import JSZip from "jszip";

export interface PptxBrand {
  colors: string[];
  fonts: { heading?: string; body?: string };
  name?: string;
}

/** Office's default scheme colors; ignored so we don't "extract" the stock theme. */
const OFFICE_DEFAULTS = new Set([
  "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47",
  "#000000", "#ffffff", "#44546a", "#e7e6e6",
]);

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]+)"`).exec(tag);
  return match ? match[1] : null;
}

/** `<a:accent1><a:srgbClr val="1F4E79"/></a:accent1>` → "#1f4e79". */
function colorFromSlot(xml: string, slot: string): string | null {
  const block = new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`).exec(xml);
  if (!block) return null;
  const srgb = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(block[1]);
  if (srgb) return `#${srgb[1].toLowerCase()}`;
  const sys = /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block[1]);
  return sys ? `#${sys[1].toLowerCase()}` : null;
}

export async function brandFromPptx(buffer: Buffer): Promise<PptxBrand> {
  const zip = await JSZip.loadAsync(buffer);
  const themeFile =
    zip.file("ppt/theme/theme1.xml") ??
    zip.file(/^ppt\/theme\/theme\d+\.xml$/)[0];
  if (!themeFile) {
    throw new Error("No theme found in that .pptx — is it a valid PowerPoint file?");
  }
  const xml = await themeFile.async("string");

  const accents = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
    .map((slot) => colorFromSlot(xml, slot))
    .filter((c): c is string => Boolean(c));
  const neutrals = ["dk2", "lt2", "dk1", "lt1"]
    .map((slot) => colorFromSlot(xml, slot))
    .filter((c): c is string => Boolean(c));

  // Brand-defining accents first; drop Office stock values so a default
  // template doesn't masquerade as a brand.
  const colors = [...new Set([...accents, ...neutrals])].filter(
    (c) => !OFFICE_DEFAULTS.has(c),
  );
  if (colors.length === 0) {
    throw new Error(
      "That deck uses the stock Office palette — no brand colors to extract.",
    );
  }

  const majorTag = /<a:majorFont>[\s\S]*?<a:latin[^>]*>/.exec(xml)?.[0] ?? "";
  const minorTag = /<a:minorFont>[\s\S]*?<a:latin[^>]*>/.exec(xml)?.[0] ?? "";
  const heading = attr(majorTag, "typeface") ?? undefined;
  const body = attr(minorTag, "typeface") ?? undefined;
  const name = /<a:theme[^>]+name="([^"]+)"/.exec(xml)?.[1];

  return {
    colors: colors.slice(0, 6),
    fonts: {
      heading: heading && !heading.startsWith("+") ? heading : undefined,
      body: body && !body.startsWith("+") ? body : undefined,
    },
    name,
  };
}
