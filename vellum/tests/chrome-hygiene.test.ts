/**
 * Guards the redesign's two hard rules for application chrome:
 *   1. no native browser dialogs — every confirmation goes through useConfirm
 *      or a Dialog, so it is styled, focus-trapped and Escape-dismissable;
 *   2. no emoji-as-icon — chrome icons come from the generated Phosphor set.
 *
 * Slide *content* is exempt: emoji there are authored by the model and are
 * legitimate output, not interface.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "src");

/** Rendered slide output — not chrome. */
const EXEMPT_DIRS = [
  path.join("src", "components", "slides"),
  path.join("src", "lib", "templates"),
  path.join("src", "lib", "generation"),
  path.join("src", "lib", "themes"),
  path.join("src", "app", "print"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function chromeFiles(): string[] {
  return walk(ROOT).filter(
    (file) => !EXEMPT_DIRS.some((dir) => file.includes(dir)),
  );
}

function strip(source: string): string {
  // Drop comments so documentation of the old behaviour is not a violation.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("chrome hygiene", () => {
  const files = chromeFiles();

  it("scans a meaningful number of chrome files", () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it("opens no native alert/confirm/prompt dialogs", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = strip(readFileSync(file, "utf8"));
      // window.alert(...) or a bare alert(...) call — not `.prompt` properties,
      // `promptPlaceholder`, or object keys like `prompt:`.
      const re = /(?<![.\w$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(\s*(.)/g;
      const usesHook = /useConfirm/.test(source);
      for (const match of source.matchAll(re)) {
        // useConfirm() returns a function also called `confirm`, but it takes
        // an options object — window.confirm only ever takes a string.
        if (match[1] === "confirm" && usesHook && match[2] === "{") continue;
        offenders.push(`${path.relative(ROOT, file)}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses no emoji as interface icons", () => {
    // Pictographs only. Arrows (U+2190–21FF) are deliberately allowed: they
    // are how shortcuts are written — ⇧⌘Z, ↑/↓ — not icons.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    const offenders: string[] = [];
    for (const file of files) {
      const lines = strip(readFileSync(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, i) => {
        const match = line.match(emoji);
        if (match) offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${match[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
