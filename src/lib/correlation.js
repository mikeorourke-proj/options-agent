/* ═══════════════════════════════════════════════════════════════════
   correlation.js — how much of the note is one bet.

   The ranking is deliberately left alone. Correlation between the legs of
   an event note is EVIDENCE THE THESIS IS DOING WORK: if a liquidity-drain
   note produced four legs that did not move together, the common argument
   would be decoration. Demoting a leg for being correlated would bury the
   second-best expression of the very view the note is making.

   What correlation should inform is what ranking cannot say:

     SIZING. Four legs at 3-7% risk each, 0.8 correlated, is not four
     positions. It is one position at roughly four times the intended risk,
     and nothing in the note currently says so.

     THE OUTLIER. If correlation is evidence of catalyst response, then the
     suspicious leg is the one with LOW correlation to the others. Either it
     is genuinely independent — worth saying, because that is real
     diversification — or it does not respond to the catalyst and does not
     belong in a note built on one.

   Bars are already fetched for every primary vehicle (120 days, for the
   realised-vol read) and then discarded. This needs no new data.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";

/* Trailing correlation understates what matters here. These are assets
   CHOSEN because they respond to one catalyst, and realised correlation
   rises in stress — exactly when the sizing question bites. So the warning
   leans conservative: treat the trailing number as a floor. */
export const HIGH_RHO = 0.60;     // above this, the basket is one position
export const LOW_RHO  = 0.25;     // |rho| below this, the leg is not in the trade
                                  // and below -HIGH_RHO it is a hedge

const closes = bars => (bars || [])
  .map(b => (typeof b === "number" ? b : b?.c))
  .filter(p => typeof p === "number" && p > 0);

/* Log returns, aligned to the shortest series. Alignment by TAIL, not head:
   a fund that listed five weeks ago has fewer bars, and its recent window is
   the one that overlaps everyone else's. */
function returnsOf(bars, n) {
  const px = closes(bars);
  const use = px.slice(Math.max(0, px.length - n - 1));
  const r = [];
  for (let i = 1; i < use.length; i++) r.push(Math.log(use[i] / use[i - 1]));
  return r;
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;                      // too short to mean anything
  const x = a.slice(a.length - n), y = b.slice(b.length - n);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const u = x[i] - mx, v = y[i] - my;
    num += u * v; dx += u * u; dy += v * v;
  }
  if (dx <= 0 || dy <= 0) return null;
  return +(num / Math.sqrt(dx * dy)).toFixed(3);
}

/* legs: [{ ticker, bars, riskPct, direction }] — one per carried theme.
   Returns null for a single-leg note, where none of this applies.

   Returns are SIGNED BY DIRECTION, so what is correlated is the POSITIONS,
   not the underlyings. On 16 Sep a note carried a bearish SMH leg and a
   bullish QQQ leg; the two assets correlate at 0.90, and the first build
   duly reported a concentrated cluster that would "stop together". They
   would do the opposite — one stops on a rally, the other on a selloff.
   Signing the returns turns an asset correlation of +0.90 into a position
   correlation of -0.90, which is a hedge and reduces aggregate risk. */
export function analyzeCorrelation(legs, { window = 60 } = {}) {
  const usable = (legs || [])
    .map(l => {
      const sign = l.direction === "bearish" ? -1 : 1;
      return { ...l, sign, r: returnsOf(l.bars, window).map(x => x * sign) };
    })
    .filter(l => l.ticker && l.r.length >= 20);
  if (usable.length < 2) return null;

  const pairs = [];
  for (let i = 0; i < usable.length; i++)
    for (let j = i + 1; j < usable.length; j++) {
      const rho = pearson(usable[i].r, usable[j].r);
      if (rho != null) pairs.push({ a: usable[i].ticker, b: usable[j].ticker, rho });
    }
  if (!pairs.length) return null;

  /* Each leg's MEAN correlation to the others is what separates a cluster
     from an outlier. A single pairwise number cannot: two legs at 0.9 in a
     note of five says nothing about the other three. */
  const meanTo = {};
  for (const l of usable) {
    const mine = pairs.filter(p => p.a === l.ticker || p.b === l.ticker).map(p => p.rho);
    meanTo[l.ticker] = mine.length ? +(mine.reduce((s, v) => s + v, 0) / mine.length).toFixed(3) : null;
  }
  const basket = +(pairs.reduce((s, p) => s + p.rho, 0) / pairs.length).toFixed(3);

  /* Aggregate risk, the standard portfolio form:  sqrt(r'Rr).

     The first version of this computed largest + rho x (the rest), which can
     never exceed the sum and therefore made a CONCENTRATION warning read as
     a reduction — 27.9% "rather than" 33%, which invites exactly the wrong
     conclusion. The comparison that carries the warning is correlated
     against INDEPENDENT: independent risk is the root of the sum of squares,
     and correlation pushes it up toward the arithmetic sum. Both numbers
     below are the same positions; only the assumption differs. */
  const risks = usable.map(l => l.riskPct || 0);
  const sumSq = risks.reduce((s, r) => s + r * r, 0);
  const crossSum = risks.reduce((s, r, i) =>
    s + risks.slice(i + 1).reduce((t, r2) => t + r * r2, 0), 0);
  const independent = Math.sqrt(sumSq);
  const correlated = Math.sqrt(Math.max(0, sumSq + 2 * basket * crossSum));

  const cluster = usable.filter(l => (meanTo[l.ticker] ?? 0) >= HIGH_RHO).map(l => l.ticker);
  /* Three states, not two. With signed returns a strongly NEGATIVE
     correlation is a hedge — deliberate, informative, and the opposite of a
     concern — while a correlation near zero is a leg that does not respond
     to the catalyst at all. Lumping them together as "outliers" would flag
     an intentional hedge as a problem. */
  const hedges = usable.filter(l => (meanTo[l.ticker] ?? 0) <= -HIGH_RHO).map(l => l.ticker);
  /* An outlier is a leg unlike THE OTHERS, which needs at least two others
     to be unlike. With two legs each is the other's only pair, so both would
     score identically and both get flagged — and the note prints the same
     sentence twice. */
  const outliers = usable.length >= 3
    ? usable.filter(l => Math.abs(meanTo[l.ticker] ?? 1) <= LOW_RHO).map(l => l.ticker)
    : [];

  const out = {
    window, legs: usable.map(l => l.ticker), pairs, meanTo, basket,
    sumRiskPct: +risks.reduce((s, r) => s + r, 0).toFixed(1),
    independentRiskPct: +independent.toFixed(1),
    correlatedRiskPct: +correlated.toFixed(1),
    amplification: independent > 0 ? +(correlated / independent).toFixed(2) : null,
    cluster, outliers, hedges,
    directions: Object.fromEntries(usable.map(l => [l.ticker, l.direction ?? "bullish"])),
    concentrated: basket >= HIGH_RHO || cluster.length >= 2,
  };
  RunLog.info("calc", "correlation", {
    window, basket, cluster, outliers, hedges, signed: true,
    independentRiskPct: out.independentRiskPct, correlatedRiskPct: out.correlatedRiskPct,
  });
  return out;
}

/* One sentence for the note. Returns null when there is nothing to say —
   an uncorrelated two-leg note needs no warning and gets none. */
export function correlationNote(c) {
  if (!c) return null;
  const parts = [];
  if (c.concentrated) {
    const names = c.cluster.length >= 2 ? c.cluster.join(", ") : c.legs.join(", ");
    parts.push(`${names} have moved together (mean correlation ${c.basket.toFixed(2)} over ` +
      `${c.window} sessions). Sized as separate ideas they would carry ` +
      `${c.independentRiskPct.toFixed(1)}% of aggregate risk; at that correlation they carry ` +
      `${c.correlatedRiskPct.toFixed(1)}%, ${c.amplification}x more, because they stop together.`);
  }
  if (c.hedges.length) {
    const each = c.hedges.map(t => `${t} at ${(c.meanTo[t] ?? 0).toFixed(2)}`).join(", ");
    parts.push(`${c.hedges.length > 1 ? "Several legs offset" : c.hedges[0] + " offsets"} the ` +
      `rest (${each} against the other positions, direction accounted for), so the aggregate ` +
      `carries less risk than the separate stop-losses imply.`);
  }
  if (c.outliers.length) {
    const each = c.outliers.map(t => `${t} at ${(c.meanTo[t] ?? 0).toFixed(2)}`).join(", ");
    parts.push(`${c.outliers.length > 1 ? "Several legs have" : c.outliers[0] + " has"} not moved ` +
      `with the rest (${each}), so ${c.outliers.length > 1 ? "they" : "it"} either ` +
      `diversif${c.outliers.length > 1 ? "y" : "ies"} the view or do${c.outliers.length > 1 ? "" : "es"} not express it.`);
  }
  return parts.length ? parts.join(" ") : null;
}
