/* ═══════════════════════════════════════════════════════════════════
   strategy.js — structure selection

   A readable decision table, deliberately not a model. A note carries
   the desk's name: "we sold the 102 call because it holds 23% of
   near-dated call OI" is defensible; "the model chose it" is not.

   Every branch is a line you can argue with. Disagreeing means editing
   a threshold, not rewriting a prompt.
   ═══════════════════════════════════════════════════════════════════ */
import { rankExpiries, dte } from "./vol.js";

/* Vol state from the chain, with thresholds in one place. */
export function volState(v, rv) {
  const vrp = (v.iv30 != null && rv != null) ? +(v.iv30 - rv).toFixed(1) : null;
  return {
    vrp,
    rich:  vrp != null && vrp >= 4,          // implied well over realised
    cheap: vrp != null && vrp <= 0,          // implied at or under realised
    putSkew:  v.rr25 != null && v.rr25 <= -3,   // puts bid: fear priced
    callSkew: v.rr25 != null && v.rr25 >= 1,    // calls bid: greed priced
    backwardation: v.termSlope != null && v.termSlope <= 0.90,
    contango:      v.termSlope != null && v.termSlope >= 1.10,
    negGamma: v.netGex != null && v.netGex < 0,
  };
}

/* Returns up to `max` structures, best fit first. Strikes are chosen in
   the structure step; here we commit only to shape and expiry. */
export function suggestStructures(view, v, rv, {
  catalystDate, horizon = "weeks", conviction = "medium", liq = "B", max = 2,
} = {}) {
  const s = volState(v, rv);
  const blind = v.iv30 == null;   // no vol read: only the baseline is honest
  const expiryCandidates = rankExpiries(v.expiries, catalystDate, horizon, 5, new Date(), v.expiryOI);
  const expiry = expiryCandidates[0];
  const days = expiry ? dte(expiry) : null;
  const out = [];
  const add = (id, name, legs, why, needs = "B") => out.push({ id, name, legs, why, expiry, expiryCandidates, days, needs });

  const thin = liq === "C" || liq === "X";

  if (view === "bullish" && !blind) {
    if (s.cheap || (s.putSkew && !s.rich))
      add("long_call", "Long call", "Buy ~50Δ call",
          s.cheap ? `Implied ${v.iv30}% is at or under realised ${rv}% — own convexity outright.`
                  : `25Δ risk reversal ${v.rr25} — downside is bid, upside is not.`);
    if (s.rich || thin === false)
      add("call_spread", "Call spread", "Buy ~50Δ call / sell the call wall",
          v.callWall ? `Sell into the ${v.callWall} call wall (${v.callWallConc}% of near-dated call OI).`
                     : `Implied ${v.iv30}% over realised ${rv}% — fund the long by selling a wing.`);
    if (s.putSkew && conviction === "high" && !thin)
      add("risk_reversal", "Risk reversal", "Sell ~25Δ put / buy ~25Δ call",
          `Puts richer than calls by ${Math.abs(v.rr25)} vol pts — collect that to finance upside.`, "A");
    if (s.backwardation && !thin)
      add("call_calendar", "Call calendar", "Sell front call / buy back call",
          `Front/back ${v.termSlope} — near-term vol is expensive relative to deferred.`, "A");
  }

  if (view === "bearish" && !blind) {
    if (s.cheap || s.callSkew)
      add("long_put", "Long put", "Buy ~50Δ put",
          s.cheap ? `Implied ${v.iv30}% is at or under realised ${rv}% — protection is cheap.`
                  : `25Δ risk reversal ${v.rr25} — calls bid, puts comparatively neglected.`);
    if (s.rich || s.putSkew)
      add("put_spread", "Put spread", "Buy ~50Δ put / sell the put wall",
          v.putWall ? `Sell into the ${v.putWall} put wall (${v.putWallConc}% of near-dated put OI) to cut premium.`
                    : `Implied ${v.iv30}% over realised ${rv}% — spread rather than pay full premium.`);
    if (s.putSkew && !thin)
      add("put_backspread", "Put ratio backspread", "Sell 1 near put / buy 2 further puts",
          `Steep put skew (${v.rr25}) makes the ratio financeable — convex if the move is violent.`, "A");
    if (s.rich && conviction !== "high" && !thin)
      add("call_spread_bear", "Bear call spread", "Sell the call wall / buy above",
          `Credit structure. Wins on time and on a failure to reclaim ${v.callWall ?? "resistance"}.`, "A");
  }

  if (view === "neutral" && !blind) {
    if (s.rich && v.maxPain && !thin)
      add("iron_fly", "Iron fly at max pain", `Straddle at ${v.maxPain}, wings bought`,
          `Implied over realised by ${s.vrp} pts with pin risk at ${v.maxPain}.`, "A");
    if (s.cheap && !thin)
      add("straddle", "Long straddle", "Buy ATM call and put",
          `Implied ${v.iv30}% under realised ${rv}% — own the move, direction unspecified.`);
  }

  /* A directional view must always produce something. Without this a
     bearish theme in a neutral vol regime returned nothing at all. */
  if (view === "bullish" && !out.some(o => o.id === "call_spread"))
    add("call_spread", "Call spread", "Buy ~50Δ call / sell above",
        v.callWall ? `Baseline structure. Sell into the ${v.callWall} call wall (${v.callWallConc}% of near-dated call OI).`
                   : `Baseline defined-risk structure; vol offers no strong steer either way.`);
  if (view === "bearish" && !out.some(o => o.id === "put_spread"))
    add("put_spread", "Put spread", "Buy ~50Δ put / sell below",
        v.putWall ? `Baseline structure. Sell into the ${v.putWall} put wall (${v.putWallConc}% of near-dated put OI).`
                  : `Baseline defined-risk structure; vol offers no strong steer either way.`);

  /* Gates. Thin chains cannot support multi-leg structures; low
     conviction should not carry undefined risk. */
  const rank = { A: 3, B: 2, C: 1, X: 0 };
  let keep = out.filter(o => rank[liq] >= rank[o.needs]);
  if (conviction === "low") keep = keep.filter(o => !["risk_reversal", "put_backspread"].includes(o.id));

  // If gating removed everything, fall back to the simplest outright.
  if (!keep.length && out.length) keep = [out.find(o => o.needs !== "A") || out[0]];

  return keep.slice(0, max).map(o => ({
    ...o, blind,
    why: blind ? `${o.why} No implied-vol read on this chain, so this is a default rather than a vol-driven choice.` : o.why,
    gatedOut: out.filter(x => !keep.includes(x)).map(x => x.name),
  }));
}
