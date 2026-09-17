import { useEffect, useRef, useState } from "react";
import RunLog from "../lib/runlog.js";
import { api, mapLimit } from "../lib/api.js";
import { searchUniverse, leveredFor, appropriateness, ETF_UNIVERSE } from "../data/etf-universe.js";
import { measuredPurity } from "../lib/correlation.js";
import { analyzeChain, realisedVol, realisedVolAvailable, chainConfidence } from "../lib/vol.js";
import { suggestStructures } from "../lib/strategy.js";
import { evaluate } from "../lib/pricing.js";
import { scalePlan, targets, scoreShares } from "../lib/shares.js";
import { orderByExpectancy, TIE_ETF, TIE_OPT } from "../lib/ordering.js";
import { dte } from "../lib/vol.js";

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

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
/* ONE definition of the hold, at module scope.

   It used to be a const inside buildMenu, which meant setPref — the
   settings-recompute that runs when execution or stop mode is changed on the
   Themes screen — could not see it. v0.28.0 added `horizonDays: hzDays` to
   setPref's scalePlan call and the reference threw: six
   "hzDays is not defined" errors on 16 Sep, one per toggle, and the recompute
   silently failed each time.

   The throw also exposed something older. setPref was already calling
   targets() and scoreShares() with NO horizon at all, so they fell back to
   the 42-day default while everything else in the app used 24 — a leg
   re-planned by changing its stop mode was being scored over a different
   hold from the one it was built with.

   "weeks" is the 3-to-4 week default hold. The shorter horizon narrows the
   distribution ~8% against the old 28, which lowers every expectancy, raises
   P(stopped) relative to the move, and leaves more option structures marked
   with life left rather than settled. */
export const horizonDays = h => ({ days: 10, weeks: 24, months: 90 }[h] || 24);

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
  const hzDays = horizonDays(horizon);
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

  /* PURITY, measured where it can be. It now multiplies the drift on every
     expectancy, so the hand-set pur values are coefficients rather than
     tie-breakers and deserve evidence. Where the anchor has a pure vehicle
     (pur >= 0.99) that is not the primary itself, its bars give a regression
     against which the proxy's shared variance can be measured. One extra
     bars call, and only for an impure primary. */
  let purity = primary.pur ?? 1, purityFrom = "stated", purityDetail = null;
  const pureRef = (primary.pur ?? 1) < 0.99
    ? ETF_UNIVERSE.find(e => (e.pur ?? 0) >= 0.99 && e.t !== primary.t &&
        (e.a || []).some(a => (primary.a || []).includes(a)))
    : null;

  // chain analytics on the primary only — one heavy call per theme
  let vol = null, structures = [], liq = "X", optionsBlocked = [];
  let plan = null, tgt = null, shareScore = null;
  /* Retained for the correlation view. These bars are fetched anyway for the
     realised-vol read and were being thrown away; closes only, so the theme
     object does not carry 120 OHLCV rows per leg. */
  let closes = [];
  try {
    const [chain, bars] = await Promise.all([
      api.chain(primary.t, primary.price),
      api.bars(primary.t, new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10)),
    ]);
    liq = grade(chain?.quality);
    RunLog.gate(`liquidity:${primary.t}`, liq !== "X", { grade: liq, ...chain?.quality });
    closes = (bars?.bars || []).map(b => b?.c).filter(c => typeof c === "number" && c > 0);
    if (pureRef) {
      try {
        const pb = await api.bars(pureRef.t, new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10));
        const mp = measuredPurity(bars?.bars || [], pb?.bars || [], { stated: primary.pur ?? 1 });
        purity = mp.purity ?? purity; purityFrom = mp.from; purityDetail = { ...mp, against: pureRef.t };
        RunLog.info("calc", `purity.${primary.t}`, { against: pureRef.t, stated: primary.pur,
          measured: mp.from === "measured" ? mp.purity : null, beta: mp.beta, r: mp.r,
          sessions: mp.sessions, used: purity, from: purityFrom, reason: mp.reason });
      } catch (e) {
        RunLog.warn("calc", `purity.${primary.t}`, { against: pureRef.t,
          error: String(e?.message || e), used: purity, from: "stated" });
      }
    } else if ((primary.pur ?? 1) < 0.99) {
      /* Not a failure, a structural limit worth seeing: a thematic anchor
         has no pure vehicle because its purest fund IS a proxy. "power" and
         "cyber" have none; "gold" has GLD. Without this line the absence of
         a purity.* entry is indistinguishable from a call that threw. */
      RunLog.info("calc", `purity.${primary.t}`, { stated: primary.pur, used: purity,
        from: "stated", reason: `no pure vehicle in the universe for ${JSON.stringify(primary.a || [])}` });
    }
    const rv = realisedVol(bars?.bars || [], 30);
    if (liq !== "X") {
      vol = analyzeChain(primary.t, chain.contracts, primary.price);
      vol.rv30 = rv;
      /* Purity rides on vol because that is what scoreShares reads. It
         scales the DRIFT only — the width already carries the proxy's own
         beta as variance. */
      vol.purity = purity; vol.purityFrom = purityFrom;
      const cc = chainConfidence(chain?.quality);
      vol.confidence = cc.confidence; vol.confidenceFrom = cc.from;
      RunLog.info("calc", `confidence.${primary.t}`, cc);
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
                       { execution: theme.execution || "scaled", mode: theme.stopMode || "wall", horizonDays: hzDays });
      /* THE HORIZON, which this call omitted. scoreShares and targets both
         default to 42 days, so every primary with a tradable chain has been
         scored over six weeks while the note promised three to four, the
         option structures were valued at 24, and the shares-only branch
         twenty lines below passed 24 correctly.

         The clocks fix in v0.23.1 put options and shares on one clock inside
         scoreEconomics and never checked that the CALLER agreed. It surfaced
         only when v0.31.1 made setPref pass the horizon: toggling any
         setting silently re-scored the leg from 42 days to 24, moving IBIT
         from EV 10.34 / P(stopped) 11.4% to 8.32 / 5.3% on a change that
         cannot affect either. */
      tgt  = targets(primary.price, vol, theme.direction, hzDays);
      shareScore = plan && tgt
        ? scoreShares(plan, tgt, { ...vol, ticker: primary.t },
                      { direction: theme.direction, conviction: conv, liq, horizonDays: hzDays })
        : null;

      RunLog.info("ui", `structures.${primary.t}`, {
        considered: cands.length, priced: structures.length,
        ranked: structures.map(s2 => `${s2.id}:${s2.econ.score}`),
        shares: shareScore ? `${primary.t}:${shareScore.score}` : null,
      });
    } else {
      /* Grade X blocks the OPTIONS, not the trade. The key has always said
         "no usable chain — shares only", but the shares leg was built inside
         this gate, so an X ticker produced no plan and dropped out of the
         ETF table. NCLD won its theme on fit and then disappeared.
         With no chain there are no walls and no implied vol, so the plan is
         immediate with the flat stop and everything is measured off realised
         vol instead. The leg carries volFrom "realised" so the note says so. */
      /* rv30 needs 31 bars and a fund that launched five weeks ago has 23,
         so the strict 30-day number is null for exactly the vehicles this
         branch exists to rescue. Take the longest window the history
         supports and carry it, so the note can name it rather than imply a
         30-day figure it does not have. */
      const rvA = realisedVolAvailable(bars?.bars || []);
      vol = { ticker: primary.t, iv30: null, rv30: rvA?.rv ?? rv,
              rvWindow: rvA?.window ?? (rv != null ? 30 : null),
              putWall: null, callWall: null,
              purity, purityFrom };
      plan = scalePlan(primary.price, vol, theme.direction, { execution: "immediate", mode: "flat", horizonDays: hzDays });
      tgt  = targets(primary.price, vol, theme.direction, hzDays);
      shareScore = plan && tgt
        ? scoreShares(plan, tgt, vol, { direction: theme.direction,
                                        conviction: theme.conviction || "medium", liq, horizonDays: hzDays })
        : null;
      RunLog.info("ui", `shares.only.${primary.t}`, {
        reason: "no usable option chain",
        bars: bars?.bars?.length ?? 0, rv: vol.rv30, rvWindow: vol.rvWindow,
        planned: Boolean(plan), scored: Boolean(shareScore),
        stop: plan?.stop != null ? +plan.stop.toFixed(2) : null,
        target: tgt?.struct != null ? +tgt.struct.toFixed(2) : null,
        dropped: !shareScore ? "no expectancy — the leg will not reach the ETF table" : undefined,
      });
    }
  } catch (e) { RunLog.error("ui", `chain ${primary.t}`, e); }

  /* SECONDARY VEHICLES GET A PLAN TOO.

     Chain analytics run on the primary only — one heavy call per theme — so
     a secondary carried nothing but a ticker, a price and a fit score.
     Ticking one produced a leg with no plan, no target and no expectancy,
     which then failed compose's `t.etf?.share` filter and vanished from the
     rail entirely, WHILE the drafter went on writing a paragraph about it
     from draftContext. The note described a position whose levels were not
     on the page. Swapping GLD for IAU lost the leg the same way.

     Each secondary now gets the shares-only treatment: its own bars, its own
     realised vol, a volatility-banded ladder and a flat stop — the same path
     a grade-X name takes. One bars call each, no chain call, and the leg is
     marked noChain so the note says the levels are not wall-derived.

     A chain call per secondary would give wall-anchored levels, but there
     are up to three of them per theme and they are alternatives, not
     selections. If you tick one regularly, that is the argument for
     promoting it in the universe rather than for four chain calls a theme. */
  const secondaryScored = await mapLimit(secondary, 2, async e => {
    try {
      const sb = await api.bars(e.t, new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10));
      const srv = realisedVolAvailable(sb?.bars || []);
      if (srv?.rv == null) return e;
      const sv = { ticker: e.t, iv30: null, rv30: srv.rv, rvWindow: srv.window,
                   putWall: null, callWall: null,
                   purity: e.pur ?? 1, purityFrom: "stated",
                   confidence: 1, confidenceFrom: "none" };
      const sp = scalePlan(e.price, sv, theme.direction,
                           { execution: theme.execution || "scaled", mode: "flat", horizonDays: hzDays });
      const st = targets(e.price, sv, theme.direction, hzDays);
      const ss = sp && st ? scoreShares(sp, st, sv, { direction: theme.direction,
                    conviction: theme.conviction || "medium", liq: e.liq, horizonDays: hzDays }) : null;
      return { ...e, plan: sp, tgt: st, shareScore: ss, vol: sv, noChain: true,
               closes: (sb?.bars || []).map(b => b?.c).filter(c => typeof c === "number" && c > 0) };
    } catch { return e; }
  });
  const scoredCount = secondaryScored.filter(x => x.shareScore).length;
  RunLog.info("ui", `secondary.${theme.id}`, {
    considered: secondary.map(s => s.t), scored: scoredCount,
    unscored: secondaryScored.filter(x => !x.shareScore).map(x => x.t) });

  t.end({ primary: primary.t, secondary: secondary.map(s => s.t), levered: levered.map(l => l.t), structures: structures.length });
  /* One ranked list across every expression of the theme. */
  const allExpr = [
    ...(shareScore ? [{ kind: "etf", label: `${primary.t} shares`, score: shareScore.score,
                        ev: shareScore.expectancy, detail: shareScore }] : []),
    ...structures.map(st => ({ kind: "option", label: `${primary.t} ${st.name.toLowerCase()}`,
                               score: st.econ.score, ev: +(st.econ.ev / 100).toFixed(2), detail: st })),
  ].sort((a, b) => b.score - a.score);
  if (allExpr.length) RunLog.info("ui", `ranked.${theme.id}`, { order: allExpr.map(e => `${e.label}:${e.score}`) });

  return { ...theme, horizon, primary: { ...primary, liq, plan, tgt, shareScore, closes,
                                purity, purityFrom, purityDetail },
           secondary: secondaryScored, levered, vol, structures, optionsBlocked, allExpr };
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

  /* FLIP A THEME'S DIRECTION.

     The extractor reads direction from prose, and prose can carry two
     arguments at once. On 17 Sep it returned a BEARISH long-Treasuries leg
     inside a note whose other three legs were bearish precisely because a
     credible hike removes the inflation premium — and the inflation premium
     is most of what duration pays for. The same thesis that makes you
     bearish gold makes you bullish long bonds. There was a coherent
     alternative in the prose (record hyperscaler and corporate supply
     competing for capital, a term-premium story), but it is a different
     thesis from the one the rest of the note rests on.

     The correlation flag caught it — TLT at 0.13 against the others, "either
     diversifies the view or does not express it" — and there was no way to
     act on that without re-extracting the whole source.

     A flip re-runs the theme rather than patching it: direction sets the
     ladder's direction, which wall is entry and which is exit, the sign of
     the drift, and whether puts or calls are priced. Patching the ETF leg
     alone would leave option structures built for the opposite view. */
  /* Conflicts ride on the parsed object from enforce(). */
  const conflictFor = id => (parsed?.conflicts || []).find(c => c.id === id) || null;

  async function flipDirection(id) {
    const m = menus.find(x => x.id === id);
    if (!m) return;
    const to = m.direction === "bearish" ? "bullish" : "bearish";
    setMerging(`flip::${id}`);
    RunLog.info("ui", "theme.direction.flip", { id, from: m.direction, to, ticker: m.primary?.t });
    try {
      const built = await buildMenu({ ...m, direction: to }, null, m.horizon || "weeks");
      const next = menus.map(x => (x.id === id ? built : x));
      setMenus(next); setMenuCache(next);
      /* Selections referenced the old structures, which were priced for the
         opposite view; drop this theme's picks rather than carry them over. */
      setPicks(p => ({ ...p, sel: Object.fromEntries(
        Object.entries(p.sel || {}).filter(([, v]) => v.themeId !== id)) }));
    } finally { setMerging(null); }
  }

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
      /* The same hold the leg was BUILT with. Passing nothing here let
         targets() and scoreShares() fall back to 42 days, so changing a stop
         mode quietly re-scored the leg over a different horizon. */
      const hz = horizonDays(t2.horizon || "weeks");
      const plan = scalePlan(t2.primary.price, { ...t2.vol, ticker: t2.primary.t }, t2.direction,
                             { execution: t2.execution || "scaled", mode: t2.stopMode || "wall", horizonDays: hz });
      const tgt = targets(t2.primary.price, t2.vol, t2.direction, hz);
      const sh = plan && tgt ? scoreShares(plan, tgt, { ...t2.vol, ticker: t2.primary.t },
                                            { direction: t2.direction, conviction: t2.conviction || "medium",
                                              liq: t2.primary.liq, horizonDays: hz }) : null;
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
            Compose note with {chosen.length} expression{chosen.length === 1 ? "" : "s"} →
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
            {(() => {
              const hits = (parsed.attributionFlags || []).filter(f => f.startsWith(m.id + "."));
              if (!hits.length) return null;
              /* Flags arrive as "<themeId>.<field>:<phrase>". Show both — the
                 pill used to say only that something in the theme tripped it,
                 which is not enough to decide whether it is a real
                 attribution or the verb "reports" used about a data release. */
              const detail = hits.map(f => f.slice(m.id.length + 1).replace(":", " — ")).join("; ");
              return <span className="pill x" title={`Reads like it attributes a view to someone: ${detail}. Check before publishing.`}>check attribution</span>;
            })()}
            <span className="spacer" />
            <label className="mini"><input type="radio" name="primary" checked={picks.primaryThemeId === m.id}
                   onChange={() => setPrimaryTheme(m.id)} /> primary</label>
            <label className="mini"><input type="checkbox" checked={picks.split.includes(m.id)}
                   onChange={() => toggleSplit(m.id)} /> own note</label>
            {(() => {
              /* scalePlan forces immediate when the last sale sits inside
                 NEAR_WALL of the wall being faded — the call wall on a bearish
                 leg, the put wall on a bullish one — because there is no room
                 left to ladder. The toggle used to show the analyst's stored
                 preference, so it read "scaled" while the plan underneath was
                 immediate, with nothing on screen saying why. It now shows
                 what the leg will actually do. */
              const p = m.primary?.plan;
              const forced = Boolean(p?.single) && m.execution !== "immediate";
              /* The reason comes from scalePlan, which is the only thing that
                 knows WHY a leg is single — proximity to the wall, or no wall
                 at all because there is no chain. This used to rebuild the
                 proximity sentence here, which crashed the whole step the
                 first time a wall-less plan arrived: distToWallPct is null
                 when there is no wall, and null.toFixed throws. One source. */
              const why = forced
                ? `${cap(p.reason || "this leg goes on at current levels")}. Clicking scaled will not override it.`
                : "ETF execution";
              return (<>
                {/* A subject and a direction that disagree — "Long Gold" on a
                    bearish theme. The tool cannot know which field is wrong,
                    so it says so here, beside the control that fixes it. */}
                {conflictFor(m.id) && (
                  <span className="conflict" title={conflictFor(m.id).why}>
                    subject says &ldquo;{conflictFor(m.id).subject}&rdquo;
                  </span>
                )}
                {/* Direction sits with the other leg controls because it is
                    the same kind of decision — how the position is put on —
                    and because an extraction can get it wrong. It re-runs the
                    theme rather than patching it: the ladder, the walls, the
                    drift sign and whether puts or calls are priced all turn
                    on it. */}
                <span className="legtoggle" title="The extractor reads direction from prose, which can carry two arguments at once. Flipping re-prices the whole theme.">
                  <button className={m.direction === "bearish" ? "on" : ""}
                          disabled={merging === `flip::${m.id}`}
                          onClick={() => m.direction !== "bearish" && flipDirection(m.id)}>bearish</button>
                  <button className={m.direction === "bullish" ? "on" : ""}
                          disabled={merging === `flip::${m.id}`}
                          onClick={() => m.direction !== "bullish" && flipDirection(m.id)}>bullish</button>
                </span>
                {/* CONVICTION, which until v0.34.0 could not be set by anyone.
                    The extractor never returned it and there was no control,
                    so every theme fell back to medium and every leg got the
                    same 0.6 sigma drift — a document calling one thing a
                    major negative and another a mild negative priced both
                    identically. It is the largest single lever in the
                    scoring, so it belongs on the leg controls. */}
                <span className="legtoggle" title="Shifts the whole distribution: 0.3 sigma low, 0.6 medium, 1.0 high. Read from the document's own emphasis; override where you disagree.">
                  {["low", "medium", "high"].map(c => (
                    <button key={c} className={(m.conviction || "medium") === c ? "on" : ""}
                            onClick={() => setPref(m.id, "conviction", c)}>{c}</button>
                  ))}
                </span>
                <span className={`legtoggle ${forced ? "forced" : ""}`} title={why}>
                  <button className={!forced && (m.execution || "scaled") === "scaled" ? "on" : ""}
                          onClick={() => setPref(m.id, "execution", "scaled")}>scaled</button>
                  <button className={forced || m.execution === "immediate" ? "on" : ""}
                          onClick={() => setPref(m.id, "execution", "immediate")}>
                    immediate{forced ? " · auto" : ""}
                  </button>
                </span>
              </>);
            })()}
            {(() => {
              /* With no chain there is no wall to stop beyond, so the wall
                 option is not a choice the analyst has here. */
              const noWall = Boolean(m.primary?.plan?.noWall);
              return (
                <span className={`legtoggle ${noWall ? "forced" : ""}`}
                      title={noWall ? "No option chain on this vehicle, so there is no wall to stop beyond — the flat stop is the only one available." : "Stop out"}>
                  <button disabled={noWall} className={!noWall && (m.stopMode || "wall") === "wall" ? "on" : ""}
                          onClick={() => setPref(m.id, "stopMode", "wall")}>stop: wall +1%</button>
                  <button className={noWall || m.stopMode === "flat" ? "on sh" : ""}
                          onClick={() => setPref(m.id, "stopMode", "flat")}>flat 5%{noWall ? " · auto" : ""}</button>
                </span>
              );
            })()}
            {m.combinedFrom && <button className="ib-btn" onClick={() => splitCluster(m.id)}>split</button>}
          </div>

          {/* On a contra run the evidence sentence is the claim being FADED,
              not support for the position. Labelling it "evidence" would read
              as the document backing a trade it in fact argues against. */}
          {m.evidence
            ? <>
                {parsed.contra && <div className="evidlab">The claim being faded</div>}
                <blockquote className={`evid ${parsed.contra ? "contra" : ""}`}>{m.evidence}</blockquote>
              </>
            : <div className="evid ext">
                {parsed.contra
                  ? "Fading the document's argument — no single sentence carries the claim."
                  : "Extended from your argument — no direct sentence supports this."}
              </div>}
          <div className="why" style={{ marginBottom: 10 }}>{m.rationale}</div>

          {m.none && <div className="note">No ETF in the universe cleanly expresses this theme. Consider single names, or add a fund to the table.</div>}

          {m.primary && (
            <>
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

              <div className="tier">
                <span className="tierlab">Primary — ETF expression</span>
                <ExprRow x={m.primary} kind="primary" themeId={m.id} on={on} toggle={toggle} liq={m.primary.liq}
                         score={m.primary.shareScore?.score} walls={m.vol} />
                {m.primary.plan && m.primary.shareScore && (
                  <div className="planrow">
                    <span>{m.primary.plan.single ? "immediate" : "scale"} <b>
                      {m.primary.plan.single ? "at current levels"
                        : `${m.primary.price.toFixed(2)} → ${m.primary.plan.wall}`}</b></span>
                    {!m.primary.plan.single && <span>entry <b>{m.primary.plan.entry.toFixed(2)}</b></span>}
                    {/* A wall target is a round strike; a sigma target is a raw float. */}
                    {/* The structural level is still shown — it is real
                        information about where the OI sits — but the score no
                        longer reads it, so it is labelled as structure rather
                        than as the trade's objective. */}
                    <span>struct <b>{m.primary.tgt.struct?.toFixed(2) ?? "\u2014"}</b>{m.primary.tgt.volFrom === "realised" ? " (realised)" : ""}</span>
                    <span>stop <b>{m.primary.plan.stop.toFixed(2)}</b></span>
                    {/* Risk in SIGMA as well as percent. The old line carried
                        rewardSigma — how ambitious the target was — and
                        retiring the target took the sigma read with it. The
                        question that matters now is the other one: is the stop
                        inside the noise? 0.2σ and 1.0σ are different trades at
                        the same percentage. And evOnRisk is what the composite
                        actually ranks on, so it belongs on the line. */}
                    {/* This line is the RANKING view, so its risk is measured
                        from spot — the denominator EV/risk actually uses, and
                        the one that puts every leg on a single footing. The
                        NOTE prints risk from the weighted entry instead,
                        because that is execution economics and what its
                        caption promises. On an immediate leg the two are the
                        same; on a scaled leg they are not, so the label says
                        which this is.
                        EV appeared TWICE here from v0.25.1 to v0.32.1: a
                        coloured span already ended the line and the new one
                        was added ahead of it without noticing. */}
                    <span>risk from spot <b>{m.primary.shareScore.riskPct}%</b> ({m.primary.shareScore.riskSigma}σ)</span>
                    <span>EV <b style={{ color: m.primary.shareScore.expectancy >= 0 ? "var(--green)" : "var(--red)" }}>
                      {m.primary.shareScore.expectancy}%</b></span>
                    <span>EV/risk <b>{m.primary.shareScore.evOnRisk}</b></span>
                    <span>P(stopped) <b>{m.primary.shareScore.pStopped}%</b></span>
                    {m.primary.plan.execution === "scaled" && m.primary.plan.riskPct != null && (
                      <span className="mut">note prints <b>{m.primary.plan.riskPct.toFixed(1)}%</b> from entry</span>
                    )}
                    {m.primary.plan.reason && <span className="planwhy">{m.primary.plan.reason}</span>}
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
                                  <td>{L.qty}×</td>
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

              {m.vol?.ok && (
                <div className="volrow">
                  IV30 <b>{m.vol.iv30 ?? "—"}%</b> · RV30 <b>{m.vol.rv30 ?? "—"}%</b> ·
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

function ExprRow({ x, kind, themeId, on, toggle, liq, extra, score, walls }) {
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
          {/* Walls come from the chain, and the chain is fetched for the
              primary only — one heavy call per theme. A row without them has
              not been priced, so nothing is shown rather than a dash that
              could read as "no wall found". */}
          {walls?.putWall != null && <span>put wall <b>{walls.putWall}</b></span>}
          {walls?.callWall != null && <span>call wall <b>{walls.callWall}</b></span>}
          {extra}
        </div>
        {x.fitWhy && <div className="fitwhy">{x.fitWhy}</div>}
      </div>
    </label>
  );
}
