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
