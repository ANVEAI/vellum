/** Smoke: extract a brand kit from a .pptx. npx tsx scripts/test-pptx-brand.ts <file> */
import { readFileSync } from "node:fs";
import { brandFromPptx } from "@/lib/brand/pptx-theme";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/test-pptx-brand.ts <file.pptx>");
  process.exit(1);
}
brandFromPptx(readFileSync(file))
  .then((brand) => {
    console.log("name:", brand.name);
    console.log("colors:", brand.colors.join(" "));
    console.log("fonts:", JSON.stringify(brand.fonts));
    process.exit(0);
  })
  .catch((error) => {
    console.error("FAILED:", error.message);
    process.exit(1);
  });
