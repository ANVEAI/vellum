/**
 * PPTX image-fidelity check: reads the generated OOXML and asserts each
 * picture carries a real crop rather than a stretch.
 *
 * The exporter used to hand pptxgenjs the placement box as BOTH the image
 * size and the sizing box, which makes its `crop` helper emit
 * `<a:srcRect l="0" r="0" t="0" b="0"/>` — a full-frame stretch. On a
 * vertical band that was a 1.76x horizontal distortion.
 *
 *   npx tsx scripts/export-parity.ts <deckId>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// jszip ships with pptxgenjs, so this adds no dependency.
import JSZip from "jszip";

const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3210";
/** Set when the app runs under a URL prefix; empty otherwise. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BASE = `${ORIGIN}${BASE_PATH}`;
const PASSWORD = process.env.APP_PASSWORD ?? "EPqTWxQ0zxbt";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

interface Pic {
  slide: string;
  srcRect: { l: number; r: number; t: number; b: number } | null;
  extCx: number;
  extCy: number;
  rId: string | null;
}

function parsePictures(xml: string, slide: string): Pic[] {
  const pics: Pic[] = [];
  // Each <p:pic> holds a blipFill (with optional srcRect) and an a:ext.
  for (const block of xml.split("<p:pic>").slice(1)) {
    const src = block.match(
      /<a:srcRect(?:\s+l="(-?\d+)")?(?:\s+r="(-?\d+)")?(?:\s+t="(-?\d+)")?(?:\s+b="(-?\d+)")?\s*\/>/,
    );
    const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const blip = block.match(/<a:blip r:embed="(rId\d+)"/);
    pics.push({
      slide,
      srcRect: src
        ? {
            l: Number(src[1] ?? 0),
            r: Number(src[2] ?? 0),
            t: Number(src[3] ?? 0),
            b: Number(src[4] ?? 0),
          }
        : null,
      extCx: ext ? Number(ext[1]) : 0,
      extCy: ext ? Number(ext[2]) : 0,
      rId: blip ? blip[1] : null,
    });
  }
  return pics;
}

/** Intrinsic pixel size from a PNG or JPEG header. */
function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, skipping the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx scripts/export-parity.ts <deckId>");
    process.exit(1);
  }

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

  console.log("exporting pptx…");
  const res = await fetch(`${BASE}/api/export/pptx/${id}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(path.resolve("data/exports/ui"), { recursive: true });
  const file = path.resolve("data/exports/ui/parity.pptx");
  writeFileSync(file, buffer);
  console.log(`  ${(buffer.length / 1024 / 1024).toFixed(1)} MB\n`);

  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const slideNames = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const pics: Pic[] = [];
  // rId → media path, per slide, so each picture can be compared with the
  // actual bytes it embeds.
  const relsFor = new Map<string, Map<string, string>>();
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    pics.push(...parsePictures(xml, name));
    const relName = name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const map = new Map<string, string>();
    const relXml = await zip.files[relName]?.async("string");
    for (const m of (relXml ?? "").matchAll(
      /Id="(rId\d+)"[^>]*Target="([^"]+)"/g,
    )) {
      if (m[2].includes("media/")) {
        map.set(m[1], `ppt/media/${m[2].split("media/")[1]}`);
      }
    }
    relsFor.set(name, map);
  }
  const mediaCount = names.filter((n) => n.startsWith("ppt/media/")).length;

  check("deck contains slides", slideNames.length > 0, `${slideNames.length} slides`);
  check("deck embeds media", mediaCount > 0, `${mediaCount} files`);
  check("deck contains pictures", pics.length > 0, `${pics.length} <p:pic>`);

  const cropped = pics.filter(
    (p) => p.srcRect && (p.srcRect.l || p.srcRect.r || p.srcRect.t || p.srcRect.b),
  );
  const zeroRect = pics.filter(
    (p) => p.srcRect && !p.srcRect.l && !p.srcRect.r && !p.srcRect.t && !p.srcRect.b,
  );

  console.log(
    `\n  ${cropped.length} pictures carry a real crop, ${zeroRect.length} have an all-zero srcRect, ` +
      `${pics.length - cropped.length - zeroRect.length} have none\n`,
  );

  // The real parity test: for every picture, compare the aspect of the region
  // actually shown (source aspect narrowed by srcRect) against the aspect of
  // the box it is placed in. A mismatch means the image is being squashed.
  const distorted: string[] = [];
  let compared = 0;
  for (const pic of pics) {
    const media = pic.rId ? relsFor.get(pic.slide)?.get(pic.rId) : undefined;
    const entry = media ? zip.files[media] : undefined;
    if (!entry || !pic.extCx || !pic.extCy) continue;
    const size = imageSize(await entry.async("nodebuffer"));
    if (!size) continue;
    compared += 1;
    const r = pic.srcRect ?? { l: 0, r: 0, t: 0, b: 0 };
    const visibleW = size.w * (1 - (r.l + r.r) / 100_000);
    const visibleH = size.h * (1 - (r.t + r.b) / 100_000);
    if (visibleW <= 0 || visibleH <= 0) continue;
    const sourceAspect = visibleW / visibleH;
    const boxAspect = pic.extCx / pic.extCy;
    const skew = Math.abs(sourceAspect / boxAspect - 1);
    if (skew > 0.02) {
      distorted.push(
        `${pic.slide.replace("ppt/slides/", "")} ${(skew * 100).toFixed(0)}% off ` +
          `(src ${sourceAspect.toFixed(2)} vs box ${boxAspect.toFixed(2)})`,
      );
    }
  }
  check("every picture's visible region was measurable", compared === pics.length, `${compared}/${pics.length}`);
  check(
    "no picture is stretched — visible crop matches its box aspect",
    distorted.length === 0,
    distorted.slice(0, 4).join("; "),
  );

  // srcRect percentages are in 1/1000 of a percent; anything at or beyond
  // 100000 would crop the image out of existence.
  const insane = cropped.filter((p) => {
    const { l, r, t, b } = p.srcRect!;
    return l + r >= 100_000 || t + b >= 100_000 || l < 0 || r < 0 || t < 0 || b < 0;
  });
  check("no crop discards the entire image", insane.length === 0, `${insane.length} bad`);

  // Cover crops are symmetric only when centred; asymmetric ones prove the
  // focal point reached the file.
  const sized = pics.filter((p) => p.extCx > 0 && p.extCy > 0);
  check("every picture has a placement size", sized.length === pics.length);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
