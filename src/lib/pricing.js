/* ═══════════════════════════════════════════════════════════════════
   pricing.js — strike selection and view-conditional economics

   Why the ranking is conditional on the thesis
   -------------------------------------------
   Priced off implied vol, every structure has a risk-neutral expected
   value of zero. Ranking on that ties everything. The edge is not in the
   market's distribution, it is in yours — so the distribution is shifted
   by the move the stated conviction implies, and structures are scored on
   how well they monetise THAT move.

   This resolves the convexity question honestly: a large expected move
   favours the outright, a modest one favours the spread. Nothing needs to
   be hard-coded about which is "better".
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";

const SQ2PI = Math.sqrt(2 * Math.PI);
const pdf = x => Math.exp(-x * x / 2) / SQ2PI;

/* Abramowitz-Stegun 7.1.26 normal CDF, ~1e-7 accuracy. */
export function N(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
              - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

export function bs(S, K, T, sig, type, r = 0.045) {
  if (T <= 0 || sig <= 0) return Math.max(0, type === "call" ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  const df = Math.exp(-r * T);
  return type === "call" ? S * N(d1) - K * df * N(d2)
                         : K * df * N(-d2) - S * N(-d1);
}

/* Mark for a contract. Prefer a real quote mid; fall back to last trade;
   fall back to theoretical. Which source was used is carried through so
   the note can disclose it. */
export function mark(c, S, T) {
  const q = c.last_quote;
  if (q && q.bid > 0 && q.ask > 0 && q.ask >= q.bid) {
    const mid = (q.bid + q.ask) / 2;
    return { px: mid, spread: q.ask - q.bid, src: "quote" };
  }
  const px = c.day?.close ?? c.day?.vwap;
  if (px > 0) return { px, spread: null, src: "last" };
  const iv = c.implied_volatility;
  if (iv > 0) return { px: bs(S, c.details.strike_price, T, iv, c.details.contract_type), spread: null, src: "model" };
  return null;
}

const yrs = expiry => Math.max(1 / 365, (new Date(expiry + "T21:00:00Z") - Date.now()) / (365 * 864e5));

/* Nearest contract to a target delta, on one side of one expiry. */
function byDelta(list, type, target) {
  const side = list.filter(c => c.details.contract_type === type && c.greeks?.delta != null);
  if (!side.length) return null;
  return side.reduce((a, b) =>
    Math.abs(Math.abs(b.greeks.delta) - target) < Math.abs(Math.abs(a.greeks.delta) - target) ? b : a);
}

/* Nearest listed strike to a level — used to anchor short legs to walls,
   which is the defensible version of "sell the 102 call". */
function byStrike(list, type, level) {
  const side = list.filter(c => c.details.contract_type === type);
  if (!side.length || !level) return null;
  return side.reduce((a, b) =>
    Math.abs(b.details.strike_price - level) < Math.abs(a.details.strike_price - level) ? b : a);
}

/* ── Strike selection per structure ─────────────────────────────── */
export function buildLegs(structureId, contracts, expiry, spot, v) {
  const exp = contracts.filter(c => c.details?.expiration_date === expiry && c.greeks?.delta != null);
  if (exp.length < 4) return null;
  const L = (c, qty) => c && { qty, c, type: c.details.contract_type, k: c.details.strike_price };

  switch (structureId) {
    case "long_call":   { const a = byDelta(exp, "call", 0.50); return a && [L(a, +1)]; }
    case "long_put":    { const a = byDelta(exp, "put", 0.50);  return a && [L(a, +1)]; }
    case "call_spread": {
      const lo = byDelta(exp, "call", 0.50);
      const hi = byStrike(exp, "call", v.callWall) || byDelta(exp, "call", 0.25);
      return lo && hi && hi.details.strike_price > lo.details.strike_price ? [L(lo, +1), L(hi, -1)] : null;
    }
    case "put_spread": {
      const hi = byDelta(exp, "put", 0.50);
      const lo = byStrike(exp, "put", v.putWall) || byDelta(exp, "put", 0.25);
      return hi && lo && lo.details.strike_price < hi.details.strike_price ? [L(hi, +1), L(lo, -1)] : null;
    }
    case "call_spread_bear": {
      const sh = byStrike(exp, "call", v.callWall) || byDelta(exp, "call", 0.30);
      const lg = byDelta(exp, "call", 0.15);
      return sh && lg && lg.details.strike_price > sh.details.strike_price ? [L(sh, -1), L(lg, +1)] : null;
    }
    case "risk_reversal": {
      const p = byDelta(exp, "put", 0.25), c = byDelta(exp, "call", 0.25);
      return p && c ? [L(p, -1), L(c, +1)] : null;
    }
    case "put_backspread": {
      const sh = byDelta(exp, "put", 0.40), lg = byDelta(exp, "put", 0.20);
      return sh && lg && lg.details.strike_price < sh.details.strike_price ? [L(sh, -1), L(lg, +2)] : null;
    }
    case "straddle": {
      const c = byDelta(exp, "call", 0.50), p = byDelta(exp, "put", 0.50);
      return c && p ? [L(c, +1), L(p, +1)] : null;
    }
    case "iron_fly": {
      const c = byStrike(exp, "call", v.maxPain), p = byStrike(exp, "put", v.maxPain);
      const cw = byDelta(exp, "call", 0.15), pw = byDelta(exp, "put", 0.15);
      return c && p && cw && pw ? [L(c, -1), L(p, -1), L(cw, +1), L(pw, +1)] : null;
    }
    default: return null;
  }
}

const payoff = (legs, S) => legs.reduce((s, l) =>
  s + l.qty * 100 * Math.max(0, l.type === "call" ? S - l.k : l.k - S), 0);

/* ── Price the structure and derive its P&L geometry ────────────── */
export function priceStructure(legs, spot, expiry) {
  const T = yrs(expiry);
  let net = 0, spreadCost = 0, minOI = Infinity, srcs = new Set(), theta = 0;
  const legDetail = [];
  for (const l of legs) {
    const m = mark(l.c, spot, T);
    if (!m) return null;
    net += l.qty * m.px * 100;                       // >0 debit, <0 credit
    spreadCost += Math.abs(l.qty) * (m.spread ?? m.px * 0.04) * 100 * 0.5;
    theta += l.qty * (l.c.greeks?.theta || 0) * 100;
    minOI = Math.min(minOI, l.c.open_interest || 0);
    srcs.add(m.src);
    legDetail.push({
      action: l.qty > 0 ? "Buy" : "Sell", qty: Math.abs(l.qty),
      strike: l.k, type: l.type === "call" ? "call" : "put",
      px: +m.px.toFixed(2), delta: +(l.c.greeks?.delta ?? 0).toFixed(3),
      iv: l.c.implied_volatility ? +(l.c.implied_volatility * 100).toFixed(1) : null,
      oi: l.c.open_interest || 0, src: m.src,
      moneyness: +(((l.k - spot) / spot) * 100).toFixed(1),
    });
  }

  // Scan the payoff to get max gain, max loss and breakevens without
  // special-casing every structure.
  const lo = spot * 0.55, hi = spot * 1.55, steps = 900;
  let maxG = -Infinity, maxL = Infinity, maxAtEdge = false;
  const be = []; let prev = null;
  for (let i = 0; i <= steps; i++) {
    const S = lo + (hi - lo) * i / steps;
    const pl = payoff(legs, S) - net;
    if (pl > maxG) { maxG = pl; maxAtEdge = (i === 0 || i === steps); }
    if (pl < maxL) maxL = pl;
    if (prev !== null && Math.sign(pl) !== Math.sign(prev) && prev !== 0) {
      const Sp = lo + (hi - lo) * (i - 1) / steps;
      be.push(+(Sp + (S - Sp) * Math.abs(prev) / (Math.abs(prev) + Math.abs(pl))).toFixed(2));
    }
    prev = pl;
  }
  const risk = Math.max(1, -maxL);
  return {
    net, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0,
    maxGain: maxG, maxLoss: maxL, risk, breakevens: be,
    // Max gain sitting at the scan boundary means the payoff is uncapped;
    // quoting a finite ratio there would be an artefact of the scan range.
    uncapped: maxAtEdge,
    rr: maxAtEdge ? null : +(maxG / risk).toFixed(2),
    maxGainDisplay: maxAtEdge ? Infinity : maxG,
    theta, minOI, spreadCost, T, legDetail,
    priceSource: srcs.has("quote") ? "quote" : srcs.has("last") ? "last trade" : "model",
    payoffAt: S => payoff(legs, S) - net,
  };
}

/* ── View-conditional economics ─────────────────────────────────── */
const DRIFT = { high: 1.0, medium: 0.6, low: 0.3 };

export function scoreEconomics(pr, legs, spot, v, {
  direction, conviction = "medium", catalystDate, rv,
}) {
  const T = pr.T;
  const sig = ((v.iv30 ?? rv ?? 25) / 100);
  const sd = sig * Math.sqrt(T);
  const dir = direction === "bearish" ? -1 : direction === "bullish" ? 1 : 0;

  // The view: expected move, in implied standard deviations
  const mu = dir * (DRIFT[conviction] ?? 0.6) * sd;
  const median = spot * Math.exp(mu - sd * sd / 2);

  // Lognormal quadrature over the view-shifted distribution
  let ev = 0, pWin = 0, wsum = 0;
  for (let z = -3.6; z <= 3.6; z += 0.06) {
    const S = median * Math.exp(sd * z);
    const w = pdf(z);
    const pl = pr.payoffAt(S);
    ev += w * pl; wsum += w;
    if (pl > 0) pWin += w;
  }
  ev /= wsum; pWin /= wsum;

  // Ideal: an unlimited structure at the same outlay, i.e. all convexity kept
  let evIdeal = 0;
  for (let z = -3.6; z <= 3.6; z += 0.06) {
    const S = median * Math.exp(sd * z);
    const intrinsic = dir >= 0 ? Math.max(0, S - spot) : Math.max(0, spot - S);
    evIdeal += pdf(z) * intrinsic * 100;
  }
  evIdeal /= wsum;

  const evOnRisk  = ev / pr.risk;                                   // core
  const convexity = evIdeal > 0 ? Math.max(0, Math.min(1, ev / evIdeal)) : 0.5;

  // Theta burned before the catalyst is dead weight: you pay it to reach
  // the event, so it counts against a dated trade.
  const dToCat = catalystDate
    ? Math.max(0, (new Date(catalystDate) - Date.now()) / 864e5)
    : Math.max(0, T * 365 * 0.5);
  const carry = pr.debit > 0 ? Math.max(0, -pr.theta * dToCat) / pr.debit : 0;

  const exec = pr.debit > 0 ? pr.spreadCost / pr.debit : pr.spreadCost / pr.risk;

  const n = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  const parts = {
    evOnRisk:   n(evOnRisk, -0.25, 0.85),
    pop:        n(pWin, 0.20, 0.75),
    convexity:  n(convexity, 0.15, 0.85),
    carry:      1 - n(carry, 0.05, 0.60),
    exec:       1 - n(exec, 0.02, 0.25),
  };
  const score = 0.35 * parts.evOnRisk + 0.25 * parts.pop
              + 0.15 * parts.convexity + 0.15 * parts.carry + 0.10 * parts.exec;

  return {
    score: +score.toFixed(3), parts,
    ev: Math.round(ev), evOnRisk: +evOnRisk.toFixed(3),
    pop: +(pWin * 100).toFixed(1), convexity: +convexity.toFixed(2),
    carryPct: +(carry * 100).toFixed(1), execPct: +(exec * 100).toFixed(1),
    impliedMove: +(mu / sd || 0).toFixed(2), sdPct: +(sd * 100).toFixed(1),
  };
}

/* Reject before scoring, and log why — an empty list must explain itself. */
export function rejectReason(pr, legs, spot) {
  if (!pr) return "could not price all legs";
  if (pr.minOI < 100) return `open interest ${pr.minOI} on the thinnest leg`;
  if (pr.debit > spot * 100 * 0.25) return "outlay exceeds 25% of notional";
  if (pr.rr != null && pr.rr < 0.25) return `reward:risk ${pr.rr}`;
  if (!pr.breakevens.length && pr.credit === 0) return "no breakeven within +/-55%";
  return null;
}

/* Full pipeline for one candidate structure. */
export function evaluate(structure, contracts, spot, v, ctx) {
  /* Walk the expiry ladder nearest-first. A weekly may be too thin at the
     strikes this structure needs while the next listing is fine, so the
     liquidity gate selects the expiry rather than rejecting the idea. */
  const ladder = structure.expiryCandidates?.length ? structure.expiryCandidates : [structure.expiry];
  const tried = [];

  for (const expiry of ladder) {
    const legs = buildLegs(structure.id, contracts, expiry, spot, v);
    if (!legs) { tried.push(`${expiry}: strikes unavailable`); continue; }
    const pr = priceStructure(legs, spot, expiry);
    const reject = rejectReason(pr, legs, spot);
    if (reject) { tried.push(`${expiry}: ${reject}`); continue; }

    const econ = scoreEconomics(pr, legs, spot, v, ctx);
    RunLog.gate(`structure:${structure.id}`, true, {
      expiry, score: econ.score, rr: pr.rr, pop: econ.pop,
      skipped: tried.length ? tried : undefined,
    });
    return {
      ...structure, expiry, days: Math.round((new Date(expiry) - Date.now()) / 864e5),
      legs, pricing: pr, econ,
      legText: legs.map(l => `${l.qty > 0 ? "+" : ""}${l.qty} ${l.k}${l.type === "call" ? "C" : "P"}`).join(" / "),
    };
  }
  RunLog.gate(`structure:${structure.id}`, false, { reason: "no expiry cleared the gate", tried });
  return null;
}
