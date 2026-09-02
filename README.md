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
      steps/StepThesis.jsx        1. idea -> structured intent
      steps/StepVehicles.jsx      2. candidates -> live liquidity screen
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
- Scenario analysis needs 20y history; the current plan clamps at ~5y.
- ETF Global endpoints return 403 until the Fund Flows add-on is bought.
- Root `index.html` is now the Vite entry. The old dashboard content
  lives only at `public/legacy.html`.
