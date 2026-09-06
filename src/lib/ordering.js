/* ═══════════════════════════════════════════════════════════════════
   ordering.js — how the note orders expressions without saying why

   The note lists ETF and derivatives expressions in sequence and states
   no criterion. An implicit order carries more weight than an explicit
   score, not less: a reader sees "this one first" with no hint it was
   close. So the tool must be confident before it orders, and neutral when
   it is not.

   Criterion: expectancy under the stated view — the least opinionated
   measure available, because it imposes no preference between hit rate
   and magnitude. That preference belongs to the client.

   Tie band: expressions inside it are not the tool's call. They keep the
   order the analyst raised them in the source, which is the most neutral
   sequence there is.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";

export const TIE_ETF = 0.5;    // % of notional
export const TIE_OPT = 0.10;   // expectancy per $ of premium at risk

export function orderByExpectancy(items, { key, band, sourceRank, label = "order" }) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => key(b) - key(a));
  const out = [];
  let grp = [sorted[0]];
  for (const r of sorted.slice(1)) {
    if (key(grp[0]) - key(r) <= band) grp.push(r);
    else { out.push(...grp.sort((a, b) => sourceRank(a) - sourceRank(b))); grp = [r]; }
  }
  out.push(...grp.sort((a, b) => sourceRank(a) - sourceRank(b)));

  const ties = out.filter((r, i) => i > 0 && Math.abs(key(out[i - 1]) - key(r)) <= band).length;
  RunLog.info("calc", label, {
    order: out.map(r => `${r.label}:${key(r).toFixed(2)}`),
    band, tiesResolvedBySource: ties,
    decisive: ties < out.length - 1,       // false = the whole order is source order
  });
  return out;
}
