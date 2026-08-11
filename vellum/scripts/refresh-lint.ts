/** Recompute the lint portion of a document's QA report: npx tsx scripts/refresh-lint.ts <docId> */
import { refreshLintReport } from "@/lib/qa/run";

const id = process.argv[2];
if (!id) {
  console.error("usage: npx tsx scripts/refresh-lint.ts <documentId>");
  process.exit(1);
}
refreshLintReport(id).then(() => {
  console.log("lint refreshed for", id);
  process.exit(0);
});
