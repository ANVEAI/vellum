/**
 * One-shot sweep for assets that were orphaned before deletion cleaned up
 * after itself. Same reference-counting logic the delete route runs.
 *
 *   npx tsx scripts/gc-orphans.ts                 # dry run, prints what it would remove
 *   npx tsx scripts/gc-orphans.ts --yes           # actually delete
 *   npx tsx scripts/gc-orphans.ts --yes --exports # also empty data/exports
 *   npx tsx scripts/gc-orphans.ts --min-age-min 0 # ignore the write-race guard
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { exportsDir, imagesDir } from "@/lib/storage/paths";
import { gcOrphanImages, gcOrphanThemes } from "@/lib/storage/gc";

const argv = process.argv.slice(2);
const apply = argv.includes("--yes");
const sweepExports = argv.includes("--exports");
const ageIndex = argv.indexOf("--min-age-min");
const minAgeMs =
  ageIndex > -1 ? Number(argv[ageIndex + 1]) * 60_000 : 10 * 60_000;

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Only generated deliverables — data/exports also holds reports and screenshots. */
const EXPORT_ARTIFACT_RE = /\.(pptx|pdf|docx)$/i;

function exportArtifacts(dir: string): { names: string[]; bytes: number } {
  const names: string[] = [];
  let bytes = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (!EXPORT_ARTIFACT_RE.test(entry)) continue;
      try {
        const s = statSync(path.join(dir, entry));
        if (!s.isFile()) continue;
        names.push(entry);
        bytes += s.size;
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // directory absent
  }
  return { names, bytes };
}

function imageCount(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of readdirSync(dir)) {
      try {
        const s = statSync(path.join(dir, entry));
        if (s.isFile()) {
          files += 1;
          bytes += s.size;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // directory absent
  }
  return { files, bytes };
}

async function main() {
  console.log(apply ? "MODE: deleting\n" : "MODE: dry run (pass --yes to delete)\n");

  const before = imageCount(imagesDir());
  console.log(`images: ${before.files} files, ${mb(before.bytes)}`);

  const { deleted, errors } = await gcOrphanImages({ minAgeMs, dryRun: !apply });
  let freed = 0;
  if (!apply) {
    for (const name of deleted) {
      try {
        freed += statSync(path.join(imagesDir(), name)).size;
      } catch {
        // already gone
      }
    }
  }
  console.log(
    `  unreferenced: ${deleted.length}${apply ? " deleted" : ` (${mb(freed)} would be freed)`}`,
  );
  for (const error of errors) console.log(`  ! ${error}`);

  const orphanThemes = await db.customTheme.count({
    where: { documents: { none: {} } },
  });
  console.log(`themes: ${orphanThemes} orphaned`);
  if (apply && orphanThemes > 0) {
    console.log(`  deleted: ${await gcOrphanThemes()}`);
  }

  const artifacts = exportArtifacts(exportsDir());
  console.log(
    `exports: ${artifacts.names.length} generated files (.pptx/.pdf/.docx), ${mb(artifacts.bytes)}`,
  );
  if (sweepExports) {
    if (apply) {
      for (const name of artifacts.names) {
        try {
          rmSync(path.join(exportsDir(), name));
        } catch {
          // skip
        }
      }
      console.log(`  removed ${artifacts.names.length} files (${mb(artifacts.bytes)})`);
    } else {
      console.log(`  would remove ${artifacts.names.length} files (${mb(artifacts.bytes)})`);
    }
  } else if (artifacts.names.length > 0) {
    console.log(
      "  stale server-side copies of downloads; nothing reads them. Pass --exports to clear.",
    );
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
