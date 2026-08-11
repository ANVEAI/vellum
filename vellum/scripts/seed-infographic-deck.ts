/**
 * Seeds a deck exercising every new Phase-4 visual (infographics, FLOW,
 * annotated charts) from a fixed XML fixture — no LLM involved, so the
 * render/export path can be verified deterministically.
 *
 *   npx tsx scripts/seed-infographic-deck.ts [themeName]
 */
import { db } from "@/lib/db";
import { SlideParser } from "@/lib/generation/parser/slide-parser";
import { planDeck } from "@/lib/design/planner";

const XML = `<PRESENTATION>
<SECTION layout="vertical" role="hero"><TITLE>Phase 4 visual suite</TITLE><P>Every new component, rendered from a fixture.</P></SECTION>
<SECTION layout="vertical"><H1>Signups convert at 5.2% end to end</H1>
<FUNNEL-FLOW showDrop="true">
<DIV value="12400"><H3>Visitors</H3></DIV>
<DIV value="3100"><H3>Signups</H3></DIV>
<DIV value="640"><H3>Trials</H3></DIV>
<DIV value="180"><H3>Paid</H3></DIV>
</FUNNEL-FLOW></SECTION>
<SECTION layout="vertical"><H1>Revenue grew 41% while churn fell</H1>
<KPI-ROW>
<DIV label="MRR" value="$1.24M" delta="+12.4%" dir="up" spark="88,91,95,99,104,112,124" />
<DIV label="Churn" value="2.1%" delta="-0.4pp" dir="down" good="down" spark="3.1,2.9,2.8,2.5,2.4,2.2,2.1" />
<DIV label="NRR" value="118%" delta="+6pp" dir="up" spark="104,108,110,112,115,118" />
</KPI-ROW></SECTION>
<SECTION layout="vertical"><H1>Migration is 42% complete against a 78% target</H1>
<PROGRESS-RINGS><DIV pct="78"><H3>Q3 target</H3></DIV><DIV pct="42"><H3>Migration</H3></DIV><DIV pct="91"><H3>NPS goal</H3></DIV></PROGRESS-RINGS></SECTION>
<SECTION layout="vertical"><H1>7 in 10 enterprise buyers require SSO</H1>
<PICTOGRAM total="10" filled="7" icon="user" perRow="5"><H3>Enterprise SSO requirement</H3></PICTOGRAM></SECTION>
<SECTION layout="vertical"><H1>We lead on offline capability and setup time</H1>
<HARVEY-TABLE>
<TR><TH>Criterion</TH><TH>Us</TH><TH>Vendor A</TH><TH>Vendor B</TH></TR>
<TR><TD>Offline capable</TD><TD ball="4" /><TD ball="1" /><TD ball="0" /></TR>
<TR><TD>Setup time</TD><TD ball="3" /><TD ball="4" /><TD ball="2" /></TR>
<TR><TD>Export fidelity</TD><TD ball="4" /><TD ball="2" /><TD ball="3" /></TR>
</HARVEY-TABLE></SECTION>
<SECTION layout="vertical"><H1>Four bets sorted by effort and impact</H1>
<MATRIX xLabel="Effort" yLabel="Impact" xLow="Low" xHigh="High" yLow="Low" yHigh="High">
<DIV quad="tl" tone="positive"><H3>Quick wins</H3><LI>SSO</LI><LI>Audit log</LI></DIV>
<DIV quad="tr"><H3>Big bets</H3><LI>Multi-region</LI></DIV>
<DIV quad="bl"><H3>Fill-ins</H3><LI>Theme editor</LI></DIV>
<DIV quad="br" tone="negative"><H3>Money pits</H3><LI>Legacy sync</LI></DIV>
</MATRIX></SECTION>
<SECTION layout="vertical"><H1>Three functions report into the CEO</H1>
<ORG-CHART><DIV name="CEO" role="Founder"><DIV name="VP Eng" role="Platform" /><DIV name="VP Sales" role="Revenue" /><DIV name="VP Ops" role="Delivery" /></DIV></ORG-CHART></SECTION>
<SECTION layout="vertical"><H1>Onboarding is where customers lose momentum</H1>
<JOURNEY>
<DIV stage="Discover" mood="2"><H3>Finds us via search</H3><P>Low friction.</P></DIV>
<DIV stage="Onboard" mood="-1"><H3>Manual data import</H3><P>Two-day delay.</P></DIV>
<DIV stage="Adopt" mood="1"><H3>Team invites land</H3></DIV>
<DIV stage="Renew" mood="2"><H3>Usage doubles</H3></DIV>
</JOURNEY></SECTION>
<SECTION layout="vertical"><H1>Our wedge sits where all three overlap</H1>
<VENN overlapLabel="Our wedge"><DIV><H3>Compliance-grade</H3></DIV><DIV><H3>Self-serve</H3></DIV><DIV><H3>Offline</H3></DIV></VENN></SECTION>
<SECTION layout="vertical"><H1>Hidden costs outweigh the 3 visible ones</H1>
<ICEBERG><ABOVE><H3>What buyers see</H3><LI>License price</LI></ABOVE><BELOW><LI>Data migration</LI><LI>Change management</LI><LI>Integration debt</LI></BELOW></ICEBERG></SECTION>
<SECTION layout="vertical"><H1>Invalid events route to a dead-letter queue</H1>
<FLOW direction="LR">
ingest[Ingest raw events]
clean{Valid schema?}
store[(Warehouse)]
drop[Dead-letter queue]
ingest --> clean
clean -->|yes| store
clean -->|no| drop
</FLOW></SECTION>
<SECTION layout="vertical"><H1>Q4 revenue beat the 120 target by 12%</H1>
<CHART charttype="bar" focus="Q4" target="120" avg="true" source="Internal finance, 2026" unit="$m">
| quarter | revenue |
| --- | --- |
| Q1 | 84 |
| Q2 | 97 |
| Q3 | 108 |
| Q4 | 134 |
| Q5 (f) | 150 |
</CHART></SECTION>
<SECTION layout="vertical"><H1>Enterprise overtook SMB during 2025</H1>
<CHART charttype="slope">
| segment | FY24 | FY26 |
| --- | --- | --- |
| Enterprise | 32 | 61 |
| SMB | 48 | 39 |
| Mid-market | 20 | 28 |
</CHART></SECTION>
</PRESENTATION>`;

async function main() {
  const themeName = process.argv[2] ?? "meridian";
  const parser = new SlideParser({ mode: "deck" });
  parser.parseChunk(XML);
  parser.finalize();
  parser.clearAllGeneratingMarks();
  const slides = planDeck(parser.getAllSlides());

  const doc = await db.document.create({
    data: {
      kind: "deck",
      title: "Phase 4 visual suite",
      prompt: "fixture",
      themeName,
      slides: JSON.stringify(slides),
      status: "ready",
      genParams: JSON.stringify({ webSearch: false }),
    },
  });
  console.log("id:", doc.id);
  console.log("slides:", slides.length);
  console.log(
    "types:",
    slides
      .map((s) => s.content.map((n) => (n as { type?: string }).type).join("+"))
      .join(" | "),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
