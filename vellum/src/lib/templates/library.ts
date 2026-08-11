/**
 * Premium template library — curated generation blueprints.
 *
 * A blueprint fixes the narrative skeleton (section order + per-section
 * guidance), pairs it with a fitting builtin theme, and seeds generation
 * defaults. Section guidance references XML components from
 * src/lib/generation/parser/xml-catalog.ts so the content model reaches for
 * the right visual treatment per section.
 */

export interface TemplateBlueprint {
  id: string;
  kind: "deck" | "doc";
  name: string;
  tagline: string;
  emoji: string;
  /** Builtin theme key from src/lib/themes/data.ts. */
  theme: string;
  /** Image style preset id (src/lib/images/styles.ts); overrides the
   *  family default when the user leaves style on Auto. */
  imageStyle?: string;
  tone: string;
  textDensity?: "minimal" | "concise" | "detailed" | "extensive";
  nCards: number;
  promptPlaceholder: string;
  /** Deck/document-wide direction injected into generation prompts. */
  globalGuidance: string;
  /** Ordered narrative skeleton; guidance steers substance + component choice. */
  sections: Array<{ heading: string; guidance: string }>;
}

export const templates: TemplateBlueprint[] = [
  // ==================== DECKS ====================
  {
    id: "pitch-deck",
    kind: "deck",
    name: "Pitch Deck",
    tagline: "Raise your round with a sharp investor narrative",
    emoji: "🚀",
    theme: "indigo",
    tone: "confident, investor-ready",
    textDensity: "concise",
    nCards: 8,
    promptPlaceholder:
      "e.g. Aurora Robotics — AI-powered warehouse robots that cut fulfilment costs 40%, raising a $3M seed round…",
    globalGuidance:
      "This is an investor pitch. Every slide must advance one argument: this team is uniquely positioned to capture a large, urgent market. Lead with numbers wherever they exist, keep claims specific and falsifiable, and never bury the ask.",
    sections: [
      {
        heading: "The Problem",
        guidance:
          "Make the pain vivid and quantified — who suffers, how often, and what it costs them today. BULLETS or ICONS with three sharp pain points beats a wall of text.",
      },
      {
        heading: "Our Solution",
        guidance:
          "State the product in one plain sentence, then show how it kills the pain. BOXES or ICONS mapping each pain point to its fix; a BEFORE-AFTER lands well when the contrast is dramatic.",
      },
      {
        heading: "Market Opportunity",
        guidance:
          "Size the prize — TAM/SAM/SOM with sources — and name the tailwind that makes now the moment. STATS for the headline figures or a PYRAMID/CHART showing the addressable layers.",
      },
      {
        heading: "Product",
        guidance:
          "Walk the core workflow the user experiences and the moat behind it (data, IP, network effects). STEPS or ARROW-SEQUENCE for the workflow, with a product visual if it helps.",
      },
      {
        heading: "Traction",
        guidance:
          "Prove momentum with real numbers: revenue, users, growth rate, retention, marquee logos. A CHART of the growth curve plus STATS for headline metrics — let the slope do the talking.",
      },
      {
        heading: "Business Model",
        guidance:
          "Explain who pays, how much, and how often, with unit economics (CAC, LTV, margin). BOXES for the revenue streams or a TABLE comparing pricing tiers.",
      },
      {
        heading: "Team",
        guidance:
          "Show why this team wins: relevant exits, domain scars, unfair insight. ICONS or BOXES with one line of proof per person — credentials, not adjectives.",
      },
      {
        heading: "The Ask",
        guidance:
          "Name the raise, the runway it buys, and the milestones it unlocks. STATS for the amount, then a TIMELINE or STEPS of the 18-month plan investors are funding.",
      },
    ],
  },
  {
    id: "sales-deck",
    kind: "deck",
    name: "Sales Deck",
    tagline: "Turn discovery calls into signed deals",
    emoji: "🤝",
    theme: "crimson",
    tone: "persuasive, customer-centric",
    textDensity: "concise",
    nCards: 7,
    promptPlaceholder:
      "e.g. Sales deck for Meridian CRM aimed at mid-market logistics companies drowning in spreadsheet chaos…",
    globalGuidance:
      "Structure follows the buyer's journey: name their pain in their own words, show the cost of inaction, then position the product as the obvious path forward. Sell outcomes and proof, never feature lists — the prospect should see themselves on every slide.",
    sections: [
      {
        heading: "The Shift in Your World",
        guidance:
          "Open with the industry change that makes the old way untenable — a trend the buyer already feels. STATS or a CHART of the trend gives it authority.",
      },
      {
        heading: "The Cost of Standing Still",
        guidance:
          "Quantify what the status quo bleeds: hours, errors, churn, missed revenue. STATS with two or three brutal numbers, or ICONS itemizing the hidden costs.",
      },
      {
        heading: "A Better Way",
        guidance:
          "Reframe the problem around the destination — describe the after-state before naming the product. BEFORE-AFTER contrasting today's grind with the promised land.",
      },
      {
        heading: "How It Works",
        guidance:
          "Show the product carrying the buyer to that after-state in three or four concrete moves. STEPS or ARROW-SEQUENCE, one outcome verb per step.",
      },
      {
        heading: "Proof It Delivers",
        guidance:
          "Stack the evidence: named customer results, benchmark numbers, and a QUOTE from a believable champion. STATS for the results customers actually got.",
      },
      {
        heading: "Why Us, Not Them",
        guidance:
          "Draw the competitive contrast on the two or three dimensions this buyer cares most about. COMPARE or a TABLE scoring you against the alternative honestly.",
      },
      {
        heading: "Your Next Step",
        guidance:
          "Close with a low-friction, dated next action: pilot scope, timeline, who is in the room. STEPS or TIMELINE of the first 30 days, ending in a CALLOUT with the call to action.",
      },
    ],
  },
  {
    id: "corporate-deck",
    kind: "deck",
    name: "Board & QBR Deck",
    tagline: "Report the quarter with executive clarity",
    emoji: "📊",
    theme: "piano",
    tone: "measured, executive",
    textDensity: "detailed",
    nCards: 8,
    promptPlaceholder:
      "e.g. Q3 board review for a B2B SaaS company: 18% ARR growth, EMEA expansion on track, hiring behind plan…",
    globalGuidance:
      "Board members skim, then interrogate. Lead every section with the number and its delta versus plan, flag misses before anyone asks, and keep commentary to what changed, why, and what management is doing about it. CHARTs and TABLEs carry this deck; adjectives do not.",
    sections: [
      {
        heading: "Executive Summary",
        guidance:
          "Distill the quarter to three to five headline results with plan deltas, plus the one risk leadership is watching. STATS for the headlines and a CALLOUT for the watch item.",
      },
      {
        heading: "Financial Performance",
        guidance:
          "Revenue, gross margin, burn, and cash runway against plan and prior quarter. A CHART for the revenue trajectory and a TABLE of actual vs. plan vs. prior period.",
      },
      {
        heading: "Key Metrics Deep Dive",
        guidance:
          "The operating metrics that explain the financials — pipeline, retention, NRR, utilization, whatever drives this business. CHART for each trend that moved, STATS for the ones that held.",
      },
      {
        heading: "Wins & Progress",
        guidance:
          "Concrete wins with the number attached: deals closed, launches shipped, milestones hit. BULLETS or BOXES — one line each, achievement plus impact.",
      },
      {
        heading: "Challenges & Risks",
        guidance:
          "Name the misses and material risks with an owner and mitigation for each — candor here builds credibility. A TABLE of risk, impact, and mitigation, or PROS-CONS weighing a key decision.",
      },
      {
        heading: "Strategic Initiatives",
        guidance:
          "Status of the big bets — on track, at risk, or off track — and what changed this quarter. TIMELINE of milestones or BOXES with per-initiative status.",
      },
      {
        heading: "Outlook & Guidance",
        guidance:
          "Next quarter's targets and the full-year view, with the assumptions behind them. TABLE of guidance versus current run-rate; CHART if the trajectory tells the story.",
      },
      {
        heading: "Asks & Decisions",
        guidance:
          "What the board must decide or unblock today: approvals, introductions, hires. BULLETS with owner and date, closing with a CALLOUT on the single most important decision.",
      },
    ],
  },
  {
    id: "research-deck",
    kind: "deck",
    name: "Research Presentation",
    tagline: "Present findings with scientific rigor",
    emoji: "🔬",
    theme: "arctic",
    tone: "precise, evidence-led",
    textDensity: "detailed",
    nCards: 8,
    promptPlaceholder:
      "e.g. Findings from a 12-month study on remote work's effect on engineering productivity across 40 companies…",
    globalGuidance:
      "Follow the empirical arc — question, method, evidence, interpretation — and keep every claim strictly within what the data supports. Separate findings from speculation, quantify uncertainty where it exists, and make the methodology transparent enough to withstand attack.",
    sections: [
      {
        heading: "Background & Motivation",
        guidance:
          "Frame the gap in current knowledge and why closing it matters now. BULLETS tracing prior work to the open question this study answers.",
      },
      {
        heading: "Research Questions",
        guidance:
          "State the questions or hypotheses precisely, naming the variables involved. BOXES giving each hypothesis its own numbered box, testable as written.",
      },
      {
        heading: "Methodology",
        guidance:
          "Design, sample, instruments, and controls — enough for a skeptic to judge validity. STEPS or ARROW-SEQUENCE through the study pipeline; a TABLE for sample characteristics.",
      },
      {
        heading: "Data Overview",
        guidance:
          "Describe the dataset before interpreting it: scale, coverage, quality, exclusions. STATS for the dataset headlines and a TABLE of descriptive statistics.",
      },
      {
        heading: "Key Findings",
        guidance:
          "Present the central results with effect sizes and significance, one finding at a time. A CHART for the main result — the figure everyone will screenshot — plus STATS for the headline effects.",
      },
      {
        heading: "Secondary Findings",
        guidance:
          "Subgroup patterns, interactions, and surprises that add nuance. CHART or TABLE per pattern; a CALLOUT for the counterintuitive result worth flagging.",
      },
      {
        heading: "Limitations",
        guidance:
          "Own the threats to validity honestly: confounds, sample bias, generalizability limits. BULLETS pairing each limitation with its likely direction of bias.",
      },
      {
        heading: "Conclusions & Future Work",
        guidance:
          "Answer the research questions, name the implications, and chart what comes next. BULLETS answering each question, then a TIMELINE or STEPS for the follow-up agenda.",
      },
    ],
  },
  {
    id: "product-launch",
    kind: "deck",
    name: "Product Launch",
    tagline: "Unveil your product with momentum",
    emoji: "✨",
    theme: "cosmos",
    tone: "energetic, visionary",
    textDensity: "concise",
    nCards: 7,
    promptPlaceholder:
      "e.g. Launch deck for Pulse 2.0 — real-time analytics with anomaly alerts, debuting at our March keynote…",
    globalGuidance:
      "This is a reveal, not a spec sheet. Build tension from the problem to the unveiling, give the product one unforgettable headline, and frame every capability as a benefit the audience can picture. Momentum and clarity beat completeness.",
    sections: [
      {
        heading: "The World Today",
        guidance:
          "Paint the frustration your audience lives with — make them nod before you reveal anything. ICONS or BULLETS naming the three sharpest pains.",
      },
      {
        heading: "Introducing the Product",
        guidance:
          "The hero moment: product name, one-line promise, one striking visual. Keep the slide almost empty — a QUOTE-style tagline and a bold image do the work.",
      },
      {
        heading: "What It Does",
        guidance:
          "The three or four headline capabilities, each framed as an outcome for the user. BOXES or ICONS, one capability each — benefit first, mechanism second.",
      },
      {
        heading: "How It Works",
        guidance:
          "Demystify the magic in a simple flow from input to payoff. STEPS or ARROW-SEQUENCE with three or four stops, in plain language.",
      },
      {
        heading: "The Difference",
        guidance:
          "Contrast life before and after, or against the leading alternative. BEFORE-AFTER for the transformation, or COMPARE if the enemy is a named competitor.",
      },
      {
        heading: "Proof & Early Access",
        guidance:
          "Beta results, early-customer quotes, and pilot metrics that de-risk the promise. STATS for the numbers plus a QUOTE from an early believer.",
      },
      {
        heading: "Launch Plan & Availability",
        guidance:
          "When and where people can get it, the pricing headline, and rollout waves. TIMELINE of launch milestones ending in a CALLOUT with the call to action.",
      },
    ],
  },
  {
    id: "training-workshop",
    kind: "deck",
    name: "Training Workshop",
    tagline: "Teach skills that actually stick",
    emoji: "🎓",
    theme: "forest",
    tone: "encouraging, hands-on",
    textDensity: "detailed",
    nCards: 7,
    promptPlaceholder:
      "e.g. A half-day workshop teaching new managers how to run effective one-on-ones and give useful feedback…",
    globalGuidance:
      "Design for learning-by-doing: a concept earns its place only if learners practice it before leaving. Alternate explanation with exercise, keep cognitive load low with one idea per section, and close each section by naming what the learner can now do.",
    sections: [
      {
        heading: "Welcome & Objectives",
        guidance:
          "Set the destination: what participants will be able to DO by the end, and the shape of the agenda. BULLETS with three to five 'you will be able to' outcomes.",
      },
      {
        heading: "Why This Matters",
        guidance:
          "Motivate the skill with the cost of doing it badly and the payoff of mastery. STATS or a QUOTE that makes the stakes concrete.",
      },
      {
        heading: "Core Concepts",
        guidance:
          "Teach the mental model behind the skill — the minimum theory that makes practice make sense. BOXES or ICONS, one concept per box with a memorable label.",
      },
      {
        heading: "The Method, Step by Step",
        guidance:
          "Walk the technique as a repeatable procedure learners can follow under pressure. STEPS or ARROW-SEQUENCE — this is the heart of the workshop; keep every step actionable.",
      },
      {
        heading: "Hands-On Practice",
        guidance:
          "Set up the exercise: scenario, task, roles, timing, and what good looks like. STEPS for the exercise instructions and a CALLOUT with the success criteria.",
      },
      {
        heading: "Common Pitfalls",
        guidance:
          "Name the mistakes beginners make and the correction for each. COMPARE or PROS-CONS contrasting the wrong move with the right one.",
      },
      {
        heading: "Recap & Next Steps",
        guidance:
          "Compress the session to three takeaways and a 30-day practice plan. BULLETS for the takeaways, then a TIMELINE for the practice cadence after the workshop.",
      },
    ],
  },
  {
    id: "marketing-overview",
    kind: "deck",
    name: "Marketing Plan",
    tagline: "Align the team on strategy and spend",
    emoji: "📣",
    theme: "coral",
    tone: "sharp, results-oriented",
    textDensity: "concise",
    nCards: 6,
    promptPlaceholder:
      "e.g. H1 marketing plan for a D2C skincare brand: double paid social, launch influencer program, enter retail…",
    globalGuidance:
      "This plan must survive contact with a CFO: every channel gets a number, every campaign gets a goal, and the whole story ladders up to pipeline or revenue. State the strategy in one sentence early and let every later section prove it is resourced.",
    sections: [
      {
        heading: "Market & Audience",
        guidance:
          "Define who we win with — segments, personas, and the insight about them competitors miss. BOXES per persona with the buying trigger for each.",
      },
      {
        heading: "Positioning & Message",
        guidance:
          "The one-sentence positioning and the message pillars that cascade from it. A QUOTE-style positioning statement plus BOXES for the three message pillars.",
      },
      {
        heading: "Channels & Tactics",
        guidance:
          "Where we fight and why: each channel's role, expected contribution, and flagship tactic. A TABLE mapping channel to objective to KPI, or ICONS per channel.",
      },
      {
        heading: "Campaign Calendar",
        guidance:
          "The period's big moments in sequence: launches, seasonal pushes, always-on programs. TIMELINE of campaigns across the planning horizon.",
      },
      {
        heading: "Budget & Resources",
        guidance:
          "Where the money goes and the expected return by line. A CHART showing the spend split plus STATS for expected CAC or ROAS.",
      },
      {
        heading: "Goals & Measurement",
        guidance:
          "The targets this plan commits to and the dashboard cadence for tracking them. STATS for the headline KPIs with current baseline versus target.",
      },
    ],
  },
  {
    id: "consulting-strategy",
    kind: "deck",
    name: "Strategy Deck",
    tagline: "Consulting-grade: action titles, one message per slide",
    emoji: "🧭",
    theme: "piano",
    tone: "precise, analytical, board-level",
    textDensity: "concise",
    nCards: 8,
    promptPlaceholder:
      "e.g. Market-entry strategy for a European industrial group expanding into North American EV charging…",
    globalGuidance:
      "This is a consulting engagement deck in the McKinsey register. EVERY heading is an ACTION TITLE — a complete-sentence claim of at most 15 words stating the slide's takeaway (\"Distribution costs fall 22% under the hub model\"), never a topic label. One message per slide, evidence directly beneath it, MECE structure across sections, no adjectives where a number can stand. role=\"statement\" for the single most important finding.",
    sections: [
      {
        heading: "Executive summary: the answer first",
        guidance:
          "The pyramid principle: recommendation up front, then the three supporting arguments in one view. BULLETS with exactly three assertion-style points, each previewing a later section.",
      },
      {
        heading: "Situation: where the client stands today",
        guidance:
          "Baseline facts that frame the problem — market position, cost base, trajectory. STATS or a TABLE of the key baseline metrics with sources.",
      },
      {
        heading: "Complication: what breaks if nothing changes",
        guidance:
          "Quantify the gap or threat with a trend. A CHART projecting the do-nothing path, or BEFORE-AFTER contrasting today versus the emerging state.",
      },
      {
        heading: "The core finding",
        guidance:
          "role=\"statement\": the one number or insight the whole engagement turns on, stated huge with one supporting line.",
      },
      {
        heading: "Options considered and evaluation",
        guidance:
          "The 2-4 strategic options against explicit criteria. COMPARE for two options or a TABLE scoring options × criteria; state the recommended option plainly.",
      },
      {
        heading: "Recommendation and initiative detail",
        guidance:
          "The recommended path broken into concrete workstreams. BOXES with one initiative each — owner, scope, expected impact as a number.",
      },
      {
        heading: "Implementation roadmap",
        guidance:
          "Phased plan with milestones and dependencies. TIMELINE with dated phases, or STEPS when sequencing matters more than dates.",
      },
      {
        heading: "Impact and next steps",
        guidance:
          "The value at stake and the immediate asks. STATS for the impact figures (revenue, cost, margin) and a short BULLETS list of decisions needed now.",
      },
    ],
  },
  {
    id: "saas-investor-update",
    kind: "deck",
    name: "Investor Update",
    tagline: "SaaS metrics that build trust, quarter after quarter",
    emoji: "📈",
    theme: "orbit",
    tone: "transparent, metric-driven",
    textDensity: "concise",
    nCards: 7,
    promptPlaceholder:
      "e.g. Q3 investor update for Driftwake — API monitoring SaaS at $2.1M ARR, 8% MoM growth, raising an A next year…",
    globalGuidance:
      "A recurring SaaS investor update: candor builds more trust than spin. Lead every section with the metric, then the narrative. Use the standard vocabulary — ARR, MRR growth, net revenue retention, gross margin, CAC payback, burn multiple, runway — and show trends, not snapshots. Flag misses honestly with the fix underway; role=\"kpi\" for the headline metrics slide.",
    sections: [
      {
        heading: "TL;DR — the quarter in five numbers",
        guidance:
          "role=\"kpi\": ARR, growth rate, NRR, burn multiple, runway as STATS with deltas versus last quarter.",
      },
      {
        heading: "ARR growth and revenue quality",
        guidance:
          "The growth curve with composition. CHART of ARR by month or cohort, noting new versus expansion versus churn contribution.",
      },
      {
        heading: "Retention and engagement",
        guidance:
          "Whether customers stay and deepen. CHART of NRR/logo retention trend or cohort table; call out the driver behind the number.",
      },
      {
        heading: "Wins and losses",
        guidance:
          "Marquee closes, notable churns, and what each taught us. COMPARE or PROS-CONS framing wins against losses with the lesson per item.",
      },
      {
        heading: "Product velocity",
        guidance:
          "What shipped and what it moved. TIMELINE of releases with the metric each affected, or BOXES per major launch.",
      },
      {
        heading: "The miss we own",
        guidance:
          "One thing that underperformed, why, and the correction in motion. CALLOUT for the miss plus STEPS for the fix — candor is the feature.",
      },
      {
        heading: "Asks and runway",
        guidance:
          "Where investors can help (intros, hires, expertise) and the cash picture. BULLETS for the asks, STATS for runway months and next-raise timing.",
      },
    ],
  },
  {
    id: "conference-keynote",
    kind: "deck",
    name: "Conference Keynote",
    tagline: "Big type, big ideas — a talk, not a memo",
    emoji: "🎤",
    theme: "cosmos",
    tone: "bold, visionary, spoken-word",
    textDensity: "minimal",
    nCards: 9,
    promptPlaceholder:
      "e.g. Keynote: 'The next decade of local-first AI' for a 2,000-person developer conference…",
    globalGuidance:
      "This is a KEYNOTE — slides are a backdrop for a speaker, not a document. Maximum 20 words per slide, most slides far fewer. Big statements, full-bleed images, one giant number at the turning point. Use role=\"statement\" and layout=\"background\" liberally; alternate between image slides and stark text slides. Every slide must survive being seen for only four seconds from the back row. Write rich speaker NOTES — the depth lives in the spoken track.",
    sections: [
      {
        heading: "The hook",
        guidance:
          "role=\"hero\", layout=\"background\": the provocative one-liner that frames the talk, over a striking full-bleed image.",
      },
      {
        heading: "The world as it is",
        guidance:
          "The status quo in one image and under 15 words. layout=\"background\" with a single H2 claim.",
      },
      {
        heading: "The crack in the status quo",
        guidance:
          "role=\"statement\": the tension — one sentence that makes the audience lean in.",
      },
      {
        heading: "The number that changes everything",
        guidance:
          "role=\"statement\" with a single STATS item: one giant number and a six-word caption.",
      },
      {
        heading: "The shift",
        guidance:
          "Name the transformation in three beats. ARROWS or ARROW-SEQUENCE with three one-word-ish stages.",
      },
      {
        heading: "Proof it's already happening",
        guidance:
          "Two or three concrete examples, one line each. ICONS with short labels, or a full-bleed image with a caption per example across slides.",
      },
      {
        heading: "What this makes possible",
        guidance:
          "Paint the near future — aspirational but concrete. layout=\"background\" image slide with one H2 line.",
      },
      {
        heading: "The call",
        guidance:
          "role=\"closing\": what the audience should do Monday morning, under 12 words.",
      },
      {
        heading: "Thank you / where to find this",
        guidance:
          "role=\"closing\": speaker name, handle, one link. CONTRIBUTOR plus a single line.",
      },
    ],
  },
  {
    id: "education-course",
    kind: "deck",
    name: "Course Module",
    tagline: "Teach a module that actually sticks",
    emoji: "🍎",
    theme: "canopy",
    tone: "clear, encouraging, instructional",
    textDensity: "detailed",
    nCards: 8,
    promptPlaceholder:
      "e.g. A 45-minute module introducing photosynthesis for grade 9 biology, with a hands-on experiment…",
    globalGuidance:
      "This is a teaching module built on learning science: state objectives up front, chunk content into digestible segments, interleave checks for understanding, and close with retrieval practice. Use role=\"agenda\" for the objectives slide and role=\"divider\" between major segments. Definitions precise, examples concrete and age-appropriate, jargon introduced once and reused consistently.",
    sections: [
      {
        heading: "What you'll learn today",
        guidance:
          "role=\"agenda\": 3-5 learning objectives as observable outcomes (\"explain…\", \"calculate…\", \"identify…\"). BULLETS, numbered.",
      },
      {
        heading: "Hook: why this matters",
        guidance:
          "A surprising fact, question, or real-world stake that motivates the topic. role=\"statement\" or a striking image slide with one question.",
      },
      {
        heading: "Core concept, part one",
        guidance:
          "The first chunk: define it, show it, exemplify it. BOXES for definition/example/non-example, or a labeled diagram-style component.",
      },
      {
        heading: "Core concept, part two",
        guidance:
          "The second chunk, built explicitly on part one. STEPS or CYCLE when the content is a process; COMPARE when contrasting two cases.",
      },
      {
        heading: "Quick check",
        guidance:
          "2-3 retrieval questions on what was just covered. BULLETS phrased as questions — answers in the speaker NOTES, not on the slide.",
      },
      {
        heading: "Worked example or activity",
        guidance:
          "Walk one problem end-to-end, or set up the hands-on activity with materials and steps. STEPS with the exact sequence.",
      },
      {
        heading: "Common misconceptions",
        guidance:
          "The 2-3 errors learners predictably make, each with the correction. PROS-CONS or BEFORE-AFTER framing wrong-versus-right thinking.",
      },
      {
        heading: "Recap and practice",
        guidance:
          "Objectives restated as achievements plus homework/next steps. BULLETS mapping each objective to what was learned, CALLOUT for the assignment.",
      },
    ],
  },

  // ==================== STUDIO PACK SHOWCASES ====================
  {
    id: "studio-brief",
    kind: "deck",
    name: "Studio Brief",
    tagline: "Dark block-craft strategy brief (Meridian)",
    emoji: "▣",
    theme: "meridian",
    imageStyle: "editorial-dim",
    tone: "assured, precise, quietly confident",
    textDensity: "concise",
    nCards: 7,
    promptPlaceholder:
      "e.g. Product strategy brief for expanding our analytics platform into the healthcare vertical…",
    globalGuidance:
      "A high-craft strategy brief on a dark canvas. Every slide is a composed block: one claim, tight supporting structure, generous dark space. Action-title headings. Use role=\"statement\" for the pivotal number and layout=\"background\" for the opening image moment.",
    sections: [
      { heading: "The brief", guidance: "role=\"hero\", layout=\"background\": the engagement in one line over a moody image." },
      { heading: "Where we stand", guidance: "role=\"kpi\": 3-4 headline STATS framing the current position." },
      { heading: "The shift we see", guidance: "One market change stated as a claim. BEFORE-AFTER or a short BULLETS trio." },
      { heading: "What we'll build", guidance: "BOXES with 3 workstreams — each a noun phrase plus one concrete deliverable." },
      { heading: "How it lands", guidance: "role=\"phases\": 3-4 phase stages via STEPS with clear exit criteria." },
      { heading: "The number that matters", guidance: "role=\"statement\": the single outcome metric, huge." },
      { heading: "The decision", guidance: "role=\"closing\": what we're asking for, under 20 words." },
    ],
  },
  {
    id: "research-memo",
    kind: "doc",
    name: "Research Memo",
    tagline: "Warm ivory long-form memo (Foolscap)",
    emoji: "◈",
    theme: "foolscap",
    imageStyle: "editorial-illustration",
    tone: "measured, humane, evidence-first",
    textDensity: "detailed",
    nCards: 6,
    promptPlaceholder:
      "e.g. A memo on what we learned from 40 customer interviews about onboarding friction…",
    globalGuidance:
      "A warm editorial memo in the research-lab register: serif calm, claims grounded in evidence, no hype. Prose leads; every figure earns its place. Quantify findings; quote participants sparingly with attribution.",
    sections: [
      { heading: "Summary of findings", guidance: "The three findings in ranked order, each one sentence with its key number." },
      { heading: "Why we did this", guidance: "The question, the stakes, and the method in plain prose." },
      { heading: "Finding one", guidance: "The strongest finding: evidence, a supporting figure or QUOTE, and its implication." },
      { heading: "Finding two", guidance: "Same structure; contrast with finding one where meaningful." },
      { heading: "Finding three", guidance: "Same structure; note confidence level honestly." },
      { heading: "What we recommend", guidance: "Ranked recommendations, each tied to a finding, with owners and timing." },
    ],
  },
  {
    id: "launch-spotlight",
    kind: "deck",
    name: "Launch Spotlight",
    tagline: "Gradient-card product energy (Prism)",
    emoji: "◆",
    theme: "prism",
    tone: "electric, modern, confident",
    textDensity: "concise",
    nCards: 7,
    promptPlaceholder:
      "e.g. Launch deck for our new realtime collaboration engine, GA next month…",
    globalGuidance:
      "A product launch with card energy: every slide a rounded tile composition, gradient moments on the hero and statements, hot accent spent on the one number or CTA per slide. Short, kinetic copy.",
    sections: [
      { heading: "The reveal", guidance: "role=\"hero\": product name + one-line promise." },
      { heading: "The gap it closes", guidance: "The user pain, quantified. STATS or a sharp BULLETS trio." },
      { heading: "What it does", guidance: "Three capability cards via BOXES, each outcome-first." },
      { heading: "Under the hood", guidance: "The one technical differentiator; STEPS or a FLOW-style sequence." },
      { heading: "Proof", guidance: "role=\"metrics\": beta metrics as STATS with deltas." },
      { heading: "Pricing & availability", guidance: "TABLE or COMPARE of tiers; dates concrete." },
      { heading: "Get it", guidance: "role=\"closing\": the CTA and where to click, under 15 words." },
    ],
  },
  {
    id: "visual-story",
    kind: "deck",
    name: "Visual Story",
    tagline: "Charcoal image-forward narrative (Nocturne)",
    emoji: "●",
    theme: "nocturne",
    imageStyle: "editorial-photo",
    tone: "cinematic, spare, evocative",
    textDensity: "minimal",
    nCards: 6,
    promptPlaceholder:
      "e.g. The story of how a fishing village became a renewable energy exporter…",
    globalGuidance:
      "An image-led narrative: photography carries the story, words stay under 25 per slide. Every slide requests a strong image. Numbers render huge in the numeric face. role=\"statement\" at the turning point; layout=\"background\" often.",
    sections: [
      { heading: "Open on the scene", guidance: "role=\"hero\", layout=\"background\": establishing image + one line." },
      { heading: "The tension", guidance: "What was at stake, under 20 words, image-backed." },
      { heading: "The turn", guidance: "role=\"statement\": the moment things changed — one number or one sentence." },
      { heading: "How it happened", guidance: "3 beats via ICONS or STEPS, a few words each." },
      { heading: "Where it stands", guidance: "role=\"metrics\": 2-3 STATS that prove the outcome." },
      { heading: "What it means", guidance: "role=\"closing\": the takeaway, one resonant line." },
    ],
  },

  // ==================== DOCS ====================
  {
    id: "business-proposal",
    kind: "doc",
    name: "Business Proposal",
    tagline: "Win the contract with a compelling case",
    emoji: "📑",
    theme: "ocean",
    tone: "professional, persuasive",
    textDensity: "detailed",
    nCards: 7,
    promptPlaceholder:
      "e.g. Proposal to redesign and rebuild Northwind Logistics' customer portal, including support and training…",
    globalGuidance:
      "Written to be approved: the evaluator should find their own requirements reflected back, the approach de-risked, and the price justified by value. Mirror the client's language, quantify benefits wherever honest, and leave zero ambiguity on scope and terms.",
    sections: [
      {
        heading: "Executive Summary",
        guidance:
          "The whole proposal in one page: the client's goal, our approach, headline outcomes, and the price frame. Close with STATS for the two or three benefit numbers that anchor the pitch.",
      },
      {
        heading: "Understanding Your Needs",
        guidance:
          "Prove we listened: the client's situation, constraints, and success criteria in their own vocabulary. BULLETS enumerating the requirements we heard, each traceable in later sections.",
      },
      {
        heading: "Proposed Solution",
        guidance:
          "What we will deliver and how the pieces fit — the architecture of the engagement, not a sales pitch. BOXES for the major workstreams or components.",
      },
      {
        heading: "Scope & Deliverables",
        guidance:
          "Precisely what is included, what is explicitly out, and the acceptance criteria per deliverable. A TABLE of deliverable, description, and acceptance test; a CALLOUT for exclusions.",
      },
      {
        heading: "Timeline & Milestones",
        guidance:
          "Phases with dates, dependencies, and the decision gates the client controls. TIMELINE from kickoff to handover with milestone payments marked.",
      },
      {
        heading: "Investment & Terms",
        guidance:
          "The price, structured by phase or package, with payment schedule and commercial terms. TABLE of options or phases — make the recommended option obvious.",
      },
      {
        heading: "Why Us",
        guidance:
          "Track record on adjacent problems: named results, relevant credentials, and a client QUOTE. STATS from past engagements that resemble this one.",
      },
    ],
  },
  {
    id: "research-report",
    kind: "doc",
    name: "Research Report",
    tagline: "Document findings with full rigor",
    emoji: "📚",
    theme: "daktilo",
    tone: "objective, analytical",
    textDensity: "extensive",
    nCards: 8,
    promptPlaceholder:
      "e.g. Research report on consumer attitudes toward lab-grown meat across five European markets…",
    globalGuidance:
      "A reference document readers will cite: methodical structure, claims bound tightly to evidence, and enough methodological transparency to be reproducible. Write findings in a neutral register, flag confidence levels, and keep interpretation clearly fenced from observation.",
    sections: [
      {
        heading: "Executive Summary",
        guidance:
          "The findings that matter, in half a page, for the reader who stops here. BULLETS with the top findings, each carrying its headline number.",
      },
      {
        heading: "Introduction & Objectives",
        guidance:
          "Context, the questions this research answers, and the decisions it should inform. Close with BULLETS listing the formal research objectives.",
      },
      {
        heading: "Methodology",
        guidance:
          "Design, sampling, instruments, fieldwork dates, and the analytical approach — the reproducibility section. STEPS through the research process and a TABLE of sample composition.",
      },
      {
        heading: "Primary Findings",
        guidance:
          "The central finding cluster, with supporting data presented before interpretation. A CHART for the core result plus STATS for the headline figures.",
      },
      {
        heading: "Secondary Findings",
        guidance:
          "The second cluster of results — segment differences, temporal patterns, or contrasts with prior research. A TABLE or CHART for each contrast that matters.",
      },
      {
        heading: "Analysis & Discussion",
        guidance:
          "What the findings mean together: mechanisms, tensions between results, and how they square with prior work. Prose-led, with a CALLOUT for the most decision-relevant insight.",
      },
      {
        heading: "Limitations & Caveats",
        guidance:
          "The boundaries of the evidence: sample constraints, measurement issues, and where generalization breaks. BULLETS pairing each limitation with its practical consequence.",
      },
      {
        heading: "Recommendations & Conclusion",
        guidance:
          "What to do because of this research, ranked by confidence and impact. A TABLE of recommendation, supporting finding, and suggested owner.",
      },
    ],
  },
  {
    id: "whitepaper",
    kind: "doc",
    name: "Whitepaper",
    tagline: "Build authority with deep expertise",
    emoji: "📖",
    theme: "sand",
    tone: "authoritative, educational",
    textDensity: "extensive",
    nCards: 7,
    promptPlaceholder:
      "e.g. Whitepaper on zero-trust security architecture for mid-size financial institutions…",
    globalGuidance:
      "Thought leadership that earns trust by teaching, not selling: diagnose an industry problem with evidence, survey the solution landscape fairly, and let the recommended approach win on argument quality. Cite data, define terms on first use, and keep vendor perspective to the final act.",
    sections: [
      {
        heading: "Executive Summary",
        guidance:
          "The problem, the thesis, and the payoff for reading on — written last, placed first. BULLETS distilling the paper's argument into four or five statements.",
      },
      {
        heading: "The Industry Challenge",
        guidance:
          "Establish the problem with market evidence: what changed, who is exposed, and what it costs. STATS for the scale of the problem and a CHART for the trend that created it.",
      },
      {
        heading: "Why Current Approaches Fall Short",
        guidance:
          "Examine the standard solutions and where each breaks down — fair critiques, not straw men. PROS-CONS or a TABLE evaluating existing approaches against the requirements.",
      },
      {
        heading: "A New Framework",
        guidance:
          "Present the paper's core idea: principles first, then the model that operationalizes them. BOXES for the framework's pillars, or a STAIRCASE if it forms a maturity progression.",
      },
      {
        heading: "The Framework in Practice",
        guidance:
          "Ground the theory: an implementation path, a realistic scenario or mini-case, and the metrics that improve. STEPS for the implementation path and STATS from the worked example.",
      },
      {
        heading: "Considerations & Trade-offs",
        guidance:
          "Honest treatment of costs, risks, prerequisites, and when this approach is NOT the answer. PROS-CONS weighing adoption, plus a CALLOUT on the biggest prerequisite.",
      },
      {
        heading: "Conclusion & Path Forward",
        guidance:
          "Restate the thesis with earned confidence, then give the reader their first three moves. STEPS with a concrete starting sequence and a closing QUOTE if it crystallizes the argument.",
      },
    ],
  },
  {
    id: "case-study",
    kind: "doc",
    name: "Case Study",
    tagline: "Turn a customer win into proof",
    emoji: "🏆",
    theme: "mystique",
    tone: "credible, narrative",
    textDensity: "detailed",
    nCards: 6,
    promptPlaceholder:
      "e.g. Case study: how Harbor Freight cut order-processing time 68% after deploying our automation platform…",
    globalGuidance:
      "One customer, one transformation, real numbers: the arc runs situation, struggle, solution, measured payoff. Keep the customer as the hero and the product as the enabling tool, and make every claimed result specific enough to be checked.",
    sections: [
      {
        heading: "Customer Snapshot",
        guidance:
          "Who they are, at a glance: industry, size, mission, and what was at stake. STATS for the company fast-facts (revenue, headcount, footprint).",
      },
      {
        heading: "The Challenge",
        guidance:
          "The specific pain that forced action, quantified: what it cost, what it blocked, why now. BULLETS itemizing the pain plus a QUOTE from the customer describing life before.",
      },
      {
        heading: "The Approach",
        guidance:
          "How the solution was chosen and rolled out — decisions, phases, and who did what. STEPS or TIMELINE from evaluation to full deployment.",
      },
      {
        heading: "The Results",
        guidance:
          "The payoff in hard numbers against the baseline, with the timeframe stated. STATS for the headline results — this is the section readers screenshot — plus a BEFORE-AFTER on the key metric.",
      },
      {
        heading: "In Their Words",
        guidance:
          "Let the customer sell it: the quote that captures the transformation, with name and role. A QUOTE as the centerpiece with brief supporting narrative.",
      },
      {
        heading: "Key Takeaways",
        guidance:
          "What other teams in the same situation should conclude, generalized honestly from this case. BULLETS with three transferable lessons and a CALLOUT inviting the next step.",
      },
    ],
  },
  {
    id: "executive-one-pager",
    kind: "doc",
    name: "Executive One-Pager",
    tagline: "The whole story on a single page",
    emoji: "⚡",
    theme: "ebony",
    tone: "direct, no-nonsense",
    textDensity: "minimal",
    nCards: 4,
    promptPlaceholder:
      "e.g. One-pager for the board on our proposed acquisition of Fieldstone Analytics…",
    globalGuidance:
      "One page, one decision: every sentence either informs the decision or gets cut. Lead with the recommendation, support it with only the numbers that move it, and end with exactly what is being asked of the reader — assume 90 seconds of attention.",
    sections: [
      {
        heading: "The Situation",
        guidance:
          "Two or three sentences of context: what changed and why it demands a decision now. A CALLOUT stating the recommendation up front.",
      },
      {
        heading: "What Matters",
        guidance:
          "The three or four facts that drive the decision — nothing else. STATS with the decisive numbers, one line of context each.",
      },
      {
        heading: "Options & Recommendation",
        guidance:
          "The realistic paths with their trade-offs, and which one we back. A compact COMPARE or TABLE of options with the recommendation clearly marked.",
      },
      {
        heading: "The Ask",
        guidance:
          "Exactly what the reader must approve, by when, and what happens next. BULLETS with decision, deadline, and owner.",
      },
    ],
  },
];

export function getTemplate(id: string): TemplateBlueprint | undefined {
  return templates.find((t) => t.id === id);
}

/**
 * Flatten a blueprint into the `# TEMPLATE GUIDANCE` payload for the content
 * prompts: global direction plus per-section component hints as a list.
 */
export function formatTemplateGuidance(template: TemplateBlueprint): string {
  return [
    template.globalGuidance,
    "",
    "Per-section guidance (in outline order — apply each to its section):",
    ...template.sections.map((s, i) => `${i + 1}. ${s.heading}: ${s.guidance}`),
  ].join("\n");
}
