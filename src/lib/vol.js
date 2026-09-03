/* ═══════════════════════════════════════════════════════════════════
   vol.js — options chain analytics

   Everything here is arithmetic on the chain. No model involvement:
   these numbers appear in a published note and must be reproducible
   and auditable.

   Filtering discipline matters more than the formulas. The probe
   returned a TLT 0DTE $67 call with delta 0.99 and IV of 492% — deep
   ITM near-expiry contracts carry garbage vols and will poison any
   average that does not exclude them.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";

const DAY = 864e5;
export const dte = (expiry, from = new Date()) =>
  Math.round((new Date(expiry + "T00:00:00Z") - from) / DAY);

/* Contracts usable for analytics: priced, with greeks, sane IV, and
   not so far ITM/OTM that the vol is meaningless. */
function usable(contracts, now) {
  return contracts.filter(c => {
    const g = c.greeks, d = c.details;
    if (!g || !d || typeof g.delta !== "number") return false;
    const iv = c.implied_volatility;
    if (!(iv > 0.02 && iv < 3.0)) return false;          // 2%–300%
    const ad = Math.abs(g.delta);
    if (ad < 0.02 || ad > 0.98) return false;            // drop deep wings/ITM
    const t = dte(d.expiration_date, now);
    return t >= 1 && t <= 400;
  });
}

/* Interpolate IV at a target delta on one side of one expiry. */
function ivAtDelta(list, targetAbsDelta) {
  if (list.length < 2) return null;
  const s = [...list].sort((a, b) =>
    Math.abs(Math.abs(a.greeks.delta) - targetAbsDelta) -
    Math.abs(Math.abs(b.greeks.delta) - targetAbsDelta));
  const [a, b] = s;
  const da = Math.abs(a.greeks.delta), db = Math.abs(b.greeks.delta);
  if (Math.abs(da - targetAbsDelta) > 0.12) return null;   // nothing close enough
  if (da === db) return a.implied_volatility;
  const w = (targetAbsDelta - da) / (db - da);
  return a.implied_volatility + w * (b.implied_volatility - a.implied_volatility);
}

export function analyzeChain(ticker, contracts = [], spot = 0, now = new Date()) {
  const out = {
    ticker, spot, ok: false,
    iv30: null, rr25: null, termSlope: null, netGex: null,
    callWall: null, callWallOI: 0, callWallConc: 0,
    putWall: null, putWallOI: 0, putWallConc: 0,
    maxPain: null, expiries: [], contracts: 0, note: null,
  };
  const list = usable(contracts, now);
  out.contracts = list.length;
  if (!spot || list.length < 30) { out.note = `only ${list.length} usable contracts`; return out; }

  out.expiries = [...new Set(list.map(c => c.details.expiration_date))].sort();

  /* ── ATM IV on the front expiry ≥ 20 DTE (the standard 30-day proxy) */
  const frontExp = out.expiries.find(e => dte(e, now) >= 20) || out.expiries[out.expiries.length - 1];
  const front = list.filter(c => c.details.expiration_date === frontExp);
  const atm = front.filter(c => Math.abs(Math.abs(c.greeks.delta) - 0.5) < 0.12);
  if (atm.length) out.iv30 = +(atm.reduce((s, c) => s + c.implied_volatility, 0) / atm.length * 100).toFixed(1);

  /* ── 25-delta risk reversal: call IV minus put IV.
        Negative = puts bid (fear). Handbook treats extremes as contrarian. */
  const fc = front.filter(c => c.details.contract_type === "call");
  const fp = front.filter(c => c.details.contract_type === "put");
  const c25 = ivAtDelta(fc, 0.25), p25 = ivAtDelta(fp, 0.25);
  if (c25 != null && p25 != null) out.rr25 = +((c25 - p25) * 100).toFixed(2);

  /* ── Term structure: front ATM IV over back ATM IV.
        < 0.90 backwardation (near-term fear), > 1.10 steep contango. */
  const backExp = out.expiries.find(e => dte(e, now) >= 75);
  if (backExp && out.iv30) {
    const back = list.filter(c => c.details.expiration_date === backExp &&
                                  Math.abs(Math.abs(c.greeks.delta) - 0.5) < 0.12);
    if (back.length) {
      const bIv = back.reduce((s, c) => s + c.implied_volatility, 0) / back.length * 100;
      if (bIv > 0) out.termSlope = +(out.iv30 / bIv).toFixed(3);
    }
  }

  /* ── Walls and GEX on 7–45 DTE, OI ≥ 10 (handbook near-dated window) */
  const near = list.filter(c => { const t = dte(c.details.expiration_date, now); return t >= 7 && t <= 45; })
                   .filter(c => (c.open_interest || 0) >= 10);
  if (near.length > 10) {
    const callOI = {}, putOI = {};
    let gex = 0;
    for (const c of near) {
      const k = c.details.strike_price, oi = c.open_interest || 0;
      const isCall = c.details.contract_type === "call";
      (isCall ? callOI : putOI)[k] = ((isCall ? callOI : putOI)[k] || 0) + oi;
      const g = Math.abs(c.greeks.gamma || 0) * oi * 100 * spot * spot * 0.01;
      gex += isCall ? g : -g;
    }
    out.netGex = Math.round(gex);

    const pick = (obj, keep) => {
      const ent = Object.entries(obj).map(([k, v]) => [Number(k), v]).filter(([k]) => keep(k));
      if (!ent.length) return [null, 0, 0];
      const total = ent.reduce((s, [, v]) => s + v, 0);
      const [k, v] = ent.reduce((a, b) => b[1] > a[1] ? b : a);
      return [k, v, total ? +(v / total * 100).toFixed(1) : 0];
    };
    [out.callWall, out.callWallOI, out.callWallConc] = pick(callOI, k => k >= spot * 0.98);
    [out.putWall,  out.putWallOI,  out.putWallConc]  = pick(putOI,  k => k <= spot * 1.02);

    // max pain: strike minimising total intrinsic paid out
    const strikes = [...new Set([...Object.keys(callOI), ...Object.keys(putOI)].map(Number))]
      .filter(k => Math.abs(k - spot) / spot < 0.12).sort((a, b) => a - b);
    let best = null, bestPay = Infinity;
    for (const pin of strikes) {
      let pay = 0;
      for (const [k, oi] of Object.entries(callOI)) if (pin > +k) pay += (pin - +k) * oi;
      for (const [k, oi] of Object.entries(putOI))  if (+k > pin) pay += (+k - pin) * oi;
      if (pay < bestPay) { bestPay = pay; best = pin; }
    }
    out.maxPain = best;
  }

  out.ok = out.iv30 != null;
  RunLog.fact(`vol.${ticker}`, { iv30: out.iv30, rr25: out.rr25, term: out.termSlope, callWall: out.callWall, putWall: out.putWall },
              { src: "chain", usable: list.length, frontExp });
  return out;
}

/* Realised vol from daily closes, annualised. */
export function realisedVol(bars = [], window = 30) {
  if (bars.length < window + 1) return null;
  const px = bars.slice(-(window + 1)).map(b => b.c);
  const r = [];
  for (let i = 1; i < px.length; i++) r.push(Math.log(px[i] / px[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return +(Math.sqrt(v * 252) * 100).toFixed(1);
}

/* First listed expiry at least `buffer` days past the catalyst. When no
   catalyst is set, fall back to the horizon's natural window. */
export function chooseExpiry(expiries = [], catalystDate, horizon = "weeks", buffer = 5, now = new Date()) {
  if (!expiries.length) return null;
  const target = catalystDate
    ? dte(catalystDate, now) + buffer
    : ({ days: 10, weeks: 35, months: 90 })[horizon] || 35;
  const fwd = expiries.filter(e => dte(e, now) >= Math.max(target, 2));
  return fwd[0] || expiries[expiries.length - 1];
}
