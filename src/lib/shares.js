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
const pdf = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 1));

/* Five equal-distance executions from the last sale into the wall being
   faded, weighted toward the wall — the call wall on a bearish leg, the
   put wall on a bullish one. Inside NEAR_WALL of that wall there is no room
   left to ladder, so proximity forces immediate regardless of what the
   analyst selected, and the position goes on at current levels. */
export function scalePlan(spot, v, direction, { mode = "wall", execution = "scaled" } = {}) {
  const bear = direction === "bearish";
  const sgn  = bear ? 1 : -1;
  if (!spot) return null;
  /* The wall actually usable as resistance, not merely the biggest strike —
     a wall spot has already traded through is not something to scale into. */
  const [wall, wallFrom] = entryWall(spot, v, direction);

  /* No usable option chain means no open-interest wall, and the whole scale
     plan is anchored to one. The tool's own key says grade X is "shares
     only" — but the shares leg used to be built inside the options gate, so
     an X ticker produced no plan, no target, no expectancy, and dropped out
     of the ETF table entirely. NCLD did exactly that: it won its theme on
     fit 0.656 and then vanished from the note.
     Without a wall there is nothing to ladder into and nothing to stop 1%
     beyond, so the position goes on at current levels with the flat stop.
     The leg is marked so the note can say the levels are not wall-derived. */
  if (!wall) {
    const entry = spot;
    const stop  = entry * (1 + sgn * STOP_FLAT);
    RunLog.info("calc", "plan.no.wall",
                { ticker: v.ticker, direction, spot, stopMode: "flat", pct: STOP_FLAT * 100 });
    return {
      single: true, execution: "immediate", noWall: true, mode: "flat",
      reason: "no usable option chain — no wall to scale into, so the position goes on at current levels",
      wall: null, rungs: [{ px: spot, w: 1 }], entry, stop, stopWall: null, stopFlat: stop,
      entryImprovementPct: 0,
      riskPct: (Math.abs(stop - entry) / entry) * 100,
      distToWallPct: null,
    };
  }

  const dist = Math.abs(wall - spot) / spot;
  const stopWall = wall * (1 + sgn * STOP_WALL);
  /* Inside NEAR_WALL there is no room to ladder, so proximity forces
     immediate even when the analyst has asked for a scale. The wall in
     question is the one being faded: the call wall on a bearish leg, the put
     wall on a bullish one. */
  const near   = dist < NEAR_WALL;
  const single = execution === "immediate" || near;
  const reason = !single ? null
    : execution === "immediate" ? "analyst set immediate"
    : `last sale is ${(dist * 100).toFixed(1)}% from the ${bear ? "call" : "put"} wall at ${wall}, inside the ${NEAR_WALL * 100}% band — no room to ladder`;
  if (near && execution !== "immediate")
    RunLog.info("calc", "execution.auto.immediate",
                { ticker: v.ticker, direction, spot, wall, distPct: +(dist * 100).toFixed(2), band: NEAR_WALL * 100 });

  const rungs = single ? [{ px: spot, w: 1 }]
                       : WEIGHTS.map((w, k) => ({ px: spot + (wall - spot) * k / 4, w }));
  const entry = rungs.reduce((s, r) => s + r.px * r.w, 0);
  const stopFlat = entry * (1 + sgn * STOP_FLAT);
  const stop = mode === "wall" ? stopWall : stopFlat;

  return {
    single, execution: single ? "immediate" : "scaled", reason, wallFrom, spot,
    wall, rungs, entry, stop, stopWall, stopFlat, mode,
    entryImprovementPct: ((entry - spot) / spot) * 100 * sgn,   // positive = better than spot
    riskPct: (Math.abs(stop - entry) / entry) * 100,
    distToWallPct: dist * 100,
  };
}

/* Two derived levels, no invented ones: the opposite open-interest wall,
   and the option-implied one-sigma range over the horizon. */
/* How far the target wall must sit from spot to be a target at all. Inside
   this there is no trade to measure — the reward rounds to nothing and the
   leg scores near zero however good the idea is. */
export const MIN_TARGET_TRAVEL = 0.01;

/* The wall the position exits into: the put wall on a bearish leg, the call
   wall on a bullish one.

   Two ways the top wall is unusable, both of which SLV hit at once. It can be
   the SAME strike as the entry wall — the two selectors in analyzeChain
   overlap by 4% of spot, so a dominant strike near spot is eligible to be
   both. And it can sit inside MIN_TARGET_TRAVEL of spot, leaving nothing to
   travel. Either way the leg scores near zero for a reason that has nothing
   to do with the idea: SLV at 60/60 came out at an expectancy of 0.04 on a
   44.5%-vol name whose own implied range was 51 to 69.

   So step down the OI ladder to the next wall that is genuinely beyond spot,
   and if none qualifies, return null and let the caller fall back to the
   one-sigma target. The walls PRINTED in the note are untouched — this
   governs the target, which is never published. */
/* One rule, applied to both walls. A wall is only usable if it lies at least
   MIN_TARGET_TRAVEL beyond spot in the direction it is meant to serve —
   above for the entry wall on a bearish leg, below for the exit wall — and
   is not the strike already doing the other job.

   `above` = the wall must sit above spot. */
function usableWall(spot, ladder, { above, exclude }) {
  if (!spot || !ladder?.length) return [null, null];
  const ok = ladder.filter(w => {
    if (w.strike == null || w.strike === exclude) return false;
    const travel = (w.strike - spot) / spot;
    return above ? travel >= MIN_TARGET_TRAVEL : travel <= -MIN_TARGET_TRAVEL;
  });
  return ok.length ? [ok[0].strike, ladder[0]] : [null, ladder[0]];
}

const asLadder = (list, single) => list || (single != null ? [{ strike: single }] : []);

/* The wall the position is SCALED INTO and stopped beyond: the call wall on a
   bearish leg, the put wall on a bullish one.

   It has the same failure as the exit wall and it bit on the same leg. SLV's
   call wall printed at 60 while spot was 60.18 — price was already THROUGH
   the resistance, so the ladder had nowhere to run and the stop sat 1% above
   a level that had just failed, 0.7% from spot on a name that moves 12% in a
   month. Stepping to the next call wall up is the mirror of the exit rule,
   and it is market structure rather than an arbitrary volatility floor. */
export function entryWall(spot, v, direction) {
  const bear = direction === "bearish";
  const ladder = asLadder(bear ? v.callWalls : v.putWalls, bear ? v.callWall : v.putWall);
  const [chosen, top] = usableWall(spot, ladder, { above: bear, exclude: null });
  if (chosen == null) return [null, "none"];
  const stepped = top && chosen !== top.strike;
  if (stepped)
    RunLog.info("calc", "entry.wall.stepped", {
      ticker: v.ticker, direction, spot, skipped: top.strike,
      why: (bear ? top.strike <= spot : top.strike >= spot)
             ? "spot is already through it — no longer resistance"
             : `only ${Math.abs((top.strike - spot) / spot * 100).toFixed(1)}% from spot`,
      used: chosen, distPct: +Math.abs((chosen - spot) / spot * 100).toFixed(1),
    });
  return [chosen, stepped ? "wall.next" : "wall"];
}

export function exitWall(spot, v, direction) {
  const bear = direction === "bearish";
  const [entryTk] = entryWall(spot, v, direction);
  const ladder = asLadder(bear ? v.putWalls : v.callWalls, bear ? v.putWall : v.callWall);
  const [chosen, top] = usableWall(spot, ladder, { above: !bear, exclude: entryTk });
  if (chosen == null) return [null, "sigma"];
  const stepped = top && chosen !== top.strike;
  if (stepped)
    RunLog.info("calc", "target.wall.stepped", {
      ticker: v.ticker, direction, spot, skipped: top.strike,
      why: top.strike === entryTk ? "same strike as the entry wall"
         : `only ${Math.abs((top.strike - spot) / spot * 100).toFixed(1)}% from spot`,
      used: chosen, travelPct: +((chosen - spot) / spot * 100).toFixed(1),
    });
  return [chosen, stepped ? "wall.next" : "wall"];
}

export function targets(spot, v, direction, horizonDays = 42) {
  /* Implied vol where there is a chain, realised where there is not. With no
     walls the structural target falls back to a one-sigma move, which is the
     same quantity the note already prints as its range — no invented level,
     just the one the tool already trusts. */
  const vol = v.iv30 != null ? v.iv30 : v.rv30;
  const sd = vol != null ? (vol / 100) * Math.sqrt(horizonDays / 365) : null;
  const [wallTgt, tgtFrom] = exitWall(spot, v, direction);
  const struct = wallTgt ?? (sd ? spot * (1 + (direction === "bearish" ? -1 : 1) * sd) : null);
  return {
    struct, structFrom: wallTgt ? tgtFrom : "sigma", volFrom: v.iv30 != null ? "implied" : "realised",
    volWindow: v.iv30 != null ? null : (v.rvWindow ?? 30),
    structPct: struct && spot ? ((struct - spot) / spot) * 100 : null,
    sd: sd ? sd * 100 : null,
    up: sd ? spot * (1 + sd) : null,
    dn: sd ? spot * (1 - sd) : null,
  };
}

/* Expectancy on the share leg, same components and weights as the option
   engine so the two are directly comparable. */
export function scoreShares(plan, tgt, v, { direction, conviction = "medium", horizonDays = 42, liq = "A" }) {
  const vol = v.iv30 ?? v.rv30;
  if (!plan || !tgt || vol == null) return null;

  /* THE STOPPED QUADRATURE — the same integral the options side runs,
     replacing the two-point target/stop model.

     The old model asked two questions — reach the target, or hit the stop —
     and everything in between was worth exactly zero. Most outcomes live in
     between: silver drifting 4% in your favour and sitting there scored
     nothing, which is how a 44.5%-vol name printed an expectancy of 0.04.
     Worse, the target was always a CAP: GLD's whole reward was truncated at
     a put wall 1.1% away no matter how far gold could actually fall.

     Now every landing point is counted at its mark-to-market, weighted by
     likelihood — the easiest possible integral, since shares are linear.
     The structural target is RETIRED from the arithmetic. It remains in tgt
     for display; nothing here reads it.

     The stop is priced as a BARRIER, which is what a stop is. Quadrature
     only sees where price ends, and two paths ending at the same place can
     differ — one touched the stop and came back. The Brownian-bridge
     hitting probability is exact for that under GBM, one exp per node,
     drift-free because conditioning on both endpoints removes the drift:

        P(touched B | started S0, ended S) = exp(-2 ln(B/S0) ln(B/S) / sd^2)

     The two-point model understated stop risk 2.5-3x across the 9 Sep note
     because it asked whether price FINISHES beyond the stop; a stop fires
     when touched. pStopped below is the honest number.

     RANKED FROM SPOT, executed on the ladder. The ladder inflated R:R 2-10x
     by measuring reward from a flattered entry and risk over a shortened
     distance — and it moved shares relative to options on the same theme,
     since a debit does not care where you scale. The plan keeps its own
     entry-based riskPct for the note, whose caption promises execution
     economics; the RANKING risk below is spot to stop. */
  /* PURITY SCALES THE DRIFT. The view moves the part of the vehicle that
     expresses it; the rest is that vehicle's own beta, which you have no
     view on. Exhibit 1 already prints "GDX: indirect proxy (0.60) — carries
     its own beta", and the ranking then scored GDX as though a bearish gold
     view moved every dollar of it. Stated in prose, absent from the score.

     Only the drift is scaled. The WIDTH is already right, because the
     vehicle's own implied vol contains the non-thesis beta as variance —
     so an impure proxy correctly gets the same noise and less signal, which
     is exactly what being an indirect proxy means. */
  const bear = direction === "bearish";
  const purity = clamp01(v.purity ?? 1);
  const sd   = (vol / 100) * Math.sqrt(horizonDays / 365);
  const mu   = (bear ? -1 : 1) * purity * (DRIFT[conviction] ?? 0.6) * sd;
  const spot = plan.spot ?? plan.rungs?.[0]?.px ?? plan.entry;
  const med  = spot * Math.exp(mu - sd * sd / 2);
  const stop = plan.stop;

  const riskPct  = (Math.abs(stop - spot) / spot) * 100;      // spot to stop
  const stopPL   = -riskPct;                                   // stopped out = the risk, in %
  const term     = S => (bear ? (spot - S) / spot : (S - spot) / spot) * 100;
  const beyond   = S => bear ? S >= stop : S <= stop;
  const lnBS0    = Math.log(stop / spot);

  let ev = 0, pWin = 0, pStopped = 0, wsum = 0;
  for (let z = -3.6; z <= 3.6; z += 0.05) {
    const S = med * Math.exp(sd * z);
    const w = pdf(z);
    let pTouch;
    if (beyond(S)) pTouch = 1;
    else {
      const x = -2 * lnBS0 * Math.log(stop / S) / (sd * sd);
      pTouch = Math.min(1, Math.exp(x));
    }
    const pl = pTouch * stopPL + (1 - pTouch) * term(S);
    ev += w * pl; pStopped += w * pTouch; wsum += w;
    if (pl > 0) pWin += w;
  }
  ev /= wsum; pStopped /= wsum; pWin /= wsum;

  const expectancy = ev;                                       // % of notional over the hold
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
    pop:       nz(pWin, NORM.pop),
    convexity: nz(convexity, NORM.convexity),
    carry:     1 - nz(carryPct / 100, NORM.carry),
    exec:      1 - nz(execPct / 100, NORM.exec),
    riskDef:   nz(riskDef, NORM.riskDef),
  };
  const score = Object.entries(WEIGHTS_SCORE).reduce((s2, [k, w]) => s2 + w * parts[k], 0);

  const out = {
    kind: "shares", score: +score.toFixed(3), parts,
    expectancy: +expectancy.toFixed(2), evOnRisk: +evOnRisk.toFixed(3),
    pop: +(pWin * 100).toFixed(1),
    pStopped: +(pStopped * 100).toFixed(1),                    // honest touch probability
    riskPct: +riskPct.toFixed(2),                              // spot to stop — ranking risk
    riskSigma: +(riskPct / (sd * 100)).toFixed(2),
    sdPct: +(sd * 100).toFixed(1), impliedMove: +(mu / sd).toFixed(2),
    purity: +purity.toFixed(2), purityFrom: v.purityFrom ?? "stated",
    rankedFrom: "spot",
    riskDef,
  };
  RunLog.fact(`shares.${v.ticker}`, { score: out.score, ev: out.expectancy,
    pStopped: out.pStopped, riskPct: out.riskPct,
    purity: out.purity, purityFrom: out.purityFrom }, { src: "shares/quadrature" });
  return out;
}
