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

  { id: "GDX.bearish.impure-proxy", note: "synthetic",
    spot: 61.20, direction: "bearish", conviction: "medium", horizonDays: 28,
    vol: { ticker: "GDX", iv30: 38.0, rv30: 36.5, rr25: -3.40, termSlope: 1.05,
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
