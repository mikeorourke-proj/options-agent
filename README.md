# JonesTrading — Tactical Note builder

Vite + React SPA that turns a written trade idea into a publishable
Tactical Note. Replaces the root `index.html` as the deployed site; the
v4 options dashboard is preserved verbatim at **/legacy.html**.

## Structure

    index.html                    Vite entry (the builder)
    netlify.toml                  build = vite, publish = dist
    package.json                  react + vite, @netlify/blobs retained
    public/legacy.html            v4 options dashboard, untouched
    public/handbook-v4.pdf        feature handbook
    src/
      main.jsx  App.jsx           shell + step navigation
      lib/runlog.js               run log (client half)
      lib/api.js                  typed client over the functions
      data/etf-universe.js        curated vehicle table (97 funds)
      steps/StepSource.jsx        1. document + your read -> themes
      steps/StepIdeas.jsx         2. theme cards -> expression menus
      steps/StepNote.jsx          5. settings, Opus draft, editable note, print
      note/NoteView.jsx           the three-page note, print-CSS
      lib/compose.js              note model from state; draft context
      lib/shares.js               ETF leg: scale plan, targets, expectancy
      lib/ordering.js             expectancy order with tie band
      lib/pricing.js              option pricing + view-conditional economics
      styles/note.css             A4, mm/pt only, no flex gap
      lib/vol.js                  chain analytics (IV, 25d RR, walls, max pain)
      lib/strategy.js             structure matrix (deterministic)
      components/SourceBar.jsx    persistent header
      styles/app.css              house palette
    netlify/functions/
      _runlog.mjs                 run log (server half)
      mkt.mjs                     Massive proxy, named routes only
      think.mjs                   Claude proxy, server-defined tasks
      capture*.mjs snapshot.mjs   EXISTING - untouched
      polygon.mjs ocr.mjs         EXISTING - untouched
      flashalpha.mjs              EXISTING - untouched

## Environment variables

Both already exist on the site:

    POLYGON_API_KEY      Massive (formerly Polygon.io)
    ANTHROPIC_API_KEY    used by ocr.mjs and now think.mjs

## Design rules

**Direction is the author's conclusion.** Commentary often sets out a
popular view at length in order to reject it. Two defences: the prompt
is explicit that the conclusion may arrive late and the title may carry
it, and evidence overlapping any quoted span is rejected server-side.
In this author's notes, quoted views are usually the ones being rebutted
-- so excluding quotes removes most of the inversion risk mechanically.

**Every theme carries its evidence.** A verbatim sentence from the
author's own prose, or basis "extended" and no sentence at all. The
parser cannot silently invert a view when it has to show its source.

**No attribution.** Three layers: prompt instruction, quoted-span
rejection, and a regex scan for attribution verbs that warns in the log.

**Dense chains get a tighter strike window.** SPY/QQQ/IWM carry ~256
contracts per expiry at +/-9%, enough to exhaust nine pages on the near
slice alone -- which means walls and GEX computed from partial open
interest, silently. Those names use +/-6.5%; both walls sit inside +/-4% in
practice, so nothing is lost.

**The chain is fetched as two disjoint expiry slices.** A single ascending
fetch spends its page budget on near-dated contracts. QQQ at a +/-9% strike
window carries ~200 strikes per expiry, so eight pages reached only 12
expiries, two of them beyond 20 days -- the expiry the structure needed was
never fetched, and every candidate failed on "strikes unavailable". Slice
NEAR (0-48d) supplies walls, GEX and 30-day vol; slice FAR (30-100d)
guarantees the expiry the structure will actually use. Contracts are
deduped by contract ticker across the overlap.

**Expiry is chosen by liquidity, not by date alone.** Weeklies and
monthlies sit side by side in the chain and look identical by date, but a
weekly strike can carry open interest of 4 where the monthly carries
thousands. Taking the first expiry past the catalyst therefore priced the
untradeable listing, every structure failed the OI gate, and whole themes
returned no options at all. rankExpiries() returns a ladder -- nearest
first, skipping expiries too thin to price -- and evaluate() walks it until
one clears the gate, so the gate selects the expiry instead of killing the
idea. Skipped expiries are logged on the passing gate entry.

**The note orders expressions without stating why.** Two sections, ETF
Expression and Derivatives Expression, each in sequence, no scores. An
implicit order carries more weight than an explicit one, so the tool must
be confident before it orders: ordering.js sorts on expectancy (the least
opinionated criterion -- it imposes no hit-rate-vs-magnitude preference)
and any expressions inside the tie band (0.5% of notional for ETFs, 0.10
EV per $ of premium for options) keep the order the analyst raised them
in. The action bar shows the resulting sequence; the log records whether
it was decisive or fell through to source order.

**Loss definition is a scored component.** Before v0.11 shares took 0.30
of the composite on convexity and carry before any economics ran, so an
option could almost never rank above the underlying and the order was a
foregone conclusion. riskDef (0.10) credits a debit structure fully, a
credit spread at 0.8, a naked short leg at zero, and shares by liquidity
grade (A 0.40 .. X 0.10) -- a stop is an intention, not a contract.

**Carry is charged to a date when there is one.** Without a catalyst
date there is no "before", so theta is charged across the whole holding
window. That is harsher on options than the old half-expiry default, and
it is why an undated thesis favours the underlying.

**Shares and options are scored on one scale.** Reward-to-risk is
scale-invariant, so it cannot tell a target one standard deviation away
from one a third of a deviation away -- IBIT looks better than GLD at
3.3:1 against 2.1:1 until you see the targets are 1.10 and 0.67 sigma
out. The ETF leg is therefore scored the way the options are: expectancy
under a distribution shifted by the stated conviction, with the same five
components and the same normalisation bands (exported from pricing.js so
the two cannot drift). Shares score 1.0 on convexity and near-zero carry,
which are genuine structural advantages and exactly why an undated thesis
favours the underlying. R:R is still displayed, but no longer ranks.

**Two rankings, two questions.** ETFs are ordered by APPROPRIATENESS --
how well the fund expresses the theme -- from purity of exposure (GLD is
bullion, GDX is miner equity carrying its own beta), options grade,
log-scaled dollar volume, and structural drag charged against the horizon
so levered and roll-decay products fall away as the holding period grows.
The options underlying is the top-ranked fund, so both orderings follow
from one score.

**Options are ranked on view-conditional economics.** Priced off implied
vol, every structure has a risk-neutral expected value of zero, so ranking
on EV ties everything -- the edge is in the analyst's view, not the
market's. The distribution is therefore shifted by the move the stated
conviction implies (high 1.0sd, medium 0.6sd, low 0.3sd over the horizon)
and structures compete on how well they monetise THAT move:

    EV on risk        0.35   expected P&L / max loss
    Probability       0.25   P(beyond breakeven)
    Convexity kept    0.15   share of the modelled move monetised
    Carry to catalyst 0.15   theta burned before the event
    Execution         0.10   bid-ask as % of outlay

Nothing is hard-coded about which structure is better: at high conviction
the outright wins on convexity, at low conviction the credit backspread
wins on carry. Cost efficiency is deliberately NOT a separate term -- it
already sits inside EV-on-risk, and weighting it twice would bias toward
selling convexity, which is exactly what a dated catalyst argues against.

**Asset identity vs sensitivity.** Each fund carries `a` (what it IS) and
`tags` (what it RESPONDS TO). GLD's tags include "dollar" because gold
moves on the dollar, but its asset is gold -- anchoring on tags put GLD at
the top of a US Dollar theme, and left IBIT out of a crypto theme because
only ETHA happened to carry a "crypto" tag. ANCHOR_VOCAB is built from `a`
and passed to the model separately from TAG_VOCAB; an anchor outside it is
rejected server-side and logged.

**Anchor-first retrieval.** Each theme names one anchorTag identifying the
asset it trades. Only funds carrying that tag are eligible. Without it a
silver theme pulls gold funds through a shared driver tag like
"debasement" and, gold being more liquid, gold takes the primary slot --
relevance losing to size. Ranking is relevance first, dollar ADV second.

**Tradeable subjects only.** Themes are directional views on assets, never
on abstractions. "Bearish inflation expectations" becomes "bullish US
Treasuries", so the direction applied to the vehicle is the direction
actually intended -- otherwise a bearish-inflation theme selects TMV, the
inverse Treasury fund, and states the opposite trade.

**Clusters are grouped by driver AND direction.** Themes sharing one driver
carry the same cluster id and can be combined into a single theme whose
anchors union, so the debasement complex ranks GLD, SLV and IBIT side by
side in one menu. Direction is part of the grouping key: one argument can
drive views both ways -- "the debasement trade is exhausted" implies
bearish gold AND bullish dollar -- and merging those into one card would
apply a single direction to both legs, screening the dollar with bearish
logic.

**Retrieval, not recall.** Claude returns tags from a fixed vocabulary;
`searchUniverse()` resolves those against `etf-universe.js`. The model
never emits a ticker, so it cannot invent one. Tags outside the
vocabulary are dropped server-side and logged as a violation.

**Liquidity gates before structures.** `gradeChain()` reads the count of
contracts carrying greeks and open interest. RSP returns empty greeks
and zero OI, so it grades `X` and the note falls back to a shares
expression. Never offer an option on a chain that does not price.

**Everything is logged.** `RunLog.fact()` records provenance for any
value bound for the PDF. `RunLog.gate()` records guardrail decisions
including the blocks. Server functions return `_log` in the envelope and
the client merges it, so one download covers the whole run. API keys are
scrubbed from URLs, payloads, messages and upstream error text.

## Known state

- NEOCLOUD is its own anchor: NCLD (pur 0.95), with WGMI, BKCH and DTCR
  carrying the anchor at 0.45/0.35/0.35 so they appear as considered-and-
  rejected in Exhibit 1 rather than vanishing. NCLD carries "ai" as a TAG
  but NOT as an anchor -- anchored on ai it outranked AIQ 0.689 to 0.603 on
  purity, so a plain "bullish AI" theme would have expressed through a $56M
  neocloud fund instead of the mega-cap vehicle. Purity is relative to the
  theme; NCLD is only pure with respect to the operators.
  The liq grades on all four are PRIORS, not probes. NCLD launched
  6 August 2026 at roughly $56M and its chain may come back X from the live
  gate, in which case the theme is shares-only -- the correct outcome.

- CONTRA is a source-level toggle, not a post-hoc flip. Reversing a finished
  theme leaves its evidence sentence arguing against its own direction --
  the exact incoherence the direction rules exist to prevent -- and it would
  pass every guard, because each field is individually well-formed. So the
  CONTRA block is APPENDED to the themes prompt, never substituted: reading
  the document correctly is a precondition for fading it, and an inverted
  reading produces an inverted trade.
  A contra theme is never "stated". The document does not assert the view
  being taken against it. The prompt says so (C3) and enforce() holds it in
  code, logging contra.basis.corrected when the model gets it wrong. The
  evidence sentence is relabelled "the claim being faded" with a red rule,
  because presenting it as evidence would read as the document supporting a
  trade it argues against. The block reaches themes and thesis only -- never
  the draft, the proofreader or the transcriber.

- A PDF CANNOT travel in the background function's invocation payload, and
  this cost three sessions of misdiagnosis. Background functions are invoked
  asynchronously and that invoke's body limit is far below the 6 MB a
  synchronous function accepts; a 1 MB PDF is 1.37 MB once base64'd into
  JSON, so Netlify rejected the invoke, the function never ran, the blob was
  never written, and the client polled "pending" until it gave up. It looked
  like a slow model. It was a rejected HTTP request.
  The bytes now go to pdf-stash, an ordinary synchronous function, as raw
  bytes -- no client-side base64, a third less over the wire, no FileReader.
  The job receives a key: 1,397,675 bytes of payload became 153. The stash
  is cleared in a finally, whether the read succeeded or not.
- thinkLong CHECKS THE INVOCATION RESPONSE. It used to discard it and log
  "queued" regardless, which is why a rejected invoke and an accepted one
  were indistinguishable. A background function answers 202; anything else
  throws immediately with the status and body.
- Transcription runs on Sonnet, not Opus. It is the one task with no
  reasoning in it -- copy the words out, in order, changing nothing -- and
  Opus spent over four minutes on a 1 MB news-article PDF without returning.
  Every PDF page reaches the model as an image as well as text, so a printed
  web page is many image-heavy pages. One line in MODELS to revert.
- A stuck job used to be a black box: job.queued followed by silence looked
  the same whether the background function never started or started and ran
  long. pollJob now logs every status transition once (pending -> running ->
  done) and puts lastStatus on both the timeout error and the log line, so
  the next stuck run says which of the two it was. "pending" means the blob
  has no document and the function has not reached its first write;
  "running" means the model has the request.
- A client timeout is not a job failure. The background function runs to 15
  minutes and nothing deletes the blob, so the answer is usually there
  shortly after the UI gives up. The jobId travels on the error and the
  banner carries a Check again button -- inside the banner, not below the
  textarea, where the first version of it went unnoticed. The banner reads
  "Still reading", not "Extraction failed", when the job is alive.
- composeNote re-runs only on what it computes from. Everything the analyst
  types -- title, subtitle, both windows, sector line, prose -- is
  passthrough, assembled into meta AFTER the orderings and the economics,
  and is now laid over a memoised model rather than sitting in its
  dependency list. 0.15.2 fixed the prose half and left the settings half,
  so a keystroke in the subtitle still re-ran both orderings and the theme
  mapping: one run logged 38 recomposes in 33 seconds of typing. The
  fallbacks live once, in analystMeta().
- Draft latency is climbing: 4,358 output tokens and 54s on v0.15.0, 11,548
  and 120s on v0.16.0, for prose the same length either way. The extra is
  thinking, and the draft prompt got more prescriptive in between. The poll
  deadline went 3 min -> 4 min and the timeout error now carries the jobId,
  since the job keeps running and the blob holds the answer -- only the
  client gives up. Worth watching; if it keeps growing the prompt is the
  place to look, not the deadline.
- PROOFREAD is a step, because native spellcheck cannot guard a printed
  document. Chrome marks a misspelling only while its field is focused and
  never paints the mark on the printed page, so "Draaaining" went through a
  subtitle input that had spellCheck set and printed clean. The spellCheck
  attributes stay -- they help while typing -- but the guard is the button.
  It returns FINDINGS, never prose: prose in a JSON string is what broke the
  first live draft at character 3,084, and keeping the model away from the
  sentences also stops it rewriting a directional claim or rounding a number
  on the way past. Findings are verified client-side against the section
  they name, character for character, and dropped if they do not match --
  a suggestion that cannot be applied safely is not shown. House words
  (realised and its forms) and all-capital tickers are blocked in code as
  well as in the prompt, because one click would otherwise apply them.
  Nothing changes until replace is clicked; keep dismisses.
- No last sale reaches the prose, on either execution mode. A scaled leg
  reads "scaling from current levels to 48.00 targeting a weighted average
  execution of 46.96"; an immediate leg reads "at current levels". The first
  rung is not a commitment and the tape has moved past it by the time the
  note is read; what IS committed is the far end of the band and the
  weighted average the ladder is built to achieve. Entry improvement went
  with it -- a percentage against a stale price that says nothing the
  weighted average does not. It survives in the internal explainer, which is
  where an audit figure belongs.
- House wording: "stop-loss", not "stop", checked by VOICE_CHECKS.stopword
  on /stops? at/. The walls and implied range get their own sentence rather
  than trailing off the stop with "with".
- VOICE_CHECKS.objective had to be narrowed. "Targeting" is a price
  objective everywhere except on the weighted average execution, which is a
  level the ladder is built to achieve rather than one the trade predicts,
  so the check carries a negative lookahead for that one construction. It
  still fires on "targeting 380" and "our target of".
- Editable fields carry spellCheck: the five note settings inputs, the two
  source textareas, and the contentEditable prose body. No lang is forced --
  pinning en-US would squiggle "realised" and offer to correct it, against
  the house rule. Replacements come from the browser's own context menu.
- Execution mode is RESOLVED, not just preferred. scalePlan forces immediate
  when the last sale sits inside NEAR_WALL (2%) of the wall being faded --
  the call wall on a bearish leg, the put wall on a bullish one -- because
  there is no room left to ladder. That rule always existed but fired
  invisibly: the toggle showed the analyst's stored preference, so it read
  "scaled" while the plan underneath was immediate and nothing on screen
  said why. The toggle now shows what the leg will actually do, marks it
  "immediate · auto" with an amber outline when proximity forced it, states
  the distance and the wall in the plan row, and logs calc/execution.auto.
  immediate with spot, wall and distance. Clicking "scaled" does not
  override it, and the tooltip says so.
- An IMMEDIATE leg enters at "current levels" and carries no entry price.
  draftContext used to send scaleFrom/scaleTo/targetExecution/improvement
  regardless of mode, and the model quoted them exactly as rule 6 tells it
  to: "short IBIT immediately at 45.23, the ladder spanning 45.23 to 48.00
  with entry improvement of 0.0" -- a ladder on a position that has none.
  Those fields are now withheld when the leg is immediate, the entry field
  reads "current levels", and draft rule 7 states both modes. The last sale
  is the wrong number to print in any case: it is stale by the time the note
  is read and no ladder makes it a commitment. Exhibit 3 no longer draws a
  band or an average marker for an immediate leg, Exhibit 4 shows "current
  levels" in place of the last sale, and checkImmediate() flags ladder words
  in an immediate theme's paragraph, or in any summary/execution sentence
  naming that ticker. It needs the draft context, not just the paragraph,
  because "scale" is correct language on a scaled leg.
- PDF upload is live. A PDF is NOT handed to the extractor as a document
  block, which is the obvious implementation and the wrong one: enforce()
  finds quoted spans by scanning the source text the client sent, so with
  no source text the quoted-evidence rejection returns an empty list and
  passes everything. It fails open and logs nothing. Instead the file goes
  up as base64 to a "transcribe" task, comes back as plain text, and lands
  in the textarea; extraction then runs on that text unchanged, with the
  guard armed and with the analyst able to read what the model read.
  Transcription is verbatim by instruction, quotation marks especially --
  a lost pair converts material the author is rebutting into material the
  author is asserting. The run log records the surviving quote-mark count.
  Ceiling is 4 MB: Netlify caps a function request at 6 MB and base64 adds
  a third. A scan with no text layer fails with that stated as the reason.
- Step 5 (Note) is live: compose from state, draft on a button, edit
  in place, print to PDF via the browser. The Python mock renderer is
  retired -- every number it hardcoded is now in state.
- Steps 3 (structure override) and 4 (scenarios) are not built; the tabs
  are disabled. Themes continues straight to Note.
- explain.js produces a standalone internal HTML audit: the ordering with
  gaps and tie-band decisions, then per expression the raw inputs, the
  normalised component scores, the weights and the contributions, plus what
  was rejected and why. The client note states no criterion; this is where
  the criterion is written down, including the known biases and the fact
  that every threshold is hand-set and unvalidated.
- The printed filename is MMDDYYYY-TICKER-Tactical Note. Browsers name the
  PDF from document.title, so it is set for the print and restored after.
- Each exhibit is wrapped in .exhblk with break-inside: avoid, so a title,
  its table and its source line travel together and a table never splits
  mid-row. A four-structure note previously pushed the last option leg to
  a fresh sheet under a duplicated header.
- print-color-adjust: exact is set on the note and everything inside it.
  Browsers strip background colour when printing by default, so the blue
  masthead band and every navy table header came out white.
- The note carries NO price objective, in tables or in prose. Targets
  anchor the reader, and the structural target is not always coherent:
  when the put wall sits above the last sale on a bearish trade the draft
  wrote "targeting 60 at +0.3%" -- a target in the wrong direction. The
  implied 1-sigma range conveys scale without nominating a level, and a
  voice check rejects "targeting" and "objective".
- Print CSS hides chrome BY NAME. The earlier rule hid every non-.noteprint
  child of .app, but .noteprint sits inside .main -- so .main was hidden and
  the note went with it. The exported PDF was blank.
- .wm absolute placement is scoped to .mast. Unscoped, the appendix
  wordmark positioned against .page and printed on top of the footer.
- State updates in StepNote are all functional. accept-all called accept()
  in a loop, every iteration reading the same snapshot, so only the last
  section stuck.
- No price objective appears in the note. Targets invite anchoring; the
  implied 1-sigma range is shown instead, labelled as the market's measure
  of a normal move rather than an objective.
- Diagnostics are wrapped and never assume a payload shape. parsed.themes
  is an ARRAY for extraction and an OBJECT for a draft; a log line that
  called .map on it discarded a complete, correctly-parsed note.
- Token budgets cover THINKING blocks, not just visible output. Two live
  drafts burned all 5,000 tokens reasoning and were cut off before a
  single text block was emitted -- the failure presented as a parse error
  when nothing had been written. think-background now logs the content
  block types and warns when no text came back at all.
- The Note step drafts automatically on arrival, then each section is
  edited in place and accepted individually. Editing an accepted section
  reopens it. Accept controls never print.
- The draft returns delimited sections (### SUMMARY / ### THEME: x /
  ### EXECUTION), never JSON. English prose contains quotation marks and
  apostrophes; the first live draft failed at character 3,084 on an
  unescaped quote inside a JSON string. Sections cannot break that way.
- The draft prompt enforces five voice rules mechanically (conditional
  voice, ETF first, no ranking language, no attribution, numbers as
  given). Violations are returned and shown above the note.
- Theme extraction runs as a BACKGROUND function: Opus takes 25-40s on a
  full Closing Print and Netlify kills synchronous functions at 26s.
  think-background.mjs writes to the "think-jobs" blob store; the client
  polls think-status.mjs. Prompts live in _prompts.mjs so the sync and
  background paths cannot drift.
- CSS avoids flex `gap` for anything destined for print: PDF engines and
  older WebKit ignore it and the row collapses into one run-on string.
  Use margins instead.
- PDF export: use points/mm, never px. Print CSS must not carry pixel
  dimensions or the output will not scale correctly at A4.
- Model: claude-opus-5 for every task, set in MODELS at the top of
  think.mjs, and stamped on each note via the run log.
- Calendar structures display the front expiry only; the back leg is
  chosen in the structure step.
- IV rank is not yet available -- it needs stored daily history. The
  matrix currently reasons from VRP, skew and term structure only.
- v0.2: asset class is a ranking boost, not a filter (a debasement idea
  must surface crypto and rates alongside metals); persistent intent bar
  with editable catalyst date; manual ticker add for anything listed;
  screen results cached so navigating back does not re-run the API.
- Scenario analysis needs 20y history; the current plan clamps at ~5y.
- ETF Global endpoints return 403 until the Fund Flows add-on is bought.
- Root `index.html` is now the Vite entry. The old dashboard content
  lives only at `public/legacy.html`.
