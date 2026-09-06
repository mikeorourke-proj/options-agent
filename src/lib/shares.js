/* ═══════════════════════════════════════════════════════════════════
   shares.js — the ETF expression, scored on the same scale as options

   Reward-to-risk is scale-invariant, so it cannot distinguish a target
   one standard deviation away from one a third of a deviation away.
   IBIT's 3.3:1 looks better than gold's 2.1:1 until you notice the
   target is 1.10 sigma out against gold's 0.67 — a very different
   probability of ever getting there.

   So the ETF leg is scored the way the options are: expectancy under a
   distribution shifted by the stated conviction. That puts shares and
   structures on one number, and "short IBIT or a GLD put spread" becomes
   a question with an answer.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";
import { N, NORM, WEIGHTS_SCORE, nz } from "./pricing.js";

export const WEIGHTS   = [0.10, 0.15, 0.20, 0.25, 0.30];
export const NEAR_WALL = 0.02;   // inside this there is no room to ladder
export const STOP_WALL = 0.01;   // preferred stop: 1% beyond the wall
export const STOP_FLAT = 0.05;   // alternative: flat 5% from the entry
const DRIFT = { high: 1.0, medium: 0.6, low: 0.3 };

/* Five equal-distance executions from the last sale into the wall being
   faded, weighted toward the wall. Inside 2%, or when the analyst asks
   for immediate, the position goes on at the last sale. */
export function scalePlan(spot, v, direction, { mode = "wall", execution = "scaled" } = {}) {
  const bear = direction === "bearish";
  const wall = bear ? v.callWall : v.putWall;
  if (!spot || !wall) return null;

  const sgn  = bear ? 1 : -1;
  const dist = Math.abs(wall - spot) / spot;
  const stopWall = wall * (1 + sgn * STOP_WALL);
  const single = execution === "immediate" || dist < NEAR_WALL;

  const rungs = single ? [{ px: spot, w: 1 }]
                       : WEIGHTS.map((w, k) => ({ px: spot + (wall - spot) * k / 4, w }));
  const entry = rungs.reduce((s, r) => s + r.px * r.w, 0);
  const stopFlat = entry * (1 + sgn * STOP_FLAT);
  const stop = mode === "wall" ? stopWall : stopFlat;

  return {
    single, execution: single ? "immediate" : "scaled",
    reason: single ? (execution === "immediate" ? "analyst set immediate"
                                                : `within ${NEAR_WALL * 100}% of the wall`) : null,
    wall, rungs, entry, stop, stopWall, stopFlat, mode,
    entryImprovementPct: ((entry - spot) / spot) * 100 * sgn,   // positive = better than spot
    riskPct: (Math.abs(stop - entry) / entry) * 100,
    distToWallPct: dist * 100,
  };
}

/* Two derived levels, no invented ones: the opposite open-interest wall,
   and the option-implied one-sigma range over the horizon. */
export function targets(spot, v, direction, horizonDays = 42) {
  const struct = direction === "bearish" ? v.putWall : v.callWall;
  const sd = (v.iv30 != null ? v.iv30 / 100 : null) * Math.sqrt(horizonDays / 365);
  return {
    struct,
    structPct: struct && spot ? ((struct - spot) / spot) * 100 : null,
    sd: sd ? sd * 100 : null,
    up: sd ? spot * (1 + sd) : null,
    dn: sd ? spot * (1 - sd) : null,
  };
}

/* Expectancy on the share leg, same components and weights as the option
   engine so the two are directly comparable. */
export function scoreShares(plan, tgt, v, { direction, conviction = "medium", horizonDays = 42, liq = "A" }) {
  if (!plan || !tgt?.struct || v.iv30 == null) return null;

  const bear = direction === "bearish";
  const sd   = (v.iv30 / 100) * Math.sqrt(horizonDays / 365);
  const mu   = (bear ? -1 : 1) * (DRIFT[conviction] ?? 0.6) * sd;
  const med  = plan.entry * Math.exp(mu);

  const rewardPct = (Math.abs(plan.entry - tgt.struct) / plan.entry) * 100;
  const riskPct   = plan.riskPct;

  // Lognormal probabilities under the view-shifted median
  const pTarget = bear ? N(Math.log(tgt.struct / med) / sd) : 1 - N(Math.log(tgt.struct / med) / sd);
  const pStop   = bear ? 1 - N(Math.log(plan.stop / med) / sd) : N(Math.log(plan.stop / med) / sd);
  const pProfit = bear ? N(Math.log(plan.entry / med) / sd) : 1 - N(Math.log(plan.entry / med) / sd);

  const expectancy = pTarget * rewardPct - pStop * riskPct;   // in % of notional
  const evOnRisk   = riskPct > 0 ? expectancy / riskPct : 0;

  /* Shares are linear and uncapped, so full convexity; no theta, so no
     carry beyond borrow, which is immaterial over six weeks on a grade-A
     ETF. Both are genuine structural advantages over a dated option and
     are exactly why an undated thesis favours the underlying. */
  const convexity = 1.0;
  const carryPct  = 0.15;                                   // borrow/financing, ~6wk
  const execPct   = { A: 0.03, B: 0.08, C: 0.20, X: 0.40 }[liq] ?? 0.10;
  /* A stop is an intention, not a contract. The loss on a share position is
     bounded only as well as the market lets you exit; a grade-A ETF with a
     stop 2-4% away is fairly reliable, a thin one is not. */
  const riskDef   = ({ A: 0.40, B: 0.30, C: 0.20, X: 0.10 })[liq] ?? 0.25;

  const parts = {
    evOnRisk:  nz(evOnRisk, NORM.evOnRisk),
    pop:       nz(pProfit, NORM.pop),
    convexity: nz(convexity, NORM.convexity),
    carry:     1 - nz(carryPct / 100, NORM.carry),
    exec:      1 - nz(execPct / 100, NORM.exec),
    riskDef:   nz(riskDef, NORM.riskDef),
  };
  const score = Object.entries(WEIGHTS_SCORE).reduce((s2, [k, w]) => s2 + w * parts[k], 0);

  const out = {
    kind: "shares", score: +score.toFixed(3), parts,
    expectancy: +expectancy.toFixed(2), evOnRisk: +evOnRisk.toFixed(3),
    pop: +(pProfit * 100).toFixed(1),
    pTarget: +(pTarget * 100).toFixed(1), pStop: +(pStop * 100).toFixed(1),
    rewardPct: +rewardPct.toFixed(2), riskPct: +riskPct.toFixed(2),
    rr: riskPct > 0 ? +(rewardPct / riskPct).toFixed(2) : null,
    rewardSigma: +(rewardPct / (sd * 100)).toFixed(2),   // how ambitious the target is
    riskSigma:   +(riskPct   / (sd * 100)).toFixed(2),
    sdPct: +(sd * 100).toFixed(1), impliedMove: +(mu / sd).toFixed(2),
    // Honest asymmetry against the options: a stop is not a guarantee.
    riskDef,
  };
  RunLog.fact(`shares.${v.ticker}`, { score: out.score, rr: out.rr, ev: out.expectancy,
                                      rewardSigma: out.rewardSigma }, { src: "shares/expectancy" });
  return out;
}
