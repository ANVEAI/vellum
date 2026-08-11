/**
 * XML layout catalog — the vocabulary the LLM writes and the parser reads.
 *
 * Ported from allweonedev/presentation-ai (MIT License)
 * src/lib/presentation/layout-catalog.ts — see THIRD_PARTY_LICENSES.md.
 * Vellum adds the document-mode reference.
 */

export const LAYOUT_REFERENCE = `Available XML syntax and layout families:

Base slide shell:
<PRESENTATION><SECTION layout="left|right|vertical|background" role="hero|agenda|divider|statement|quote|testimonial|full-bleed|comparison|roadmap|phases|kpi|metrics|team|closing">...</SECTION></PRESENTATION>
Use one main component inside each SECTION. Add a direct child <IMG query="..." /> or <IMG url="..." /> only when a root slide image helps; place it last. Simple slides may use only <TITLE>, <LABEL>, <H1>, <H2>, <H3>, <H4>, <P>, <QUOTE>, <CALLOUT>, <CODE>, or <CONTRIBUTOR />.
- layout="background" makes the root IMG a full-bleed backdrop with a scrim and overlaid text — use it for the hero, section dividers, and high-impact image moments (keep text under 40 words on those slides).
- role="..." is an optional design hint naming the slide's job in the deck; the layout engine uses it to pick the right composition. Set it whenever a slide clearly is one of those roles.
- Each SECTION may include one <NOTES>Speaker talking points for this slide.</NOTES> element — spoken-voice notes for the presenter, never shown on the slide.

Shared item pattern:
Most visual components contain repeated items shaped as <DIV icon="optional"><H3>Label</H3><P>Short supporting text</P></DIV>. The wrapper tag changes the visual treatment. Only add icon="..." when the wrapper supports icons.

Columns:
Use <COLUMNS> when the slide needs balanced lanes or a container that can hold mixed nested content. Columns may contain headings, paragraphs, quotes, callouts, code blocks, item-level <IMG query="..." />, charts, infographics, or other supported elements when that improves clarity.
<COLUMNS><DIV><H3>Market</H3><P>Demand is rising.</P></DIV><DIV><IMG query="team planning" /><H3>Execution</H3><P>Delivery capacity is ready.</P></DIV></COLUMNS>

Text and content blocks:
Use these like normal content components anywhere plain text, headings, or paragraphs would fit, including inside COLUMNS. Use <TITLE> only for the first slide, a newly created title slide, or an introduction slide.
- <TITLE alignment="left|center|right">Main message</TITLE>
- <LABEL alignment="left|center|right">Category</LABEL>
- Quote family: <QUOTE variant="sidequote|large|sidequote-icon" author="Name">Memorable sentence.</QUOTE>. Use sidequote for the simple block quote treatment.
- <CALLOUT variant="note|info|warning|caution|success|question">Short contextual note.</CALLOUT>
- <CODE language="typescript">const example = true;</CODE>
- <CONTRIBUTOR /> is standalone and self-populates from frontend presentation metadata, you can chose the alignment attribute here if needed.

First slide title pattern:
For most generated first slides, use a compact title-slide pattern with <TITLE>, <CONTRIBUTOR />, and a supporting visual image. Place any direct child root <IMG query="..." /> last. You can omit <CONTRIBUTOR /> when the first slide needs a stronger creative concept.

List family:
Use these for grouped points, feature sets, benefits, requirements, or short takeaways. Choose the wrapper that best matches the visual emphasis.
- <BULLETS bulletType="basic|numbered|arrow">...</BULLETS>
- <ICONS variant="icon|image" orientation="side|top">...</ICONS>
    For <ICONS variant="image">, use <DIV prompt="detailed image prompt"> instead of icon. For <ICONS variant="icon">, use <DIV icon="keyword">.
- <BOXES boxType="outline|icon|solid|sideline|side-label|top-label|top-circle|joined|joined-icon|leaf|labeled|alternating|quote-box|speech-bubble" orientation="horizontal|vertical" numbered="true">...</BOXES>
- <ARROWS orientation="horizontal|vertical" svgType="arrow|pill|parallelogram" showIcon="true|false">...</ARROWS>

Example: <BULLETS bulletType="arrow"><DIV><H3>Faster review</H3><P>Decisions move in hours.</P></DIV><DIV><H3>Cleaner handoff</H3><P>Teams share one source.</P></DIV></BULLETS>

Sequence family:
Use these for steps, roadmaps, process flow, maturity, progression, hierarchy, funnels, and growth paths.
- <STEPS variant="arrow|box">...</STEPS>
- <ARROW-SEQUENCE orientation="vertical|horizontal">...</ARROW-SEQUENCE>
- <TIMELINE orientation="vertical|horizontal" sidedness="single|double" numbered="true" showLine="true">...</TIMELINE>
- <CYCLE variant="flower|ring|circle">...</CYCLE>
- <PYRAMID isFunnel="true" variant="inside">...</PYRAMID>
- <STAIRCASE variant="inside">...</STAIRCASE>
- <SNAKE>...</SNAKE>
- <SLOPE><DIV icon="idea"><H4>Start</H4></DIV><DIV icon="growth"><H4>Scale</H4></DIV></SLOPE>
Example: <STEPS variant="arrow"><DIV icon="search"><H3>Discover</H3><P>Find the real constraint.</P></DIV><DIV icon="settings"><H3>Build</H3><P>Ship the smallest useful system.</P></DIV><DIV icon="analytics"><H3>Improve</H3><P>Measure and refine.</P></DIV></STEPS>

Comparison family:
Use these when the audience must compare choices, trade-offs, states, or opposing positions.
- <COMPARE><DIV><H3>Option A</H3><LI>Strength</LI><LI>Risk</LI></DIV><DIV><H3>Option B</H3><LI>Strength</LI><LI>Risk</LI></DIV></COMPARE>
- <BEFORE-AFTER><DIV><H3>Before</H3><P>Manual and fragmented.</P></DIV><DIV><H3>After</H3><P>Automated and visible.</P></DIV></BEFORE-AFTER>
- <PROS-CONS><PROS><H3>Pros</H3><LI>Fast rollout</LI></PROS><CONS><H3>Cons</H3><LI>Training needed</LI></CONS></PROS-CONS>

Relationship family:
Use these for ecosystems, dependencies, loops, connected concepts, and a core idea surrounded by factors.
- <CIRCULAR-GRID centerText="Core idea">...</CIRCULAR-GRID>
- <CONNECTED-CIRCLES>...</CONNECTED-CIRCLES>
- <CYCLE variant="flower|ring|circle">...</CYCLE>

Data family:
Use data components when numbers or structured evidence carry the message.
- <STATS statstype="plain|circle|circle-bold|star|bar|dot-grid|dot-line"><DIV stat="85%"><H3>Retention</H3><P>After onboarding.</P></DIV></STATS>
Here the stat attribute is just for numeric values, percentages, or other quantitative metrics. NOT WORDS.
- <TABLE><TR><TH>Segment</TH><TH>Value</TH></TR><TR><TD>SMB</TD><TD>42%</TD></TR></TABLE>
- <CHART charttype="bar|pie|line|area|radar|scatter|radial-bar|composed|treemap|bubble|donut|histogram|heatmap|range-bar|range-area|waterfall|box-plot|candlestick|ohlc|nightingale|radial-column|sunburst|sankey|chord|funnel|cone-funnel|pyramid|radial-gauge|linear-gauge|slope|lollipop|dumbbell" focus="Q4" target="120" avg="true" callout="max: Peak quarter" source="Gartner, 2026" unit="$m" facet="false">
| label | value |
| --- | --- |
| Q1 | 24 |
| Q2 | 31 |
</CHART>
For charts, put a markdown table directly inside <CHART>. Headers define field names once. For multi-series charts, add columns such as revenue and profit. For scatter/bubble charts, use x, y, and optional z headers. For specialized charts, use the renderer field names: category/low/high, category/amount, date/open/high/low/close, category/min/q1/median/q3/max, x/y/value, or from/to/size.
Chart type notes: slope needs a category column plus exactly two value columns (before/after rank shifts). lollipop is a lighter single-series ranking bar. dumbbell needs category plus two value columns and draws the gap between them. range-bar needs category/low/high. range-area needs category/low/high with an optional mid.
Optional CHART attributes — use them, they are what makes a chart argue a point:
- focus="Q4" spends the accent color on one bar, slice, row, or line series and greys everything else. Set it whenever one data point proves the heading.
- target="120" draws a labeled reference line; avg="true" draws the average line. Use when performance is measured against a goal or a norm.
- callout="max: Peak quarter" annotates one point ("min: text", "max: text", or bare text). Never more than one.
- source="Gartner, 2026" prints a small credit under the chart; unit="$m" prints a unit subtitle. Use source for any external data.
- facet="true" splits 2-6 series into small multiples with a shared scale — use it instead of a tangle of lines.
- Category labels ending in "(f)" or "(e)" are automatically shaded as a forecast band.

Infographic family:
Purpose-built diagrams. Prefer these over a generic component whenever the data matches their selection rule — they are drawn to scale from your numbers.
- <FUNNEL-FLOW showDrop="true"><DIV value="12400"><H3>Visitors</H3></DIV><DIV value="3100"><H3>Signups</H3></DIV><DIV value="640"><H3>Trials</H3></DIV></FUNNEL-FLOW>
  Use for sequential stages where each is a subset of the previous AND you have counts; the biggest drop-off is highlighted automatically. 3-7 stages.
- <KPI-ROW><DIV label="MRR" value="$1.24M" delta="+12.4%" dir="up" spark="88,91,95,99,104,124" /><DIV label="Churn" value="2.1%" delta="-0.4pp" dir="down" good="down" spark="3.1,2.9,2.5,2.2,2.1" /></KPI-ROW>
  Use for 2-4 headline metrics that each carry a trend. good="down" marks a falling metric as positive.
- <PROGRESS-RINGS><DIV pct="78"><H3>Q3 target</H3></DIV><DIV pct="42"><H3>Migration</H3></DIV></PROGRESS-RINGS>
  Use for 2-4 independent percentages of a goal.
- <PICTOGRAM total="10" filled="7" icon="user" perRow="5"><H3>7 in 10 buyers require SSO</H3></PICTOGRAM>
  Use for one memorable ratio of 20 units or fewer.
- <HARVEY-TABLE><TR><TH>Criterion</TH><TH>Us</TH><TH>Vendor A</TH></TR><TR><TD>Offline capable</TD><TD ball="4" /><TD ball="1" /></TR></HARVEY-TABLE>
  Use for 3+ options scored on 3+ qualitative criteria. ball is 0-4 (empty to full).
- <MATRIX xLabel="Effort" yLabel="Impact"><DIV quad="tl" tone="positive"><H3>Quick wins</H3><LI>SSO</LI></DIV><DIV quad="tr"><H3>Big bets</H3></DIV><DIV quad="bl"><H3>Fill-ins</H3></DIV><DIV quad="br" tone="negative"><H3>Money pits</H3></DIV></MATRIX>
  Use for items classified on exactly two dimensions (effort/impact, risk/reward). Omit the axis labels for a SWOT.
- <ORG-CHART><DIV name="CEO" role="Founder"><DIV name="VP Eng" role="Platform" /><DIV name="VP Sales" role="Revenue" /></DIV></ORG-CHART>
  Use for strict parent/child hierarchies, 3 levels and 12 nodes maximum.
- <JOURNEY><DIV stage="Discover" mood="2"><H3>Finds us via search</H3></DIV><DIV stage="Onboard" mood="-1"><H3>Manual import</H3><P>Two-day delay.</P></DIV></JOURNEY>
  Use for time-ordered stages that each carry an emotional high or low. mood is -2..2; the lows are the point.
- <VENN overlapLabel="Our wedge"><DIV><H3>Compliance-grade</H3></DIV><DIV><H3>Self-serve</H3></DIV><DIV><H3>Offline</H3></DIV></VENN>
  Use for 2-3 sets whose intersection is the argument.
- <ICEBERG><ABOVE><H3>What customers see</H3><LI>Price</LI></ABOVE><BELOW><LI>Data migration</LI><LI>Change management</LI></BELOW></ICEBERG>
  Use for an explicit visible-versus-hidden contrast.
- <FLOW direction="LR">
ingest[Ingest events]
check{Valid schema?}
store[(Warehouse)]
ingest --> check
check -->|yes| store
</FLOW>
  Use for processes with branching or decisions. Node shapes: [process] (rounded) {decision} [(store)] ((terminal)). Edges are "a --> b" with an optional |label|. Keep labels under 6 words; 12 nodes maximum.
Never use an infographic for values on a common numeric scale — that is a CHART.
Last resort: <INFOGRAPHIC>self-contained visual prompt</INFOGRAPHIC> when no component above fits; include exact labels, values, entities, sequence, and takeaway in the text.

Supporting tags:
Use <DIV>, <TITLE>, <LABEL>, <CONTRIBUTOR />, <QUOTE>, <CALLOUT>, <CODE>, <H1>, <H2>, <H3>, <H4>, <P>, <LI>, <IMG />, <OPTIONS>, <TR>, <TH>, <TD>, <PROS>, <CONS>, <ABOVE>, and <BELOW> exactly as shown. Do not invent tags or attributes.`;

export const COMPONENT_INSTRUCTIONS = `Component instructions:
- Match component geometry to SECTION layout: vertical root images need horizontal/wide components, and left/right root images need vertical or compact components.
- Do not pair CYCLE with layout="vertical".
- Use compact text in dense visual components. SNAKE, CIRCULAR-GRID, CONNECTED-CIRCLES, and SLOPE items need very short labels.
- SLOPE items must use <H4> only and must not include <P>.
- Use <TITLE> only for the first slide, a newly created title slide, or an introduction slide.
- Use <CONTRIBUTOR /> only as an empty standalone metadata block. Do not add attributes or body text to it.
- Treat <LABEL>, <QUOTE>, <CALLOUT>, and <CODE> as normal content blocks that can be used anywhere headings and paragraphs can be used, including inside COLUMNS.
- Use COLUMNS only for balanced lanes. Every column item must have parallel content, similar text length, and the same heading level; do not mix an H1-style item with H3/H4-style items in sibling columns.
- Keep columns visually balanced even when they include images, charts, infographics, or nested supported content.`;

/**
 * Document mode reuses the same tag vocabulary with a different envelope and
 * different section semantics: a SECTION is a flowing chapter, not a slide.
 */
export const DOCUMENT_REFERENCE = `Available XML syntax for documents:

Base document shell:
<DOCUMENT><SECTION>...</SECTION></DOCUMENT>
Each SECTION is one chapter of a flowing written document (not a slide). SECTIONs have no layout attribute. Start each SECTION with one <H1> chapter heading, then write real prose: multiple <P> paragraphs (target 250-400 words per SECTION), organized with <H2> and <H3> subheadings where useful.

Inside a SECTION you may also use, sparingly and only where they genuinely aid the chapter:
- <IMG query="..." /> as an inline figure (at most one per SECTION, placed between paragraphs)
- <BULLETS bulletType="basic|numbered|arrow"><DIV><H3>Point</H3><P>Support.</P></DIV>...</BULLETS> for grouped points
- <STATS statstype="plain"><DIV stat="85%"><H3>Metric</H3><P>Context.</P></DIV></STATS> for headline numbers
- <TABLE><TR><TH>...</TH></TR><TR><TD>...</TD></TR></TABLE> for structured comparisons
- <CHART charttype="bar|line|pie|area">markdown table</CHART> for real numeric data
- <QUOTE variant="sidequote" author="Name">Quoted sentence.</QUOTE>
- <CALLOUT variant="note|info|warning|success">Short aside.</CALLOUT>
- <CODE language="...">code</CODE>
- <TIMELINE>, <STEPS>, <COMPARE>, <PROS-CONS> as full-width figures between paragraphs when the content is genuinely sequential or comparative

The FIRST SECTION is the document opening: start it with <TITLE>Document title</TITLE> followed by an introductory <P> lead paragraph (no H1 in the first SECTION).

Supporting tags: <DIV>, <H1>, <H2>, <H3>, <H4>, <P>, <LI>, <TR>, <TH>, <TD>, <PROS>, <CONS>. Do not invent tags or attributes. Do not use <CONTRIBUTOR />.`;
