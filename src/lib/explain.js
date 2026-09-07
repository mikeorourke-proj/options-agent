/* ═══════════════════════════════════════════════════════════════════
   explain.js — internal ranking explainer

   The client note states no criterion and shows no score. This file is the
   other half of that bargain: every number behind the order, written down,
   for the desk only. It is a standalone HTML file with nothing external.

   It should be readable by someone who wants to argue with the tool, so it
   shows the raw input, the normalised value, the weight, and the
   contribution for each component — not just the total.
   ═══════════════════════════════════════════════════════════════════ */
import { NORM, WEIGHTS_SCORE } from "./pricing.js";
import { TIE_ETF, TIE_OPT } from "./ordering.js";

const f = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toFixed(d);
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const LABEL = {
  evOnRisk: "Expectancy on risk", pop: "Probability of profit",
  convexity: "Convexity retained", carry: "Carry to judgement", exec: "Execution cost",
  riskDef: "Loss definition",
};
const MEANING = {
  evOnRisk: "expected P&L divided by the most that can be lost",
  pop: "chance of finishing beyond breakeven under the stated view",
  convexity: "share of the modelled move the structure actually monetises; shares are linear and uncapped",
  carry: "theta paid before the trade can be judged; with no catalyst date it is charged across the whole hold",
  exec: "bid-ask or spread cost as a share of the outlay",
  riskDef: "how well the loss is bounded: a debit structure is a number, a stop is an intention",
};

function partsTable(parts, score) {
  const rows = Object.entries(WEIGHTS_SCORE).map(([k, w]) => {
    const p = parts?.[k] ?? 0;
    return `<tr><td><b>${LABEL[k] || k}</b><div class="m">${MEANING[k] || ""}</div></td>
      <td class="c">${NORM[k] ? `${NORM[k][0]} – ${NORM[k][1]}` : "—"}</td>
      <td class="c">${f(p, 3)}</td><td class="c">${w.toFixed(2)}</td>
      <td class="c b">${f(p * w, 3)}</td>
      <td class="bar"><span style="width:${Math.max(0, Math.min(100, p * 100))}%"></span></td></tr>`;
  }).join("");
  return `<table class="k"><thead><tr><th>Component</th><th>Normalised over</th><th>Score 0–1</th><th>Weight</th><th>Contribution</th><th></th></tr></thead>
    <tbody>${rows}<tr class="tot"><td colspan="4">Composite</td><td class="c b">${f(score, 3)}</td><td></td></tr></tbody></table>`;
}

export function buildExplainer({ note, menus }) {
  const byId = Object.fromEntries(menus.map(m => [m.id, m]));
  const { meta, themes, etfOrder, optOrder } = note;

  const orderBlock = (title, rows, band, unit) => {
    if (!rows.length) return "";
    const decisive = rows.every((r, i) => i === 0 || Math.abs(rows[i - 1].v - r.v) > band);
    return `<h3>${title}</h3>
      <p class="lead">Sorted on expectancy. Anything within <b>${band}${unit}</b> of the entry above it is
      treated as a tie and falls back to the order the themes were raised in the source — the tool does not
      claim a preference it cannot support. This ordering was
      <b class="${decisive ? "ok" : "warn"}">${decisive ? "decisive" : "partly source order"}</b>.</p>
      <table class="k"><thead><tr><th>#</th><th>Expression</th><th>Expectancy</th><th>Gap to next</th><th>Within tie band</th></tr></thead><tbody>
      ${rows.map((r, i) => {
        const gap = i < rows.length - 1 ? r.v - rows[i + 1].v : null;
        const tie = gap != null && gap <= band;
        return `<tr><td class="c">${i + 1}</td><td><b>${esc(r.label)}</b></td><td class="c">${f(r.v)}${unit}</td>
          <td class="c">${gap == null ? "—" : f(gap) + unit}</td>
          <td class="c ${tie ? "warn" : ""}">${gap == null ? "—" : tie ? "yes — source order applied" : "no"}</td></tr>`;
      }).join("")}</tbody></table>`;
  };

  const themeBlocks = themes.map(t => {
    const m = byId[t.id] || {};
    const sh = t.etf?.share, plan = t.etf?.plan, tgt = t.etf?.tgt;
    const cands = [t.etf?.tk, ...(m.secondary || []).map(s => s.t)].filter(Boolean);

    const etfBlock = sh ? `
      <h4>${esc(t.etf.tk)} — shares</h4>
      <table class="k s"><tbody>
        <tr><td>Execution</td><td>${plan.single ? `immediate — ${esc(plan.reason || "")}` : `scaled, five rungs ${f(t.etf.price)} → ${f(plan.wall)}`}</td></tr>
        <tr><td>Weighted entry</td><td>${f(plan.entry)} (${f(plan.entryImprovementPct, 1)}% better than the last sale)</td></tr>
        <tr><td>Structural target</td><td>${tgt?.struct ?? "—"} — the opposite open-interest wall. <b>Not shown in the note</b>; used only to compute expectancy.</td></tr>
        <tr><td>Stop</td><td>${f(plan.stop)} — ${plan.mode === "wall" ? "1% beyond the wall scaled into" : "flat 5% from the entry"}</td></tr>
        <tr><td>Reward / risk</td><td>${f(sh.rewardPct, 1)}% against ${f(sh.riskPct, 1)}% = <b>${sh.rr}</b> : 1</td></tr>
        <tr><td>Distance in sigma</td><td>reward <b>${sh.rewardSigma}σ</b>, risk <b>${sh.riskSigma}σ</b> — one sigma is ${f(sh.sdPct, 1)}% over the hold.
          A ratio cannot see this: a 3.3:1 bought with a target 1.1σ away is not the same trade as 2:1 with one a third of a sigma away.</td></tr>
        <tr><td>Probabilities</td><td>reaches target <b>${sh.pTarget}%</b> · stopped <b>${sh.pStop}%</b> · profitable <b>${sh.pop}%</b>,
          under a distribution shifted <b>${sh.impliedMove}σ</b> by the stated conviction</td></tr>
        <tr><td>Expectancy</td><td class="${sh.expectancy >= 0 ? "ok" : "warn"}"><b>${f(sh.expectancy)}%</b> of notional</td></tr>
      </tbody></table>
      ${partsTable(sh.parts, sh.score)}` : `<p class="warn">No share expression scored — the vehicle had no usable volatility read.</p>`;

    const optBlocks = (t.options || []).map(o => `
      <h4>${esc(t.etf?.tk)} — ${esc(o.name)}</h4>
      <table class="k s"><tbody>
        <tr><td>Legs</td><td>${esc(o.legText)} · expiry ${o.expiry} (${o.days} days)</td></tr>
        <tr><td>Expiry chosen</td><td>${(o.expiryCandidates || []).length > 1
            ? `considered ${o.expiryCandidates.join(", ")} — the ladder is walked nearest first and the first to clear the open-interest gate is used`
            : "only one listing cleared the window"}</td></tr>
        <tr><td>Net</td><td>${o.pricing.net > 0 ? "debit" : "credit"} $${f(Math.abs(o.pricing.net) / 100)} · marks from <b>${esc(o.pricing.priceSource)}</b>${o.pricing.priceSource !== "quote" ? ' <span class="warn">(no bid/ask returned — the economics are indicative)</span>' : ""}</td></tr>
        <tr><td>Max gain / loss</td><td>${o.pricing.uncapped ? "uncapped" : "$" + f(o.pricing.maxGain / 100)} against $${f(o.pricing.risk / 100)}${o.pricing.rr ? ` = <b>${o.pricing.rr}</b> : 1` : ""}</td></tr>
        <tr><td>Breakeven</td><td>${o.pricing.breakevens.join(" / ") || "—"} · POP <b>${f(o.econ.pop, 1)}%</b></td></tr>
        <tr><td>Carry</td><td>${o.econ.carryPct}% of outlay over ${o.econ.carryDays} days${o.econ.undated ? ' — <span class="warn">no catalyst date, so theta is charged across the whole hold. This is the mechanical reason an undated thesis favours the underlying.</span>' : ""}</td></tr>
        <tr><td>Convexity kept</td><td>${o.econ.convexity} of the modelled move${o.econ.convexity < 0.3 ? " — the structure caps well inside the distribution" : ""}</td></tr>
        <tr><td>Expectancy</td><td class="${o.econ.ev >= 0 ? "ok" : "warn"}"><b>$${f(o.econ.ev / 100)}</b> per contract</td></tr>
        <tr><td>Why this shape</td><td>${esc(o.why)}</td></tr>
      </tbody></table>
      ${partsTable(o.econ.parts, o.econ.score)}`).join("");

    const alts = (t.alternatives || []).map(a =>
      `<li><b>${esc(a.name)}</b> — score ${f(a.econ.score, 3)}, expectancy $${f(a.econ.ev / 100)}. ${esc(a.why)}</li>`).join("");
    const blocked = (m.optionsBlocked || []).map(b => `<li>${esc(b)} — did not clear the liquidity or reward gates</li>`).join("");

    return `<section>
      <h2>${esc(t.direction)} ${esc(t.subject)}</h2>
      <p class="lead">Basis <b>${esc(t.basis)}</b>${t.evidence ? ` — “${esc(t.evidence)}”` : " — extended from the argument; no direct sentence supports it"}.
        ${t.catalyst?.date ? `Catalyst ${esc(t.catalyst.date)}.` : "<b class='warn'>No catalyst date.</b>"}</p>
      <h3>Vehicle</h3>
      <p class="lead">Anchored on <b>${esc(m.anchorTag || "—")}</b>, which restricts the pool to funds whose asset identity matches.
        Candidates: ${cands.map(esc).join(" · ") || "—"}. Ranked on appropriateness — purity of exposure, options grade,
        log dollar volume, and structural decay charged against the hold.</p>
      <ul>${[t.etf, ...(m.secondary || [])].filter(Boolean).map(v =>
        `<li><b>${esc(v.tk || v.t)}</b>${v.fit ? ` fit ${f(v.fit, 2)}` : ""} — ${esc(v.fitWhy || "selected")}</li>`).join("")}</ul>
      <h3>ETF expression</h3>${etfBlock}
      ${optBlocks ? `<h3>Derivatives expression</h3>${optBlocks}` : "<h3>Derivatives expression</h3><p class='warn'>None carried.</p>"}
      ${alts || blocked ? `<h3>Not carried</h3><ul>${alts}${blocked}</ul>` : ""}
    </section>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Ranking explainer — ${esc(meta.title)}</title><style>
:root{--b:#0079C1;--n:#001F5F;--g:#00703C;--r:#C00000;--m:#5A6472;--l:#E2E6EC}
*{box-sizing:border-box}
body{font:13px/1.5 -apple-system,Arial,sans-serif;color:#14181F;margin:0;padding:28px 34px;max-width:1080px}
h1{color:var(--b);font-size:20px;margin:0 0 4px}
.sub{color:var(--m);font-size:12px;margin-bottom:20px}
h2{color:#fff;background:var(--n);font-size:14px;padding:6px 10px;margin:26px 0 10px;border-radius:4px}
h3{color:var(--b);font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 6px}
h4{font-size:13px;margin:14px 0 5px}
p.lead{color:var(--m);font-size:12px;margin:0 0 8px}
ul{margin:4px 0 8px 18px;padding:0;font-size:12px;color:var(--m)}
li b{color:#14181F}
table.k{border-collapse:collapse;width:100%;font-size:11.5px;margin:6px 0 4px}
table.k th{background:var(--n);color:#fff;text-align:left;padding:4px 7px;font-size:10.5px}
table.k td{padding:4px 7px;border-bottom:1px solid var(--l);vertical-align:top}
table.k tr:nth-child(even) td{background:#F7F9FC}
table.k td.c{text-align:center}table.k td.b{font-weight:700}
table.k tr.tot td{background:#EAF2FA;font-weight:700;border-top:2px solid var(--n)}
table.k.s td:first-child{width:150px;color:var(--m)}
td.m,.m{font-size:10.5px;color:var(--m);font-weight:400}
td.bar{width:90px;padding:0 7px}
td.bar span{display:block;height:7px;background:var(--b);border-radius:2px;min-width:1px}
.ok{color:var(--g)}.warn{color:var(--r)}
.method{background:#F7F9FC;border:1px solid var(--l);border-radius:6px;padding:14px 16px;margin-top:26px;font-size:12px;color:var(--m)}
.method b{color:#14181F}
@media print{body{padding:0}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>Ranking explainer — ${esc(meta.title)}</h1>
<div class="sub">${esc(meta.date)} · internal, not for distribution · drafted by ${esc(meta.model || "—")} · generated ${new Date().toLocaleString()}</div>

<p class="lead">The note itself lists two sections in order and states no criterion, because an implicit order
carries more weight than an explicit score and the client's judgement is the point. This document is the other
half of that: everything behind the order, so the desk can argue with it.</p>

${orderBlock("Order — ETF Expression", etfOrder.map(r => ({ label: r.label, v: r.ev })), TIE_ETF, "%")}
${orderBlock("Order — Derivatives Expression", optOrder.map(r => ({ label: r.label, v: r.evPerRisk })), TIE_OPT, "")}

${themeBlocks}

<div class="method">
  <b>Method, and where it is opinionated.</b>
  Expectancy is computed under a lognormal shifted by the move the stated conviction implies — high 1.0σ,
  medium 0.6σ, low 0.3σ over the hold. Priced off implied volatility alone every structure has an expected
  value of zero, so the ranking is conditional on the view; without the view it says nothing.
  <br><br>
  <b>Known biases.</b> Shares score full convexity and near-zero carry, worth 0.28 of the composite before any
  economics run; loss definition (0.10) is the counterweight but does not fully offset it. Gap risk on a share
  stop is scored by liquidity grade, not modelled. Where marks come from last trade rather than a quote, the
  economics are indicative. The 1σ figure uses 30-day implied volatility, not the traded expiry's.
  <br><br>
  <b>Thresholds are judgement.</b> The weights, the normalisation bands, the tie bands
  (${TIE_ETF}% and ${TIE_OPT}), the conviction drifts and the per-leg open-interest floor are all set by hand
  and have not been validated against outcomes. Changing them changes the order.
</div>
</body></html>`;
}
