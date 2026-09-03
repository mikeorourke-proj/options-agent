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

**Clusters.** Themes sharing one driver carry the same cluster id and can
be combined into a single theme whose anchors union, so the debasement
complex ranks GLD, SLV and IBIT side by side in one menu.

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

- Steps 3-5 (structure, scenarios, note) are placeholders.
- Theme extraction runs as a BACKGROUND function: Opus takes 25-40s on a
  full Closing Print and Netlify kills synchronous functions at 26s.
  think-background.mjs writes to the "think-jobs" blob store; the client
  polls think-status.mjs. Prompts live in _prompts.mjs so the sync and
  background paths cannot drift.
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
