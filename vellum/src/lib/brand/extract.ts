/**
 * Brand kit extraction: dominant palette from a logo image (sharp, fully
 * offline) and a best-effort scrape of a company URL (colors from inline
 * CSS + theme-color meta, logo from og:image/apple-touch-icon/favicon).
 * URL mode degrades gracefully when offline — logo upload always works.
 */
import sharp from "sharp";

export interface BrandExtract {
  /** Ordered by prominence; [0] is the accent candidate. */
  colors: string[];
  /** Raw bytes of the discovered logo (URL mode only). */
  logoBytes?: Buffer;
  logoExt?: "png" | "jpeg";
  name?: string;
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Dominant colors from image bytes: 32-step quantization, skips near-white,
 *  near-black, near-gray, and transparent pixels. */
export async function paletteFromImage(buffer: Buffer): Promise<string[]> {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3] ?? 255;
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 242 && min > 232) continue; // near-white
    if (max < 28) continue; // near-black
    if (max - min < 22) continue; // near-gray
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((b) => toHex(b.r / b.count, b.g / b.count, b.b / b.count));
}

const CSS_COLOR_RE = /#[0-9a-fA-F]{6}\b/g;
const SKIP_COLORS = new Set(["#ffffff", "#000000", "#fff000"]);

/** Best-effort brand scrape from a public URL. */
export async function brandFromUrl(url: string): Promise<BrandExtract> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  const res = await fetch(target, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Mozilla/5.0 (vellum brand kit)" },
  });
  if (!res.ok) throw new Error(`Could not fetch ${target} (HTTP ${res.status})`);
  const html = (await res.text()).slice(0, 500_000);

  const name =
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ??
    /<title[^>]*>([^<]{1,80})/i.exec(html)?.[1]?.trim();

  // Colors: theme-color meta first, then hex frequency in the document.
  const colors: string[] = [];
  const themeColor = /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{6})/i.exec(html)?.[1];
  if (themeColor) colors.push(themeColor.toLowerCase());
  const counts = new Map<string, number>();
  for (const match of html.match(CSS_COLOR_RE) ?? []) {
    const c = match.toLowerCase();
    if (SKIP_COLORS.has(c)) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (!colors.includes(c)) colors.push(c);
    if (colors.length >= 6) break;
  }

  // Logo: og:image → apple-touch-icon → icon link.
  const logoUrl =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ??
    /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)/i.exec(html)?.[1] ??
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)/i.exec(html)?.[1];

  let logoBytes: Buffer | undefined;
  let logoExt: "png" | "jpeg" | undefined;
  if (logoUrl) {
    try {
      const absolute = new URL(logoUrl, target).toString();
      const img = await fetch(absolute, { signal: AbortSignal.timeout(15_000) });
      if (img.ok) {
        const type = img.headers.get("content-type") ?? "";
        if (type.includes("png") || type.includes("jpeg") || type.includes("jpg")) {
          logoBytes = Buffer.from(await img.arrayBuffer());
          logoExt = type.includes("png") ? "png" : "jpeg";
          // Logo pixels beat CSS-frequency guesses — merge them to the front.
          try {
            const logoColors = await paletteFromImage(logoBytes);
            for (let i = logoColors.length - 1; i >= 0; i--) {
              const c = logoColors[i].toLowerCase();
              const at = colors.indexOf(c);
              if (at !== -1) colors.splice(at, 1);
              colors.unshift(c);
            }
          } catch {
            // Non-fatal — keep CSS-derived colors.
          }
        }
      }
    } catch {
      // Offline or blocked — colors from HTML still stand.
    }
  }

  if (colors.length === 0) {
    throw new Error("No brand colors found on that page — try uploading a logo instead.");
  }
  return { colors: colors.slice(0, 6), logoBytes, logoExt, name };
}
