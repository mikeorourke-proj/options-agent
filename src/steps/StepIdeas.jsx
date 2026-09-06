import { useEffect, useRef, useState } from "react";
import RunLog from "../lib/runlog.js";
import { api, mapLimit } from "../lib/api.js";
import { searchUniverse, leveredFor, appropriateness } from "../data/etf-universe.js";
import { analyzeChain, realisedVol } from "../lib/vol.js";
import { suggestStructures } from "../lib/strategy.js";
import { evaluate } from "../lib/pricing.js";
import { scalePlan, targets, scoreShares } from "../lib/shares.js";
import { orderByExpectancy, TIE_ETF, TIE_OPT } from "../lib/ordering.js";
import { dte } from "../lib/vol.js";

const fmtB  = n => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : n ? `$${n.toFixed(0)}` : "—";
const fmtV  = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${((n || 0) / 1e3).toFixed(0)}K`;
const grade = q => {
  if (!q) return "X";
  const { withGreeks = 0, withOI = 0 } = q;
  if (withGreeks < 20 || withOI < 20) return "X";
  if (withGreeks < 120) return "C";
  if (withGreeks < 400) return "B";
  return "A";
};

/* One theme's expression menu. Ranking is by dollar ADV — the only
   liquidity measure comparable across a $402 GLD and an $82 IAU. */
async function buildMenu(theme, catalystDate, horizon) {
  const t = RunLog.timer("ui", `menu.${theme.id}`);

  /* Anchor-first. Without an anchor a silver theme pulls gold funds via a
     shared driver tag and, being more liquid, gold takes the primary slot.
     A combined cluster carries several anchors and unions the pools. */
  const anchors = theme.anchors?.length ? theme.anchors : [theme.anchorTag].filter(Boolean);
  let pool = [];
  if (anchors.length) {
    for (const a of anchors) {
      for (const e of searchUniverse(theme.tags, { anchor: a, excludeLevered: true, limit: 5 }))
        if (!pool.some(p => p.t === e.t)) pool.push(e);
    }
  }
  if (!pool.length) pool = searchUniverse(theme.tags, { excludeLevered: true, limit: 8 });
  RunLog.info("ui", `pool.${theme.id}`, { anchors, cluster: theme.cluster, tickers: pool.map(p => p.t) });
  if (!pool.length) { t.end({ candidates: 0 }); return { ...theme, none: true, primary: null, secondary: [], levered: [], structures: [] }; }

  // cheap pass: quote only, to rank on dollar ADV
  const priced = await mapLimit(pool, 4, async e => {
    try {
      const q = await api.quote(e.t);
      const px = q?.price || 0;
      return { ...e, price: px, volume: q?.volume || 0, dollarADV: px * (q?.volume || 0) };
    } catch { return { ...e, price: 0, dollarADV: 0, dead: true }; }
  });

  /* Order by how well each fund expresses the theme, not by how much it
     trades. Purity dominates, liquidity is log-scaled so size cannot
     overwhelm relevance, and decay is charged against the horizon. */
  const hzDays = { days: 10, weeks: 28, months: 90 }[horizon] || 28;
  const ranked = priced.filter(e => !e.dead && e.price > 0)
    .map(e => { const a = appropriateness(e, { horizonDays: hzDays }); return { ...e, fit: a.score, fitWhy: a.why }; })
    .sort((a, b) => b.fit - a.fit);
  RunLog.info("ui", `rank.${theme.id}`, { order: ranked.map(r => `${r.t}:${r.fit}`) });
  if (!ranked.length) { t.end({ candidates: 0 }); return { ...theme, none: true, primary: null, secondary: [], levered: [], structures: [] }; }

  const primary = ranked[0];
  const secondary = ranked.slice(1, 4);

  // levered products on the primary, direction-matched
  const levCands = leveredFor(primary.t, { direction: theme.direction });
  const levered = (await mapLimit(levCands, 3, async e => {
    try {
      const q = await api.quote(e.t);
      const px = q?.price || 0;
      const row = { ...e, price: px, volume: q?.volume || 0, dollarADV: px * (q?.volume || 0) };
      const a = appropriateness(row, { horizonDays: hzDays });
      return { ...row, fit: a.score, fitWhy: a.why };
    } catch { return null; }
  })).filter(e => e && e.price > 0).sort((a, b) => b.fit - a.fit).slice(0, 2);

  // chain analytics on the primary only — one heavy call per theme
  let vol = null, structures = [], liq = "X", optionsBlocked = [];
  let plan = null, tgt = null, shareScore = null;
  try {
    const [chain, bars] = await Promise.all([
      api.chain(primary.t, primary.price),
      api.bars(primary.t, new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10)),
    ]);
    liq = grade(chain?.quality);
    RunLog.gate(`liquidity:${primary.t}`, liq !== "X", { grade: liq, ...chain?.quality });
    if (liq !== "X") {
      vol = analyzeChain(primary.t, chain.contracts, primary.price);
      const rv = realisedVol(bars?.bars || [], 30);
      vol.rv30 = rv;
      /* Candidates from the matrix, then priced against the real chain and
         ranked on view-conditional economics. Risk-neutral EV is zero for
         every structure, so the distribution is shifted by the move the
         stated conviction implies and structures compete on how well they
         monetise THAT move. */
      const cands = suggestStructures(theme.direction, vol, rv, {
        catalystDate: theme.catalyst?.date || catalystDate, horizon,
        conviction: theme.conviction || "medium", liq, max: 6,
      });
      const ctx = { direction: theme.direction, conviction: theme.conviction || "medium",
                    catalystDate: theme.catalyst?.date || catalystDate, rv, horizonDays: hzDays };
      const evaluated = cands.map(c => ({ c, r: evaluate(c, chain.contracts, primary.price, vol, ctx) }));
      structures = evaluated.filter(x => x.r).map(x => x.r)
        .sort((a, b) => b.econ.score - a.econ.score)
        .slice(0, 3);
      // Why nothing qualified — an empty tier must explain itself.
      optionsBlocked = evaluated.filter(x => !x.r).map(x => x.c.name);
      /* The ETF leg is scored the same way, so shares and structures rank
         on one number. Reward-to-risk alone cannot see that one target is
         1.1 sigma away and another a third of a sigma. */
      const conv = theme.conviction || "medium";
      plan = scalePlan(primary.price, { ...vol, ticker: primary.t }, theme.direction,
                       { execution: theme.execution || "scaled", mode: theme.stopMode || "wall" });
      tgt  = targets(primary.price, vol, theme.direction);
      shareScore = plan && tgt
        ? scoreShares(plan, tgt, { ...vol, ticker: primary.t },
                      { direction: theme.direction, conviction: conv, liq })
        : null;

      RunLog.info("ui", `structures.${primary.t}`, {
        considered: cands.length, priced: structures.length,
        ranked: structures.map(s2 => `${s2.id}:${s2.econ.score}`),
        shares: shareScore ? `${primary.t}:${shareScore.score}` : null,
      });
    }
  } catch (e) { RunLog.error("ui", `chain ${primary.t}`, e); }

  t.end({ primary: primary.t, secondary: secondary.map(s => s.t), levered: levered.map(l => l.t), structures: structures.length });
  /* One ranked list across every expression of the theme. */
  const allExpr = [
    ...(shareScore ? [{ kind: "etf", label: `${primary.t} shares`, score: shareScore.score,
                        ev: shareScore.expectancy, detail: shareScore }] : []),
    ...structures.map(st => ({ kind: "option", label: `${primary.t} ${st.name.toLowerCase()}`,
                               score: st.econ.score, ev: +(st.econ.ev / 100).toFixed(2), detail: st })),
  ].sort((a, b) => b.score - a.score);
  if (allExpr.length) RunLog.info("ui", `ranked.${theme.id}`, { order: allExpr.map(e => `${e.label}:${e.score}`) });

  return { ...theme, primary: { ...primary, liq, plan, tgt, shareScore },
           secondary, levered, vol, structures, optionsBlocked, allExpr };
}

export default function StepIdeas({ parsed, setParsed, picks, setPicks, menuCache, setMenuCache, onNext }) {
  const [menus, setMenus] = useState(menuCache || []);
  const [busy, setBusy] = useState(!menuCache);
  const [merging, setMerging] = useState(null);
  const ran = useRef(Boolean(menuCache));

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    (async () => {
      const out = [];
      for (const th of parsed.themes) out.push(await buildMenu(th, null, "weeks"));
      setMenus(out); setMenuCache(out); setBusy(false);
    })();
    /* eslint-disable-next-line */
  }, []);

  /* Combine every theme sharing a driver into one. The debasement complex
     is one trade expressed three ways, not three trades — combining unions
     the anchors so GLD, SLV and IBIT rank side by side in one menu. */
  async function combineCluster(cluster, direction) {
    const members = menus.filter(m => m.cluster === cluster && m.direction === direction && !m.combinedFrom);
    if (members.length < 2) return;
    setMerging(`${cluster}::${direction}`);
    const merged = {
      id: `combined-${cluster}-${direction}`,
      cluster, direction,
      combinedFrom: members.map(m => m.id),
      subject: members.map(m => m.subject).join(" · "),
      basis: members.every(m => m.basis === "stated") ? "stated" : "extended",
      evidence: members.find(m => m.evidence)?.evidence || "",
      rationale: members.find(m => m.basis === "stated")?.rationale || members[0].rationale,
      catalyst: members.find(m => m.catalyst?.date)?.catalyst || members[0].catalyst,
      anchors: [...new Set(members.map(m => m.anchorTag).filter(Boolean))],
      tags: [...new Set(members.flatMap(m => m.tags || []))],
    };
    RunLog.info("ui", "cluster.combine", { cluster, from: merged.combinedFrom, anchors: merged.anchors });
    const built = await buildMenu(merged, null, "weeks");
    const next = [built, ...menus.filter(m => !(m.cluster === cluster && m.direction === direction && !m.combinedFrom))];
    setMenus(next); setMenuCache(next);
    setPicks(p => ({
      ...p,
      sel: Object.fromEntries(Object.entries(p.sel).filter(([, v]) => !merged.combinedFrom.includes(v.themeId))),
      primaryThemeId: merged.combinedFrom.includes(p.primaryThemeId) ? built.id : p.primaryThemeId,
    }));
    setMerging(null);
  }

  async function splitCluster(id) {
    const m = menus.find(x => x.id === id);
    if (!m?.combinedFrom) return;
    setMerging(m.id);
    const originals = parsed.themes.filter(t => m.combinedFrom.includes(t.id));
    const rebuilt = [];
    for (const th of originals) rebuilt.push(await buildMenu(th, null, "weeks"));
    const next = [...menus.filter(x => x.id !== id), ...rebuilt];
    setMenus(next); setMenuCache(next);
    RunLog.info("ui", "cluster.split", { id });
    setMerging(null);
  }

  /* Anchor-first retrieval is strict by design, so a theme can legitimately
     return one fund. Manual add covers everything the table does not. */
  async function addTicker(themeId, tk) {
    const t = tk.trim().toUpperCase();
    if (!t) return;
    setMerging(themeId);
    try {
      const [q, ref] = await Promise.all([api.quote(t), api.reference(t)]);
      if (!q?.price) throw new Error("no quote");
      const row = { t, n: ref?.name || t, cls: "—", hits: [], manual: true,
                    price: q.price, volume: q.volume || 0, dollarADV: q.price * (q.volume || 0) };
      const next = menus.map(m => m.id === themeId ? { ...m, secondary: [...m.secondary, row] } : m);
      setMenus(next); setMenuCache(next);
      RunLog.info("ui", "vehicle.manual.add", { themeId, ticker: t });
    } catch (e) { RunLog.error("ui", `manual add ${t}`, e); }
    setMerging(null);
  }

  const on = (k) => Boolean(picks.sel[k]);
  function toggle(themeId, kind, ticker, extra = {}) {
    const k = `${themeId}|${kind}|${ticker}`;
    const next = { ...picks.sel };
    if (next[k]) delete next[k]; else next[k] = { themeId, kind, ticker, ...extra };
    setPicks({ ...picks, sel: next });
    RunLog.info("ui", "pick.toggle", { key: k, on: Boolean(next[k]) });
  }
  /* Changing execution or stop mode re-plans the ETF leg only; the chain
     and option pricing are unchanged, so no refetch. */
  function setPref(id, k, val) {
    const next = menus.map(m => {
      if (m.id !== id) return m;
      const t2 = { ...m, [k]: val };
      if (!t2.primary?.price || !t2.vol) return t2;
      const plan = scalePlan(t2.primary.price, { ...t2.vol, ticker: t2.primary.t }, t2.direction,
                             { execution: t2.execution || "scaled", mode: t2.stopMode || "wall" });
      const tgt = targets(t2.primary.price, t2.vol, t2.direction);
      const sh = plan && tgt ? scoreShares(plan, tgt, { ...t2.vol, ticker: t2.primary.t },
                                            { direction: t2.direction, conviction: t2.conviction || "medium", liq: t2.primary.liq }) : null;
      return { ...t2, primary: { ...t2.primary, plan, tgt, shareScore: sh } };
    });
    setMenus(next); setMenuCache(next);
    RunLog.info("ui", "theme.pref", { id, [k]: val });
  }
  function setPrimaryTheme(id) {
    setPicks({ ...picks, primaryThemeId: id });
    RunLog.info("ui", "theme.primary", { id });
  }
  function toggleSplit(id) {
    const s = new Set(picks.split);
    s.has(id) ? s.delete(id) : s.add(id);
    setPicks({ ...picks, split: [...s] });
    RunLog.info("ui", "theme.split", { id, ownNote: s.has(id) });
  }

  const chosen = Object.values(picks.sel);
  const themesChosen = [...new Set(chosen.map(c => c.themeId))];

  /* Note order for the two sections, from the current selections. Source
     rank is the order the parser returned themes in — the order the
     analyst raised them. */
  const srcRank = Object.fromEntries((parsed.themes || []).map((t, i) => [t.id, i]));
  const etfSel = menus.filter(m => chosen.some(c => c.themeId === m.id && c.kind === "primary") && m.primary?.shareScore)
    .map(m => ({ label: m.primary.t, themeId: m.id, ev: m.primary.shareScore.expectancy }));
  const optSel = menus.flatMap(m => (m.structures || [])
    .filter(st => chosen.some(c => c.themeId === m.id && c.kind === "option" && c.ticker === st.id))
    .map(st => ({ label: `${m.primary.t} ${st.name.toLowerCase()}`, themeId: m.id,
                  evPerRisk: st.econ.ev / Math.max(1, st.pricing.risk) })));
  const etfOrder = orderByExpectancy(etfSel, { key: r => r.ev, band: TIE_ETF,
                    sourceRank: r => srcRank[r.themeId] ?? 99, label: "order.etf" });
  const optOrder = orderByExpectancy(optSel, { key: r => r.evPerRisk, band: TIE_OPT,
                    sourceRank: r => srcRank[r.themeId] ?? 99, label: "order.derivatives" });
  const notes = 1 + picks.split.filter(id => themesChosen.includes(id)).length;

  return (
    <>
      <div className="card">
        <h2>Themes</h2>
        <p className="hint">
          Each theme carries the sentence it came from. <b>Stated</b> means you wrote it;
          <b> extended</b> means the parser drew it out of your logic — check those before they ship.
          Tick any combination of expressions across themes.
        </p>
        {busy && <div className="row" style={{ padding: 14 }}>
          <span className="spin" /><span style={{ color: "var(--muted)", fontSize: 13 }}>Building expression menus…</span>
        </div>}
      </div>

      {clusters(menus).map(c => c.size > 1 && (
        <div key={c.key} className="clusterbar">
          <span className={`dirbadge ${c.direction}`}>{c.direction}</span>
          <b>{c.size} themes share one driver</b>
          <span>{c.subjects}</span>
          <span className="spacer" />
          <button className="ghost" disabled={merging === c.key}
                  onClick={() => combineCluster(c.cluster, c.direction)}>
            {merging === c.key ? <><span className="spin" />&nbsp;Combining…</> : "Combine into one theme"}
          </button>
        </div>
      ))}

      {!busy && (
        <div className="actionbar">
          <button className="primary" disabled={chosen.length === 0} onClick={onNext}>
            Continue with {chosen.length} expression{chosen.length === 1 ? "" : "s"} →
          </button>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {themesChosen.length} theme{themesChosen.length === 1 ? "" : "s"} · produces {notes} note{notes === 1 ? "" : "s"}
          </span>
          {(etfOrder.length > 1 || optOrder.length > 1) && (
            <span className="noteorder">
              {etfOrder.length > 0 && <>ETF <b>{etfOrder.map(r => r.label).join(" › ")}</b></>}
              {optOrder.length > 0 && <> &nbsp;·&nbsp; Derivatives <b>{optOrder.map(r => r.label).join(" › ")}</b></>}
              <em>note order — expectancy, ties in source order</em>
            </span>
          )}
        </div>
      )}

      {menus.map(m => (
        <div key={m.id} className={`card theme ${picks.primaryThemeId === m.id ? "prim" : ""}`}>
          <div className="row" style={{ gap: 9, marginBottom: 3 }}>
            <span className={`dirbadge ${m.direction}`}>{m.direction}</span>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{m.subject}</span>
            <span className={`pill ${m.basis === "stated" ? "a" : "c"}`}>{m.basis}</span>
            {(parsed.attributionFlags || []).some(f => f.startsWith(m.id + ".")) &&
              <span className="pill x" title="A field in this theme reads like it attributes a view to someone. Check before publishing.">check attribution</span>}
            <span className="spacer" />
            <label className="mini"><input type="radio" name="primary" checked={picks.primaryThemeId === m.id}
                   onChange={() => setPrimaryTheme(m.id)} /> primary</label>
            <label className="mini"><input type="checkbox" checked={picks.split.includes(m.id)}
                   onChange={() => toggleSplit(m.id)} /> own note</label>
            <span className="legtoggle" title="ETF execution">
              <button className={(m.execution || "scaled") === "scaled" ? "on" : ""} onClick={() => setPref(m.id, "execution", "scaled")}>scaled</button>
              <button className={m.execution === "immediate" ? "on" : ""} onClick={() => setPref(m.id, "execution", "immediate")}>immediate</button>
            </span>
            <span className="legtoggle" title="Stop out">
              <button className={(m.stopMode || "wall") === "wall" ? "on" : ""} onClick={() => setPref(m.id, "stopMode", "wall")}>stop: wall +1%</button>
              <button className={m.stopMode === "flat" ? "on sh" : ""} onClick={() => setPref(m.id, "stopMode", "flat")}>flat 5%</button>
            </span>
            {m.combinedFrom && <button className="ib-btn" onClick={() => splitCluster(m.id)}>split</button>}
          </div>

          {m.evidence
            ? <blockquote className="evid">{m.evidence}</blockquote>
            : <div className="evid ext">Extended from your argument — no direct sentence supports this.</div>}
          <div className="why" style={{ marginBottom: 10 }}>{m.rationale}</div>

          {m.none && <div className="note">No ETF in the universe cleanly expresses this theme. Consider single names, or add a fund to the table.</div>}

          {m.primary && (
            <>
              <div className="tier">
                <span className="tierlab">Primary — ETF expression</span>
                <ExprRow x={m.primary} kind="primary" themeId={m.id} on={on} toggle={toggle} liq={m.primary.liq}
                         score={m.primary.shareScore?.score} />
                {m.primary.plan && m.primary.shareScore && (
                  <div className="planrow">
                    <span>{m.primary.plan.single ? "immediate" : "scale"} <b>
                      {m.primary.plan.single ? `at ${m.primary.price.toFixed(2)}`
                        : `${m.primary.price.toFixed(2)} \u2192 ${m.primary.plan.wall}`}</b></span>
                    <span>entry <b>{m.primary.plan.entry.toFixed(2)}</b></span>
                    <span>target <b>{m.primary.tgt.struct}</b> ({m.primary.shareScore.rewardSigma}\u03c3)</span>
                    <span>stop <b>{m.primary.plan.stop.toFixed(2)}</b></span>
                    <span>risk <b>{m.primary.shareScore.riskPct}%</b></span>
                    <span>R:R <b>{m.primary.shareScore.rr}</b></span>
                    <span>P(tgt) <b>{m.primary.shareScore.pTarget}%</b></span>
                    <span>EV <b style={{ color: m.primary.shareScore.expectancy >= 0 ? "var(--green)" : "var(--red)" }}>
                      {m.primary.shareScore.expectancy}%</b></span>
                  </div>
                )}
              </div>

              {m.secondary.length > 0 && (
                <div className="tier">
                  <span className="tierlab">Secondary</span>
                  {m.secondary.map(x => <ExprRow key={x.t} x={x} kind="secondary" themeId={m.id} on={on} toggle={toggle} />)}
                </div>
              )}

              {m.levered.length > 0 && (
                <div className="tier">
                  <span className="tierlab">Levered</span>
                  {m.levered.map(x => (
                    <ExprRow key={x.t} x={x} kind="levered" themeId={m.id} on={on} toggle={toggle}
                             extra={<span className="decay">γ={x.gamma} · resets daily, days not weeks</span>} />
                  ))}
                </div>
              )}

              {m.structures.length === 0 && m.primary.liq !== "X" && (
                <div className="tier">
                  <span className="tierlab">Options</span>
                  <div className="note">
                    No structure on {m.primary.t} cleared the liquidity and risk gates
                    {m.optionsBlocked?.length ? ` — ${m.optionsBlocked.join(", ")} rejected` : ""}.
                    The run log lists every expiry tried and why each failed. Express this as shares,
                    or add a more liquid vehicle above.
                  </div>
                </div>
              )}

              {m.structures.length > 0 && (
                <div className="tier">
                  <span className="tierlab">Options — ranked on view-conditional economics</span>
                  {m.structures.map((s, i) => {
                    const p = s.pricing, e = s.econ;
                    const net = p.net / 100;
                    return (
                      <label key={s.id} className={`expr ${on(`${m.id}|option|${s.id}`) ? "sel" : ""}`}>
                        <input type="checkbox" checked={on(`${m.id}|option|${s.id}`)}
                               onChange={() => toggle(m.id, "option", s.id, { structure: s, underlying: m.primary.t })} />
                        <div style={{ flex: 1 }}>
                          <div className="row" style={{ gap: 7 }}>
                            <span className="rank">{i + 1}</span>
                            <b style={{ fontSize: 13 }}>{s.name}</b>
                            <span className="tag">{m.primary.t}</span>
                            <span className="tag" title={s.expiryCandidates?.length > 1 ? `considered: ${s.expiryCandidates.join(", ")}` : undefined}>{s.expiry} · {s.days}d</span>
                            <span className="spacer" />
                            <span className="scorepill" title="view-conditional economics score">{e.score.toFixed(2)}</span>
                          </div>
                          <table className="legtbl">
                            <tbody>
                              {p.legDetail.map((L, j) => (
                                <tr key={j}>
                                  <td className={L.action === "Buy" ? "buy" : "sell"}>{L.action}</td>
                                  <td>{L.qty}\u00D7</td>
                                  <td className="strike">{s.expiry.slice(5)} <b>{L.strike}</b> {L.type}</td>
                                  <td className="mono">${L.px.toFixed(2)}</td>
                                  <td className="dim">{L.moneyness >= 0 ? "+" : ""}{L.moneyness}%</td>
                                  <td className="dim">Δ{L.delta}</td>
                                  <td className="dim">{L.iv != null ? `${L.iv}% iv` : ""}</td>
                                  <td className="dim">OI {L.oi.toLocaleString()}</td>
                                </tr>
                              ))}
                              <tr className="nettr">
                                <td colSpan={3}>Net {net >= 0 ? "debit" : "credit"}</td>
                                <td className="mono"><b>${Math.abs(net).toFixed(2)}</b></td>
                                <td colSpan={4} className="dim">
                                  per 1-lot ${(Math.abs(p.net)).toFixed(0)} · marks from {p.priceSource}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div className="stats">
                            <span>max gain <b>{p.uncapped ? "uncapped" : "$" + (p.maxGain / 100).toFixed(2)}</b></span>
                            <span>R:R <b>{p.rr ?? "n/a"}</b></span>
                            <span>POP <b>{e.pop}%</b></span>
                            <span>EV <b style={{ color: e.ev >= 0 ? "var(--green)" : "var(--red)" }}>${(e.ev / 100).toFixed(2)}</b></span>
                            <span>b/e <b>{p.breakevens.join(" / ") || "—"}</b></span>
                          </div>
                          <div className="why">{s.why}</div>
                          <div className="econwhy">
                            EV/risk {e.evOnRisk} · convexity captured {e.convexity} ·
                            theta to catalyst {e.carryPct}% of outlay · exec {e.execPct}% ·
                            modelled move {e.impliedMove >= 0 ? "+" : ""}{e.impliedMove}σ ({e.sdPct}% 1σ) ·
                            marks: {p.priceSource}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="addrow" style={{ marginTop: 10, paddingTop: 10 }}>
                <input type="text" placeholder="Add ticker…" style={{ maxWidth: 150, fontFamily: "var(--mono)" }}
                       onKeyDown={e => { if (e.key === "Enter") { addTicker(m.id, e.target.value); e.target.value = ""; } }} />
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  Enter to screen and add — anything listed, in or out of the table.
                </span>
              </div>

              {m.allExpr?.length > 1 && (
                <div className="ranked">
                  <b>All expressions ranked</b>
                  {m.allExpr.map((e, i) => (
                    <span key={e.label} className={i === 0 ? "win" : ""}>
                      {i + 1}. {e.label} <em>{e.score.toFixed(2)}</em>
                    </span>
                  ))}
                  <span className="dim">shares and options on one scale &mdash; view-conditional expectancy</span>
                </div>
              )}

              {m.vol?.ok && (
                <div className="volrow">
                  IV30 <b>{m.vol.iv30}%</b> · RV30 <b>{m.vol.rv30 ?? "—"}%</b> ·
                  25Δ RR <b>{m.vol.rr25 ?? "—"}</b> · term <b>{m.vol.termSlope ?? "—"}</b> ·
                  walls <b>{m.vol.putWall ?? "—"} / {m.vol.callWall ?? "—"}</b> ·
                  max pain <b>{m.vol.maxPain ?? "—"}</b>
                </div>
              )}
              {m.primary.liq === "X" && <div className="note">No tradable chain on {m.primary.t} — shares expression only.</div>}
            </>
          )}
        </div>
      ))}

    </>
  );
}

function clusters(menus) {
  const by = {};
  for (const m of menus) {
    if (m.combinedFrom) continue;                 // already merged
    const k = `${m.cluster || m.id}::${m.direction}`;
    (by[k] ||= []).push(m);
  }
  return Object.entries(by).map(([key, list]) => ({
    key, cluster: list[0].cluster || list[0].id, direction: list[0].direction,
    size: list.length, subjects: list.map(l => l.subject).join(" · "),
  }));
}

function ExprRow({ x, kind, themeId, on, toggle, liq, extra, score }) {
  const k = `${themeId}|${kind}|${x.t}`;
  return (
    <label className={`expr ${on(k) ? "sel" : ""}`}>
      <input type="checkbox" checked={on(k)} onChange={() => toggle(themeId, kind, x.t, { price: x.price })} />
      <div style={{ flex: 1 }}>
        <div className="row" style={{ gap: 7 }}>
          <b style={{ fontSize: 13.5 }}>{x.t}</b>
          {liq && <span className={`pill ${liq.toLowerCase()}`}>{liq === "X" ? "shares only" : `options ${liq}`}</span>}
          {x.lev && <span className="pill c">{x.lev > 0 ? `${x.lev}x` : `${x.lev}x inverse`}</span>}
          {score != null && <><span className="spacer" /><span className="scorepill" title="view-conditional expectancy, same scale as the options">{score.toFixed(2)}</span></>}
        </div>
        <div className="nm">{x.n}</div>
        <div className="stats">
          <span>px <b>${(x.price || 0).toFixed(2)}</b></span>
          <span>$ADV <b>{fmtB(x.dollarADV)}</b></span>
          {x.fit != null && <span>fit <b>{x.fit.toFixed(2)}</b></span>}
          {extra}
        </div>
        {x.fitWhy && <div className="fitwhy">{x.fitWhy}</div>}
      </div>
    </label>
  );
}
