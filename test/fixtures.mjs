/* ═══════════════════════════════════════════════════════════════════
   fixtures.mjs — the cases the scoring core must keep answering.

   These are GOLDEN-MASTER fixtures, not assertions of correctness. Several
   of the recorded outputs are known to be wrong — that is the point. The
   redesign (quadrature, barrier, spot ranking, skewed width, purity in the
   drift) will move most of these numbers, and the harness exists so that
   every movement is visible and has to be justified, rather than a
   regression hiding inside an improvement.

   Where a case comes from a published note, the figures are the ones that
   actually printed, so the snapshot ties to real output rather than to
   invented inputs.

   Deliberately included:
     - every direction, because ELEVEN consecutive notes have been bearish
       and the bullish paths are effectively untested
     - the degenerate wall pair that scored silver at 0.04
     - a breached entry wall, where spot sits above the call wall
     - a grade-X name with no chain and under 30 sessions of history
     - a stop inside the noise, and a target inside the noise
   ═══════════════════════════════════════════════════════════════════ */

export const CASES = [
  /* ── From the 9 Sep note: "Debasement Enthusiasm is Misplaced" ─────── */
  { id: "ETHA.bearish.scaled", note: "2026-09-09",
    spot: 18.95, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "ETHA", iv30: 55.2, rv30: 61.0, rr25: -5.06, termSlope: 0.98,
           callWall: 20, putWall: 16,
           callWalls: [{ strike: 20, oi: 41000 }, { strike: 22, oi: 9800 }],
           putWalls:  [{ strike: 16, oi: 73381 }, { strike: 15, oi: 12400 }] },
    execution: "scaled", stopMode: "wall", liq: "B", purity: 1.0 },

  { id: "IBIT.bearish.scaled", note: "2026-09-09",
    spot: 44.99, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "IBIT", iv30: 42.1, rv30: 39.4, rr25: -5.09, termSlope: 1.008,
           callWall: 48, putWall: 40,
           callWalls: [{ strike: 48, oi: 31000 }, { strike: 52, oi: 9000 }],
           putWalls:  [{ strike: 40, oi: 53372 }, { strike: 38, oi: 12000 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0 },

  { id: "GLD.bearish.target-inside-noise", note: "2026-09-09",
    spot: 404.47, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "GLD", iv30: 27.5, rv30: 26.8, rr25: -5.69, termSlope: 1.109,
           callWall: 430, putWall: 400,
           callWalls: [{ strike: 430, oi: 19300 }, { strike: 440, oi: 7100 }],
           putWalls:  [{ strike: 400, oi: 26840 }, { strike: 390, oi: 11200 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "put wall 1.1% away — clears the 1% step threshold and still scores near zero" },

  { id: "SLV.bearish.walls-collide", note: "2026-09-09",
    spot: 60.18, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "SLV", iv30: 44.5, rv30: 47.2, rr25: -4.53, termSlope: 0.964,
           callWall: 60, putWall: 60,
           callWalls: [{ strike: 60, oi: 14200 }, { strike: 63, oi: 6890 }, { strike: 65, oi: 3100 }],
           putWalls:  [{ strike: 60, oi: 15905 }, { strike: 57, oi: 9120 }, { strike: 55, oi: 7430 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "both walls on one strike AND spot already through the call wall — the case that broke twice" },

  /* ── From the 8 Sep note: "Changing Our View on Rates" ──────────────── */
  { id: "SPY.bearish.deep-chain", note: "2026-09-08",
    spot: 767.68, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "SPY", iv30: 11.6, rv30: 11.8, rr25: -4.76, termSlope: 0.85,
           callWall: 790, putWall: 760,
           callWalls: [{ strike: 790, oi: 88000 }, { strike: 800, oi: 41000 }],
           putWalls:  [{ strike: 760, oi: 120000 }, { strike: 750, oi: 63000 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0 },

  /* ── From the 8 Sep contra note ─────────────────────────────────────── */
  { id: "NCLD.bearish.no-chain", note: "2026-09-08",
    spot: 25.83, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "NCLD", iv30: null, rv30: 85.3, rvWindow: 22,
           callWall: null, putWall: null },
    execution: "immediate", stopMode: "flat", liq: "X", purity: 0.95,
    why: "grade X, no walls, 23 sessions of history — the shares-only fallback path" },

  /* GRID, 16 Sep: no wall at all. It used to be forced IMMEDIATE, which had
     the logic backwards — a leg with resistance helping the entry got to
     ladder while a leg with nothing got hurried in at market. It now scales
     over half a sigma. */
  { id: "GRID.bearish.no-wall-scaled", note: "2026-09-16",
    spot: 172.99, direction: "bearish", conviction: "medium", horizonDays: 24,
    vol: { ticker: "GRID", iv30: 23.2, rv30: 22.4, callWall: null, putWall: null,
           purity: 0.75, confidence: 0.772, confidenceFrom: "chain" },
    execution: "scaled", stopMode: "flat", liq: "B",
    why: "no wall — must ladder over a volatility band, not go immediate" },

  { id: "GRID.bearish.no-wall-forced-immediate", note: "2026-09-16",
    spot: 172.99, direction: "bearish", conviction: "medium", horizonDays: 24,
    vol: { ticker: "GRID", iv30: 23.2, rv30: 22.4, callWall: null, putWall: null,
           purity: 0.75, confidence: 0.772, confidenceFrom: "chain" },
    execution: "immediate", stopMode: "flat", liq: "B",
    why: "the analyst can still force it — that path must survive" },

  { id: "HYG.bearish.auto-immediate", note: "2026-09-08",
    spot: 79.18, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "HYG", iv30: 9.4, rv30: 8.1, rr25: -2.10, termSlope: 0.97,
           callWall: 80, putWall: 77,
           callWalls: [{ strike: 80, oi: 26000 }, { strike: 82, oi: 7400 }],
           putWalls:  [{ strike: 77, oi: 31000 }, { strike: 75, oi: 14000 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "1.0% from the call wall — proximity forces immediate against a scaled preference" },

  /* ── Directions and settings the published notes have never exercised ── */
  { id: "TLT.bullish.scaled", note: "synthetic",
    spot: 88.40, direction: "bullish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "TLT", iv30: 15.2, rv30: 14.1, rr25: 1.20, termSlope: 1.02,
           callWall: 95, putWall: 85,
           callWalls: [{ strike: 95, oi: 52000 }, { strike: 98, oi: 18000 }],
           putWalls:  [{ strike: 85, oi: 61000 }, { strike: 82, oi: 22000 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "ELEVEN consecutive bearish notes — the bullish ladder and stop are untested in production" },

  { id: "TLT.bullish.walls-collide", note: "synthetic",
    spot: 88.40, direction: "bullish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "TLT", iv30: 15.2, rv30: 14.1, rr25: 1.20, termSlope: 1.02,
           callWall: 88, putWall: 88,
           callWalls: [{ strike: 88, oi: 40000 }, { strike: 93, oi: 12000 }],
           putWalls:  [{ strike: 88, oi: 44000 }, { strike: 84, oi: 16000 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "the silver case mirrored — bullish, both walls on one strike, spot already below the put wall" },

  /* A ticked SECONDARY, scored the way StepIdeas now scores one: its own
     realised vol, no chain, volatility-banded ladder, flat stop. Before
     this it had no plan at all, failed compose's t.etf?.share filter and
     vanished from the note while the drafter still wrote its paragraph. */
  { id: "IAU.bearish.secondary-vehicle", note: "2026-09-16",
    spot: 61.20, direction: "bearish", conviction: "medium", horizonDays: 24,
    vol: { ticker: "IAU", iv30: null, rv30: 26.8, rvWindow: 30,
           callWall: null, putWall: null, purity: 1, confidence: 1 },
    execution: "scaled", stopMode: "flat", liq: "B",
    why: "secondary vehicles must produce a real leg, not a ticker with a price" },

  { id: "GDX.bearish.impure-proxy", note: "synthetic", purity: 0.60,
    spot: 61.20, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "GDX", purity: 0.60, iv30: 38.0, rv30: 36.5, rr25: -3.40, termSlope: 1.05,
           callWall: 66, putWall: 57,
           callWalls: [{ strike: 66, oi: 22000 }, { strike: 70, oi: 8000 }],
           putWalls:  [{ strike: 57, oi: 29000 }, { strike: 54, oi: 11000 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 0.60,
    why: "purity is discarded today; after the redesign it scales the drift" },

  { id: "IBIT.bearish.high-conviction", note: "synthetic",
    spot: 44.99, direction: "bearish", conviction: "high", horizonDays: 28,
    vol: { ticker: "IBIT", iv30: 42.1, rv30: 39.4, rr25: -5.09, termSlope: 1.008,
           callWall: 48, putWall: 40,
           callWalls: [{ strike: 48, oi: 31000 }], putWalls: [{ strike: 40, oi: 53372 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "conviction moves the median 1.0 sigma instead of 0.6 — every probability shifts with it" },

  { id: "IBIT.bearish.flat-stop", note: "synthetic",
    spot: 44.99, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "IBIT", iv30: 42.1, rv30: 39.4, rr25: -5.09, termSlope: 1.008,
           callWall: 48, putWall: 40,
           callWalls: [{ strike: 48, oi: 31000 }], putWalls: [{ strike: 40, oi: 53372 }] },
    execution: "immediate", stopMode: "flat", liq: "A", purity: 1.0,
    why: "the flat 5% alternative, with execution forced by the analyst rather than by proximity" },

  /* CIBR on 16 Sep: 91 contracts with greeks across 3 expiries, against
     SPY's 2,765 across 17 — and until now they ranked on the same footing. */
  { id: "CIBR.bearish.thin-chain", note: "2026-09-16",
    spot: 82.40, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "CIBR", confidence: 0.718, confidenceFrom: "chain",
           iv30: 29.7, rv30: 28.1, rr25: -2.26, termSlope: 1.02,
           callWall: 90, putWall: 78,
           callWalls: [{ strike: 90, oi: 3100 }, { strike: 95, oi: 900 }],
           putWalls:  [{ strike: 78, oi: 4200 }, { strike: 75, oi: 1500 }] },
    execution: "scaled", stopMode: "wall", liq: "C", purity: 0.9,
    why: "thin chain — the edge must shrink toward zero, not be trusted at face value" },

  { id: "SLV.bearish.long-horizon", note: "synthetic",
    spot: 60.18, direction: "bearish", conviction: "low", horizonDays: 90,
    vol: { ticker: "SLV", iv30: 44.5, rv30: 47.2, rr25: -4.53, termSlope: 0.964,
           callWall: 60, putWall: 60,
           callWalls: [{ strike: 60, oi: 14200 }, { strike: 63, oi: 6890 }],
           putWalls:  [{ strike: 60, oi: 15905 }, { strike: 57, oi: 9120 }] },
    execution: "scaled", stopMode: "wall", liq: "A", purity: 1.0,
    why: "the months horizon with low conviction — the widest distribution the tool produces" },
];

/* ═══════════════════════════════════════════════════════════════════
   Chain fixtures — analyzeChain, which the scoring cases above bypass
   entirely because they hand it a finished `vol` object.

   That blind spot was real: the wall filters were changed from 0.98x/1.02x
   windows to strict above/below spot, and the 13 scoring cases reported
   "nothing moved" because none of them goes through analyzeChain. A wall is
   the input to the plan, the stop and the target, so the selection rule
   needs its own coverage.
   ═══════════════════════════════════════════════════════════════════ */

/* Minimal contract the `usable` filter accepts: real greeks, IV in range,
   delta off the wings. Strike and OI are what the wall logic reads. */
const leg = (type, strike, oi, spot, exp = "2026-10-16") => ({
  details: { contract_type: type, strike_price: strike, expiration_date: exp },
  implied_volatility: 0.24,
  open_interest: oi,
  greeks: { delta: type === "call"
    ? Math.max(0.03, Math.min(0.97, 0.5 - (strike - spot) / (spot * 0.25)))
    : -Math.max(0.03, Math.min(0.97, 0.5 + (strike - spot) / (spot * 0.25))) },
});

/* analyzeChain needs 30+ usable contracts, so the grids below are dense
   enough to clear that bar — a thin grid records nulls and tests nothing. */

const gldStrikes = [360, 365, 370, 375, 380, 385, 390, 396, 400, 405, 410, 415, 420];
const gldCallOI = { 360:400, 365:600, 370:900, 375:1200, 380:1900, 385:2100, 390:3300,
                    396:4100, 400:21500, 405:9800, 410:6200, 415:2600, 420:1400 };
const gldPutOI  = { 360:2200, 365:3100, 370:5200, 375:7400, 380:9600, 385:11000, 390:15200,
                    396:9100, 400:24800, 405:3000, 410:1200, 415:700, 420:400 };

export const CHAIN_CASES = [
  /* GLD as it printed on 14 Sep: spot 392.19 with the 400 strike carrying the
     largest open interest on BOTH sides. Under the old 0.98x/1.02x windows it
     was eligible for each and the note printed 400/400. */
  { id: "GLD.walls.collided", spot: 392.185,
    why: "top OI on 400 for calls AND puts — printed 400/400 before the strict filters",
    contracts: ["2026-10-09", "2026-12-18"].flatMap(exp =>
      gldStrikes.flatMap(k => [leg("call", k, gldCallOI[k], 392.185, exp),
                               leg("put",  k, gldPutOI[k],  392.185, exp)])) },

  /* The dominant strike sits exactly ON spot. It can be neither wall. */
  { id: "walls.top-strike-at-spot", spot: 60.0,
    why: "biggest OI exactly at spot — must not become either wall",
    contracts: ["2026-10-09", "2026-12-18"].flatMap(exp =>
      [50, 52, 55, 57, 58, 60, 62, 63, 65, 68, 70].flatMap(k => [
        leg("call", k, k === 60 ? 40000 : 6000, 60, exp),
        leg("put",  k, k === 60 ? 44000 : 7000, 60, exp)])) },

  /* Well-separated walls — the strict filters must leave this untouched. */
  { id: "walls.clean", spot: 44.99,
    why: "walls far apart on either side of spot",
    contracts: ["2026-10-09", "2026-12-18"].flatMap(exp =>
      [34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54].flatMap(k => [
        leg("call", k, k === 48 ? 31000 : 5000, 44.99, exp),
        leg("put",  k, k === 40 ? 53372 : 8000, 44.99, exp)])) },
];

/* ═══════════════════════════════════════════════════════════════════
   Expiry ranking — the second untested function to bite.

   rankExpiries built its candidate list in DATE order and sliced to four,
   which defeated the "always keep the liquid fallback" line sitting right
   above the slice. On 14 Sep that cost GLD its entire derivatives leg: the
   deepest expiry held 191,992 contracts, sat ninth by date, and never got
   tried, while four consecutive dailies holding 10, 0, 1 and 5 contracts on
   the thinnest leg blocked every structure in turn.
   ═══════════════════════════════════════════════════════════════════ */
export const EXPIRY_CASES = [
  { id: "GLD.dailies-ahead-of-the-monthly", catalyst: "2026-09-16", horizon: "weeks",
    why: "four thin dailies precede the 191,992-contract monthly — the case that lost the leg",
    oi: { "2026-09-21": 6396, "2026-09-22": 1686, "2026-09-23": 2118, "2026-09-24": 1018,
          "2026-09-25": 35451, "2026-09-30": 64798, "2026-10-02": 17148, "2026-10-09": 17037,
          "2026-10-16": 191992, "2026-10-23": 6540, "2026-10-30": 3116 } },

  { id: "IBIT.deep-third-candidate", catalyst: "2026-09-16", horizon: "weeks",
    why: "already worked before the fix — must not change",
    oi: { "2026-09-21": 11287, "2026-09-23": 5396, "2026-09-25": 258783, "2026-10-02": 67999,
          "2026-10-09": 33892, "2026-10-16": 465284, "2026-10-23": 9691, "2026-10-30": 7597 } },

  { id: "FXY.single-expiry", catalyst: null, horizon: "weeks",
    why: "one expiry in the window — must still be returned",
    oi: { "2026-12-18": 27193 } },

  { id: "all-thin", catalyst: "2026-09-16", horizon: "weeks",
    why: "nothing clears the floor — must still offer the deepest rather than nothing",
    oi: { "2026-09-21": 300, "2026-09-25": 900, "2026-10-02": 1500, "2026-10-16": 2200 } },
];

/* ═══════════════════════════════════════════════════════════════════
   Voice checks — the THIRD area to produce a defect while uncovered.
   Walls, then expiry ranking, now the draft guards.

   The trigger: draft rule 7 requires "the wall leaves no room to scale" on
   an immediate leg, and checkImmediate's LADDER pattern flags the word
   "scale" inside it. The drafter wrote exactly what the prompt demanded and
   the guard called it a violation on three consecutive runs. The template
   landed in v0.20.0; the check predates it by five versions.

   These cases pin BOTH directions: the sanctioned phrasing must pass, and
   every real violation must still fire.
   ═══════════════════════════════════════════════════════════════════ */
export const VOICE_CTX = { themes: [
  { subject: "Gold",   direction: "bearish", etf: { ticker: "GLD",
      wall: { type: "call wall", role: "resistance", level: 405, distancePct: 1.7, direction: "higher", proximity: "nearby" },
      wallSentence: "Investors looking to trade the idea have call-wall resistance nearby at 405." } },
  { subject: "Silver", direction: "bearish", etf: { ticker: "SLV",
      wall: { type: "call wall", role: "resistance", level: 65, distancePct: 12.1, direction: "higher", proximity: "away" },
      wallSentence: "With call-wall resistance 12.1% higher, investors looking to trade the idea may prefer to scale in opportunistically." } },
  { subject: "Rates",  direction: "bullish", etf: { ticker: "TLT",
      wall: { type: "put wall", role: "support", level: 77, distancePct: 0.7, direction: "lower", proximity: "nearby" },
      wallSentence: "Investors looking to trade the idea have put-wall support nearby at 77." } },
  { subject: "Grid",   direction: "bearish", etf: { ticker: "GRID", wall: { noWall: true, noChain: true },
      wallSentence: "GRID has no listed-options market deep enough to show open-interest walls, so there is no wall to frame an entry against." } },
]};

export const VOICE_CASES = [
  /* 0.38.0 — SEED, INSTRUMENT, ENVIRONMENT. The paragraph is: market
     conditions, the view on the market, "One way to express the view is
     <TK>.", the wall sentence copied verbatim, then facts. No entry, no
     scale band, no stop, no risk figure, no holding period. Every phrase
     the 0.37 house style REQUIRED — "look to sell", "scale sales", "for a
     weighted average execution of", "the stop-loss ends the trade" — now
     flags, and those cases are kept below as the regression. */
  { id: "near.bearish-house", subject: "Gold", expect: "clean",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. The put wall sits at 380, and the one-month option-implied range is 369 to 417." },
  { id: "away.bearish-house", subject: "Silver", expect: "clean",
    body: "Haven demand is unwinding as real yields rise. We are bearish on silver. One way to express the view is SLV. With call-wall resistance 12.1% higher, investors looking to trade the idea may prefer to scale in opportunistically. Implied volatility is running above realised, and the average daily move has been 1.9%." },
  { id: "near.bullish-house", subject: "Rates", expect: "clean",
    body: "Policy credibility is being restored, and the 2% inflation target is back in reach. We are bullish on long-dated Treasuries. One way to express the view is TLT. Investors looking to trade the idea have put-wall support nearby at 77. Investors who prefer a defined-risk expression could consider the November 20th 78/81 call spread, at a debit of 0.90, a maximum loss of 0.90 and a maximum gain of 2.10." },
  { id: "nochain.house", subject: "Grid", expect: "clean",
    body: "Haven demand is unwinding as real yields rise. We are bearish on grid infrastructure. One way to express the view is GRID. GRID has no listed-options market deep enough to show open-interest walls, so there is no wall to frame an entry against. The one-month range from realised volatility is 118 to 131." },

  /* The wall sentence — the one line that must not drift. */
  { id: "wall.missing", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. The one-month option-implied range is 369 to 417." },
  { id: "wall.reworded", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. There is call-wall resistance just overhead at 405, which helps sellers." },
  { id: "wall.hardened-to-should", subject: "Silver", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on silver. One way to express the view is SLV. With call-wall resistance 12.1% higher, investors looking to trade the idea should scale in opportunistically." },
  { id: "wall.wrong-side", subject: "Rates", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bullish on long-dated Treasuries. One way to express the view is TLT. Investors looking to trade the idea have call-wall resistance nearby at 83." },
  { id: "wall.near-but-scales", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. Investors may prefer to scale in opportunistically." },
  { id: "wall.cited-on-no-chain", subject: "Grid", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on grid infrastructure. One way to express the view is GRID. Investors looking to trade the idea have call-wall resistance nearby at 130." },
  { id: "wall.scaling-mechanics", subject: "Silver", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on silver. One way to express the view is SLV. With call-wall resistance 12.1% higher, investors looking to trade the idea may prefer to scale in opportunistically. Scaling in five pieces toward 65 would average the entry higher." },

  /* Opening shape, unchanged from 0.37. */
  { id: "opening.direction-inverted", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bullish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  { id: "opening.wrong-ticker", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is IAU. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  { id: "opening.view-on-ticker", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on GLD. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  { id: "opening.view-first", subject: "Gold", expect: "flag",
    body: "We are bearish on gold. Haven demand is unwinding as real yields rise. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  { id: "opening.ticker-before-view", subject: "Gold", expect: "flag",
    body: "GLD has lost its haven bid as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  { id: "opening.no-expression", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. Investors looking to trade the idea have call-wall resistance nearby at 405." },

  /* REGRESSION — the 0.36 and 0.37 house phrasings. All were required
     once; all are instructions or trade management now. */
  { id: "retired.look-to-sell", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD; the wall leaves no room to scale, so look to sell at current levels." },
  { id: "retired.scale-sales-weighted-average", subject: "Silver", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on silver. One way to express the view is SLV: look for the opportunity to scale sales from current levels to 60.00 for a weighted average execution of 58.40." },
  { id: "retired.stop-loss", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. The stop-loss at 409.05 ends the trade, 3.3% of risk." },
  { id: "retired.hold-window", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. The holding period is three to four weeks." },
  { id: "retired.old-conditional", subject: "Silver", expect: "flag",
    body: "We would be short SLV, scaling from current levels to 60.00 targeting a weighted average execution of 58.40." },
  { id: "voice.investors-should", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. Investors should size the position modestly." },
  { id: "voice.real-price-objective", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. We are targeting 380 over the coming month." },
  { id: "voice.policy-target-allowed", subject: "Gold", expect: "clean",
    body: "The Fed has raised rates to defend its inflation target, and the metals have lost their bid. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  { id: "voice.pop-cited", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. The put spread carries a POP of 41%." },
  { id: "voice.probability-cited", subject: "Gold", expect: "flag",
    body: "Haven demand is unwinding as real yields rise. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405. There is a 62% chance of finishing lower." },
  { id: "voice.pop-as-prose", subject: "Gold", expect: "clean",
    body: "A pop in real yields has taken the haven bid out of the metals. We are bearish on gold. One way to express the view is GLD. Investors looking to trade the idea have call-wall resistance nearby at 405." },
  /* A summary names no instrument and gives no instruction. */
  { id: "summary.clean", section: "summary", expect: "clean",
    body: "A rate hike that restores policy credibility steadies Treasuries and removes the case for their substitutes. The havens that gained from doubt about the dollar lose most as that doubt recedes." },
  { id: "summary.instructs", section: "summary", expect: "flag",
    body: "The havens lose their bid as policy credibility returns, and investors should look to sell strength across the metals with a stop-loss above the highs." },
];

/* ═══════════════════════════════════════════════════════════════════
   The wall that frames an entry, and the environment facts (0.38.0).

   wallContext decides the one sentence the note carries about entering:
   which wall, how far, and whether it is "nearby" (inside 7%) or far
   enough that the sentence is about scaling in. Each case below is a way
   that decision can go wrong without looking wrong.
   ═══════════════════════════════════════════════════════════════════ */
const ramp = (from, to, n) => Array.from({ length: n }, (_, i) => +(from + (to - from) * i / (n - 1)).toFixed(2));
export const WALL_CASES = [
  { id: "bullish.near-put-wall", spot: 77.53, direction: "bullish", vol: { putWall: 77, callWall: 83, iv30: 16.3, rv30: 13 } },
  { id: "bullish.far-put-wall", spot: 100, direction: "bullish", vol: { putWall: 90, callWall: 104, iv30: 30, rv30: 30 } },
  { id: "bearish.near-call-wall", spot: 76.91, direction: "bearish", vol: { putWall: 75, callWall: 79, iv30: 8.1, rv30: 6 } },
  { id: "bearish.far-call-wall", spot: 620, direction: "bearish", vol: { putWall: 555, callWall: 700, iv30: 35.5, rv30: 40 } },
  /* Exactly on the boundary: 7.0% is nearby, 7.1% is not. */
  { id: "boundary.exactly-7pct", spot: 100, direction: "bearish", vol: { putWall: 90, callWall: 107, iv30: 20 } },
  { id: "boundary.just-over", spot: 100, direction: "bearish", vol: { putWall: 90, callWall: 107.1, iv30: 20 } },
  /* The relevant wall is missing even though the other one exists. */
  { id: "bullish.no-put-wall", spot: 100, direction: "bullish", vol: { putWall: null, callWall: 105, iv30: 20 } },
  /* A wall on the WRONG SIDE must not be described as support below. */
  { id: "bullish.put-wall-above-spot", spot: 100, direction: "bullish", vol: { putWall: 102, callWall: 105, iv30: 20 } },
  { id: "no-chain.realised-only", spot: 124.5, direction: "bearish", vol: { iv30: null, rv30: 18, rvWindow: 23 } },
  /* The next concentration beyond the wall, from the ladder. */
  { id: "ladder.next-level", spot: 100, direction: "bearish",
    vol: { putWall: 95, callWall: 105, iv30: 20, callWallOI: 5000,
           callWalls: [{ strike: 105, oi: 5000 }, { strike: 102, oi: 4000 }, { strike: 110, oi: 3000 }] } },
  /* Environment from closes: a steady decline ending at the low. */
  { id: "env.at-three-month-low", spot: 90, direction: "bearish", vol: { putWall: 85, callWall: 95, iv30: 22, rv30: 16 },
    closes: ramp(110, 90, 80) },
  { id: "env.short-history", spot: 50, direction: "bullish", vol: { putWall: 48, callWall: 55, iv30: 25, rv30: 25 },
    closes: ramp(49, 50, 12) },
];

/* ═══════════════════════════════════════════════════════════════════
   Skew interpolation — the FOURTH area to produce a defect uncovered.
   Walls, expiry ranking, the draft guards, now ivAtDelta.

   It sorted by closeness to the target delta and took the two nearest,
   which does not require them to straddle it. On a sparse chain both fall
   on one side, the denominator collapses and the weight leaves [0,1]:
   deltas of 0.30 and 0.31 against a 0.25 target give w = -5. Both sides
   extrapolate independently and compound in c25 - p25 — CIBR printed
   -20.58, then -37.02 an hour later, on 99 contracts, while SPY read -5.6
   on 2,538 in the same run.

   Each case is built as a front-expiry call list; the assertion is that the
   result never lies outside the range of the quotes it was built from.
   ═══════════════════════════════════════════════════════════════════ */
const q = (delta, iv) => ({ greeks: { delta }, implied_volatility: iv,
                            details: { contract_type: "call", strike_price: 0 } });

export const SKEW_CASES = [
  { id: "brackets.target", target: 0.25, why: "the normal case — must interpolate",
    quotes: [q(0.18, 0.33), q(0.22, 0.31), q(0.28, 0.29), q(0.35, 0.28)] },
  { id: "sparse.both-above", target: 0.25, why: "CIBR's shape — used to give w = -5",
    quotes: [q(0.30, 0.29), q(0.31, 0.295), q(0.44, 0.27)] },
  { id: "sparse.both-below", target: 0.25, why: "the mirror — used to give w = -6",
    quotes: [q(0.19, 0.34), q(0.18, 0.345), q(0.11, 0.37)] },
  { id: "exact.hit", target: 0.25, why: "a quote sits exactly on the target",
    quotes: [q(0.25, 0.30), q(0.40, 0.28)] },
  { id: "nothing.close", target: 0.25, why: "no quote within the 0.12 tolerance",
    quotes: [q(0.55, 0.28), q(0.60, 0.27), q(0.72, 0.26)] },
  { id: "single.quote", target: 0.25, why: "one usable quote — no interpolation possible",
    quotes: [q(0.27, 0.33)] },
  { id: "empty", target: 0.25, why: "no usable quotes at all", quotes: [] },
];

/* ═══════════════════════════════════════════════════════════════════
   Option structure economics — scoreEconomics, which nothing has ever
   tested because it needs a priced chain rather than a summary object.

   It is also where the CLOCKS problem lives. scoreEconomics integrates to
   `pr.T`, the option's own expiry, while scoreShares integrates to
   horizonDays, and the note promises a 4-to-6 week hold. On the 9 Sep note
   the IBIT put spread was valued to its 18 September expiry — nine days —
   while the IBIT shares leg was valued over twenty-eight, and both went
   into the same composite.

   These fixtures record the CURRENT behaviour so the clocks change can be
   read as a diff rather than taken on trust. Several recorded numbers are
   expected to move.
   ═══════════════════════════════════════════════════════════════════ */

/* buildLegs needs a real ladder: 4+ contracts at the expiry, strikes spread
   either side of spot, and it selects by DELTA rather than by strike. So the
   fixture generates a chain the way a chain actually looks, with a
   Black-Scholes delta and price at each strike. */
function chainFor(spot, expiry, iv) {
  const T = Math.max((new Date(expiry) - Date.now()) / 31536e6, 1 / 365);
  const N = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t * t - 0.3565638 * t + 0.3193815);
    return x > 0 ? 1 - p : p; };
  const out = [];
  for (let m = -0.30; m <= 0.301; m += 0.05) {
    const K = +(spot * (1 + m)).toFixed(2);
    const d1 = (Math.log(spot / K) + (0.045 + iv * iv / 2) * T) / (iv * Math.sqrt(T));
    const d2 = d1 - iv * Math.sqrt(T), df = Math.exp(-0.045 * T);
    const call = spot * N(d1) - K * df * N(d2);
    const put  = K * df * N(-d2) - spot * N(-d1);
    const oi = Math.round(40000 * Math.exp(-((m / 0.12) ** 2)) + 500);
    for (const [type, px, delta] of [["call", call, N(d1)], ["put", put, N(d1) - 1]]) {
      const v = Math.max(px, 0.01);
      out.push({
        details: { contract_type: type, strike_price: K, expiration_date: expiry, ticker: `O:${type}${K}${expiry}` },
        implied_volatility: iv, open_interest: oi,
        greeks: { delta, gamma: 0.04, theta: -0.012, vega: 0.06 },
        last_quote: { bid: +(v * 0.97).toFixed(2), ask: +(v * 1.03).toFixed(2) },
        day: { close: +v.toFixed(2) },
      });
    }
  }
  return out;
}

/* Expiries are RELATIVE to today, not fixed dates.

   priceStructure computes time to expiry against Date.now(), so a fixed
   calendar date makes every recorded value drift by one day per day and the
   whole suite fails tomorrow for a reason that has nothing to do with the
   code. Offsets keep T constant and the snapshot reproducible. */
export const dayFrom = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
/* Date.now() is frozen by the harness before this module is imported, so
   these resolve to the same calendar dates on every run. */

const IBIT_NEAR = dayFrom(9);    //  expires mid-hold
const IBIT_FAR  = dayFrom(37);   //  outlives a 28-day hold

export const ECON_CASES = [
  { id: "IBIT.put-spread.near-expiry", spot: 44.99, direction: "bearish",
    conviction: "medium", horizonDays: 28, rv: 39.4, iv: 0.421,
    vol: { ticker: "IBIT", iv30: 42.1, rv30: 39.4, callWall: 48, putWall: 40 },
    structure: "put_spread", expiry: IBIT_NEAR,
    why: "expires at day 9 of a 28-day hold — valued to its own expiry today" },

  { id: "IBIT.put-spread.far-expiry", spot: 44.99, direction: "bearish",
    conviction: "medium", horizonDays: 28, rv: 39.4, iv: 0.421,
    vol: { ticker: "IBIT", iv30: 42.1, rv30: 39.4, callWall: 48, putWall: 40 },
    structure: "put_spread", expiry: IBIT_FAR,
    why: "outlives the hold — today it is valued nine days past the hold's end" },

  { id: "IBIT.long-put.far-expiry", spot: 44.99, direction: "bearish",
    conviction: "medium", horizonDays: 28, rv: 39.4, iv: 0.421,
    vol: { ticker: "IBIT", iv30: 42.1, rv30: 39.4, callWall: 48, putWall: 40 },
    structure: "long_put", expiry: IBIT_FAR,
    why: "uncapped payoff — the convexity component's reference case" },

  { id: "GLD.long-put.low-vol", spot: 404.47, direction: "bearish",
    conviction: "medium", horizonDays: 28, rv: 26.8, iv: 0.275,
    vol: { ticker: "GLD", iv30: 27.5, rv30: 26.8, callWall: 430, putWall: 400 },
    structure: "long_put", expiry: dayFrom(37),
    why: "a quarter of IBIT's volatility — the horizon matters more here" },

  { id: "TLT.long-call.bullish", spot: 88.40, direction: "bullish",
    conviction: "medium", horizonDays: 28, rv: 14.1, iv: 0.152,
    vol: { ticker: "TLT", iv30: 15.2, rv30: 14.1, callWall: 95, putWall: 85 },
    structure: "long_call", expiry: dayFrom(37),
    why: "the bullish side, which no published note has exercised" },

  { id: "GLD.long-put.catalyst-past-hold", spot: 404.47, direction: "bearish",
    conviction: "medium", horizonDays: 28, rv: 26.8, iv: 0.275,
    vol: { ticker: "GLD", iv30: 27.5, rv30: 26.8, callWall: 430, putWall: 400 },
    structure: "long_put", expiry: dayFrom(56), catalystDate: dayFrom(49),
    why: "catalyst 49 days out on a 28-day hold — carry must charge the days HELD, not the days to the event" },
].map(c => ({ ...c, contracts: chainFor(c.spot, c.expiry, c.iv) }));

/* ═══════════════════════════════════════════════════════════════════
   Correlation — sizing and the outlier, never the ranking.

   Two faults in the first build of this, both caught by running it rather
   than reading it. The concentration figure was largest + rho x (the rest),
   which can never exceed the sum, so a WARNING about concentration printed
   as an apparent reduction — 27.9% "rather than" 33%. And a two-leg note
   flagged both legs as outliers, since each is the other's only pair, then
   printed the same sentence twice.
   ═══════════════════════════════════════════════════════════════════ */
function corrSeries(loading, vol, p0, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const g = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let f = 11;
  const fr = () => { f = (f * 1103515245 + 12345) & 0x7fffffff; return f / 0x7fffffff; };
  const fg = () => { const u = fr() || 1e-9, v = fr(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const out = [{ c: p0 }];
  let p = p0;
  for (let i = 0; i < 90; i++) {
    p *= Math.exp((loading * fg() + Math.sqrt(Math.max(0, 1 - loading * loading)) * g()) * vol);
    out.push({ c: p });
  }
  return out;
}

export const CORR_CASES = [
  { id: "one-thesis-four-expressions",
    why: "the 9 Sep shape — must warn on sizing, must not reorder",
    legs: [{ ticker: "SMH", direction: "bearish", riskPct: 13.1, bars: corrSeries(0.92, 0.020, 300, 3) },
           { ticker: "QQQ", direction: "bearish", riskPct: 3.6,  bars: corrSeries(0.95, 0.012, 700, 5) },
           { ticker: "SPY", direction: "bearish", riskPct: 4.5,  bars: corrSeries(0.93, 0.009, 760, 9) },
           { ticker: "CIBR", direction: "bearish", riskPct: 11.8, bars: corrSeries(0.70, 0.014, 80, 13) }] },

  { id: "cluster-plus-outlier",
    why: "a leg that does not respond to the catalyst — must be named",
    legs: [{ ticker: "SMH", direction: "bearish", riskPct: 13.1, bars: corrSeries(0.92, 0.020, 300, 3) },
           { ticker: "QQQ", direction: "bearish", riskPct: 3.6,  bars: corrSeries(0.95, 0.012, 700, 5) },
           { ticker: "TLT", direction: "bullish", riskPct: 3.4,  bars: corrSeries(-0.10, 0.006, 88, 21) }] },

  { id: "two-unrelated-legs",
    why: "no outlier possible with two legs — must say nothing at all",
    legs: [{ ticker: "GLD", direction: "bearish", riskPct: 7.4, bars: corrSeries(0.05, 0.008, 400, 31) },
           { ticker: "TLT", direction: "bullish", riskPct: 3.4, bars: corrSeries(-0.10, 0.006, 88, 21) }] },

  /* 16 Sep, live: a bearish SMH leg and a bullish QQQ leg. The underlyings
     correlate at 0.90 and the first build called them a concentrated cluster
     that would "stop together". They stop on opposite moves. */
  { id: "opposite-directions-same-asset-beta",
    why: "hedged pair — must NOT read as concentrated",
    legs: [{ ticker: "SMH", direction: "bearish", riskPct: 12.8, bars: corrSeries(0.92, 0.020, 300, 3) },
           { ticker: "QQQ", direction: "bullish", riskPct: 3.7,  bars: corrSeries(0.95, 0.012, 700, 5) }] },

  { id: "same-direction-same-beta",
    why: "the control — identical assets, both short, must read as concentrated",
    legs: [{ ticker: "SMH", direction: "bearish", riskPct: 12.8, bars: corrSeries(0.92, 0.020, 300, 3) },
           { ticker: "QQQ", direction: "bearish", riskPct: 3.7,  bars: corrSeries(0.95, 0.012, 700, 5) }] },

  { id: "single-leg",
    why: "nothing to correlate",
    legs: [{ ticker: "SMH", direction: "bearish", riskPct: 13.1, bars: corrSeries(0.92, 0.020, 300, 3) }] },

  { id: "too-few-bars",
    why: "a fund listed five weeks ago — must decline rather than invent a number",
    legs: [{ ticker: "NCLD", direction: "bearish", riskPct: 5, bars: corrSeries(0.9, 0.05, 25, 7).slice(0, 12) },
           { ticker: "SMH", direction: "bearish", riskPct: 13.1, bars: corrSeries(0.92, 0.020, 300, 3) }] },
];


/* ═══════════════════════════════════════════════════════════════════
   Sourced claims — did the draft invent a market fact?

   Every other draft guard polices HOW something is said. None asked whether
   a factual claim came from the source at all. On 17 Sep the summary opened
   "an unexpected hike restores its inflation-fighting credibility" when the
   hike had been fully priced — and that word carries the argument, since an
   unexpected hike restores credibility far more forcefully than an expected
   one.

   Matching is by MEANING, not by literal word: a draft saying "unexpected"
   is satisfied by a source saying "caught markets off guard". Checking the
   exact word would flag every legitimate paraphrase.
   ═══════════════════════════════════════════════════════════════════ */
export const PRICED_SOURCE =
  "The Federal Reserve raised rates by 25 basis points today, a move markets had fully priced " +
  "going in. Chair Powell said the committee remains focused on returning inflation to target.";
export const SURPRISE_SOURCE =
  "The hike caught markets off guard; almost no one expected a move today.";

export const CLAIM_CASES = [
  { id: "invented.surprise", source: PRICED_SOURCE, expect: "flag",
    why: "the 17 Sep case — source says fully priced, draft says unexpected",
    body: "The Fed has acted rather than spoken, and an unexpected hike restores its inflation-fighting credibility." },
  { id: "surprise.supported", source: SURPRISE_SOURCE, expect: "clean",
    why: "same sentence, a source that supports it — must NOT flag",
    body: "The Fed has acted rather than spoken, and an unexpected hike restores its inflation-fighting credibility." },
  { id: "expected.supported", source: PRICED_SOURCE, expect: "clean",
    why: "the draft agrees with the source",
    body: "The Fed hiked as expected, and acting rather than speaking restores its credibility." },
  { id: "invented.unanimity", source: PRICED_SOURCE, expect: "flag",
    why: "nothing in the source describes the vote",
    body: "The unanimous decision signals a committee that has stopped debating." },
  { id: "invented.magnitude", source: PRICED_SOURCE, expect: "flag",
    why: "no superlative in the source",
    body: "This is the largest since the 2022 cycle and marks a decisive turn." },
  { id: "no.claims", source: PRICED_SOURCE, expect: "clean",
    why: "prose making no checkable claim about reception",
    body: "The Fed hiked and the committee signalled more to come; the long end should stabilise." },
  { id: "no.source", source: "", expect: "clean",
    why: "nothing to check against — must not flag everything",
    body: "An unexpected, unanimous, record hike." },
];

/* ═══════════════════════════════════════════════════════════════════
   composeNote — the note's final ORDER and what it EXCLUDES.

   This decides what a client reads first and what never reaches the page,
   and until v0.35.1 none of it was under test. The QC pass that added these
   found two claims about it that were false: excluded legs were said to be
   "retained with a reason" and overridable, when nothing rendered them and
   no override existed.

   Pinned here: immediate legs lead, score orders within each group, a leg
   below MIN_EV_ON_RISK is excluded and REPORTED, and forceCarry lets the
   analyst carry it anyway.
   ═══════════════════════════════════════════════════════════════════ */
const composeLeg = (id, tk, { execution = "scaled", score, ev, evOnRisk, direction = "bearish" }) => ({
  id, subject: tk, direction, basis: "stated", evidence: "", rationale: "",
  execution, stopMode: "wall", secondary: [], levered: [], structures: [],
  /* Walls and closes so the composed note carries a wall sentence and
     environment facts (0.38.0): the call wall is 4% above, inside the 7%
     band, so a bearish leg reads "resistance nearby at 104". */
  vol: { iv30: 30, rv30: 30, callWall: 104, putWall: 90 },
  primary: { t: tk, price: 100, liq: "A", closes: Array.from({ length: 70 }, (_, i) => 95 + (i % 10)),
    plan: { execution, spot: 100, entry: 100, stop: 105, riskPct: 5, rungs: [{ px: 100, w: 1 }] },
    tgt: { dn: 90, up: 110, struct: 95 },
    shareScore: { score, expectancy: ev, evOnRisk, riskPct: 5, pStopped: 20, pop: 60 } },
});
const pickAll = menus => ({ sel: Object.fromEntries(menus.map(m =>
  [`${m.id}:${m.primary.t}`, { themeId: m.id, ticker: m.primary.t, kind: "primary" }])) });

const COMPOSE_MENUS = [
  composeLeg("gold",  "GLD",  { execution: "scaled",    score: 0.81, ev: 5.5, evOnRisk: 0.76 }),
  composeLeg("silver","SLV",  { execution: "immediate", score: 0.71, ev: 4.9, evOnRisk: 0.53 }),
  composeLeg("crypto","IBIT", { execution: "immediate", score: 0.78, ev: 7.7, evOnRisk: 0.62 }),
  composeLeg("dollar","UUP",  { execution: "scaled",    score: 0.57, ev: 0.24, evOnRisk: 0.044 }),
];

export const COMPOSE_CASES = [
  { id: "order.immediate-first-then-score",
    why: "IBIT and SLV are immediate and lead; GLD scores highest overall but is scaled, so it follows; UUP is gated out",
    menus: COMPOSE_MENUS, settings: {} },
  { id: "gate.force-carry",
    why: "UUP at EV/risk 0.044 is below the gate; forceCarry must put it back in the note",
    menus: COMPOSE_MENUS, settings: { forceCarry: ["UUP"] } },
].map(c => ({ ...c, parsed: { themes: c.menus.map(m => ({ id: m.id })) }, picks: pickAll(c.menus) }));
