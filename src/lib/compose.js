/* ═══════════════════════════════════════════════════════════════════
   compose.js — build the note model from state

   Everything the note shows comes through here, from state the user has
   already seen and selected. Nothing is re-derived, nothing is invented.
   The draft prompt reads this model; the print view renders it.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";
import { orderByExpectancy, TIE_ETF, TIE_OPT, MIN_EV_ON_RISK } from "./ordering.js";
import { analyzeCorrelation, correlationNote } from "./correlation.js";
import { wallContext, wallSentence, expressionSentence, environment, consequentialWalls } from "./environment.js";

/* Round numbers stay round in the prose. toFixed(2) turned a 600 strike into
   "$600.00", which reads as false precision on a level that is exactly round.
   Trailing zeros are dropped, so 600 prints as 600 and 421.29 is untouched.
   Only the DRAFT context uses this — the exhibit tables keep fixed decimals,
   because a column of numbers should align on the decimal point. */
const fmt = (n, d = 2) => {
  if (n == null) return "—";
  const s = Number(n).toFixed(d);
  return d > 0 && /\./.test(s) ? s.replace(/\.?0+$/, "") : s;
};
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

/* The five fields the analyst types. Every one is passthrough: none reaches
   an ordering, a price or a plan, and meta is assembled after all of that is
   done. They live here so the fallbacks have a single home, and so StepNote
   can lay them over a memoised model instead of re-deriving the note on
   every keystroke. */
export function analystMeta(settings, parsed) {
  return {
    title: settings.title || parsed?.sourceTitle || "Market Commentary",
    subtitle: settings.subtitle || "",
    executeWindow: settings.executeWindow || "about a week",
    holdWindow: settings.holdWindow || "3 to 4 weeks",
    sector: settings.sector || "Cross-Asset / Macro",
  };
}

export function composeNote({ parsed, picks, menus, settings = {} }) {
  const chosen = Object.values(picks.sel || {});
  const srcRank = Object.fromEntries((parsed.themes || []).map((t, i) => [t.id, i]));
  const byId = Object.fromEntries(menus.map(m => [m.id, m]));

  // Themes carried: any theme with at least one selected expression.
  const themeIds = [...new Set(chosen.map(c => c.themeId))].filter(id => byId[id]);

  const themes = themeIds.map(id => {
    const m = byId[id];
    /* EVERY TICKED ETF IS CARRIED (0.39.0). Until then this took the first
       one it found — chosen.find — so ticking JNK beside HYG logged the tick
       and printed HYG alone, with nothing to say JNK had been dropped. The
       note now offers the reader each fund the analyst selected.
       Primary first, then secondaries in the order the menu lists them.
       A secondary with no score has no realised-vol read and so no range to
       print; it is skipped WITH a warning rather than printed hollow. */
    const tickedTk = new Set(chosen.filter(c => c.themeId === id && (c.kind === "primary" || c.kind === "secondary")).map(c => c.ticker));
    const pool = [m.primary, ...(m.secondary || [])].filter(Boolean);
    const unscored = pool.filter(x => tickedTk.has(x.t) && !x.shareScore && x.t !== m.primary?.t);
    if (unscored.length)
      RunLog.warn("calc", "etf.secondary.unscored", { theme: id, skipped: unscored.map(x => x.t),
        why: "no realised-vol read — it would print as a leg with no levels" });
    let carriedEtfs = pool.filter(x => tickedTk.has(x.t) && (x.shareScore || x.t === m.primary?.t));
    // House rule: the ETF line is always present — the asset class is the idea.
    if (!carriedEtfs.length && m.primary) carriedEtfs = [m.primary];
    const etf = carriedEtfs[0] || null;
    const optSel = chosen.filter(c => c.themeId === id && c.kind === "option");
    const options = optSel.map(o => (m.structures || []).find(st => st.id === o.ticker)).filter(Boolean);
    const alternatives = (m.structures || []).filter(st => !options.some(o => o.id === st.id));
    const levSel = chosen.filter(c => c.themeId === id && c.kind === "levered").map(c => c.ticker);

    /* What prints about entering the idea: per ETF, the wall that frames
       an entry and the facts a reader would want before deciding how to act.
       Each leg describes ITS OWN vehicle. The primary's chain is fetched
       with the theme; a secondary's is fetched when it is ticked
       (StepIdeas, chainVol) and until then it has realised vol and no walls.
       Walls too thin to matter are removed here, once, so the sentence, the
       map and the table cannot disagree about whether one exists. */
    const named = carriedEtfs.length > 1;
    const legs = carriedEtfs.map(x => {
      const isPrimary = x.t === m.primary?.t;
      const v = consequentialWalls(isPrimary ? m.vol : (x.chainVol || x.vol));
      const w = wallContext(x.price, v, m.direction);
      return { tk: x.t, name: x.name || x.n, price: x.price, primary: isPrimary,
               liq: isPrimary ? x.liq : (x.chainLiq || "X"),
               vol: v, wall: w, env: environment({ spot: x.price, vol: v, closes: x.closes }),
               wallSentence: wallSentence(x.t, w, { named }) };
    });
    const volCarried = legs[0]?.vol ?? m.vol;
    const wall = legs[0]?.wall ?? null, env = legs[0]?.env ?? null;

    return {
      id, subject: m.subject, direction: m.direction, basis: m.basis,
      legs, expressionSentence: expressionSentence(legs.map(l => l.tk)),
      wall, env, wallSentence: legs[0]?.wallSentence ?? null,
      evidence: m.evidence, rationale: m.rationale, catalyst: m.catalyst,
      execution: m.execution || "scaled", stopMode: m.stopMode || "wall",
      etf: etf ? {
        tk: etf.t, name: etf.name || etf.n, liq: etf.liq, price: etf.price,
        plan: etf.plan, tgt: etf.tgt, share: etf.shareScore,
      } : null,
      options, alternatives,
      screening: {
        considered: [...(m.secondary || []).map(s => s.t)],
        whyNot: (m.secondary || []).map(s => `${s.t}: ${s.fitWhy || ""}`).join("; "),
      },
      /* Split, because a carried levered fund and a rejected one are opposite
         statements. `selected` was computed here and never read, so ticking
         GLL did nothing at all and Exhibit 2 went on calling it "Not
         Recommended" while the analyst had chosen it.
         A levered position has no chain of its own, so its levels are derived
         from the underlying: the same stop, expressed at |leverage| times the
         move. That is approximate by construction — daily reset means the
         realised multiple drifts from the stated one over a hold. */
      levered: (m.levered || []).filter(l => !levSel.includes(l.t))
        .map(l => ({ tk: l.t, lev: l.lev, gamma: l.gamma })),
      leveredCarried: (m.levered || []).filter(l => levSel.includes(l.t))
        .map(l => ({
          tk: l.t, lev: l.lev, gamma: l.gamma, price: l.price ?? null,
          underlying: m.primary?.t ?? null,
          ulStop: m.primary?.plan?.stop ?? null,   // internal; not printed since 0.38.0
          /* Execution economics, like the rest of the page: the underlying
             plan's entry-based risk at the stated multiple. The ranking's
             spot-based risk lives in the score, not the note. */
          riskPct: m.primary?.plan?.riskPct != null
            ? +(m.primary.plan.riskPct * Math.abs(l.lev || 1)).toFixed(1) : null,
        })),
      /* The volatility panel must describe the vehicle actually carried.
         A ticked secondary is scored off its own realised vol and has no
         chain, so printing the primary's walls under its ticker would be
         plainly wrong. */
      vol: volCarried,
      contracts: (etf && etf.t !== m.primary?.t) ? 0 : m.vol?.contracts,
    };
  });

  /* THE SEQUENCE. Immediate first, then by score.

     "Immediate" now means one thing only: the wall is inside the 2% band, so
     there is no room to ladder. A leg with no wall at all SCALES over a
     volatility band — scaling needs a price band, not a wall, and without a
     wall nothing is forcing the position on today. Before that change,
     immediate-first would have promoted exactly the legs with no structure
     behind them: GRID led its note on 16 Sep for precisely that reason.

     So the top of the note is now legs whose entry has real
     resistance or support helping it, ranked among themselves by score.
     Expectancy stays the tiebreak inside a band, as before.

     EV/risk below MIN_EV_ON_RISK is excluded from carrying — the view is
     worth less than what is being risked for it. Excluded legs are RETAINED
     with a reason rather than dropped silently, so the omission is visible
     and can be overruled. */
  const carried = themes.filter(t => t.etf?.share);
  /* The analyst can carry a leg the gate would exclude. The gate is a
     backstop against a broken leg, not a veto over a view — and a thin
     expected move on a deliberate hedge is a legitimate reason to carry
     something the ratio dislikes. */
  const forced = new Set(settings.forceCarry || []);
  const weak = carried.filter(t => (t.etf.share.evOnRisk ?? 0) < MIN_EV_ON_RISK && !forced.has(t.etf.tk))
    .map(t => ({ tk: t.etf.tk, themeId: t.id, evOnRisk: t.etf.share.evOnRisk,
                 why: `EV/risk ${(t.etf.share.evOnRisk ?? 0).toFixed(2)} is below ${MIN_EV_ON_RISK} — the view is worth less than the risk taken for it` }));
  if (weak.length) RunLog.warn("calc", "etf.excluded.weak", { legs: weak });
  const eligible = carried.filter(t => (t.etf.share.evOnRisk ?? 0) >= MIN_EV_ON_RISK || forced.has(t.etf.tk));
  if (forced.size) RunLog.info("calc", "etf.forced.carry", { legs: [...forced] });

  const etfOrder = orderByExpectancy(
    eligible.map(t => ({ label: t.etf.tk, themeId: t.id, ev: t.etf.share.expectancy,
                         immediate: t.etf.plan?.execution === "immediate",
                         score: t.etf.share.score ?? 0 })),
    { key: r => r.ev, band: TIE_ETF, sourceRank: r => srcRank[r.themeId] ?? 99, label: "note.order.etf" });

  /* Immediate legs move to the front, each group keeping the expectancy
     order the tie logic just produced, then re-sorted by score within the
     group — the analyst's stated preference. */
  const byGroup = [...etfOrder].sort((a, b) =>
    (b.immediate ? 1 : 0) - (a.immediate ? 1 : 0) || (b.score - a.score));
  RunLog.info("calc", "note.order.etf.grouped", {
    order: byGroup.map(r => `${r.label}:${r.immediate ? "immediate" : "scaled"}:${r.score}`),
    excluded: weak.map(w => w.tk) });

  /* The derivatives panel follows the ETF sequence rather than ranking
     independently. An option is the same idea expressed differently — the
     right tool when spot is not where you want to buy — so reading the note
     theme by theme beats reading it instrument by instrument. Within one
     theme, structures keep their economic order. */
  const etfRank = Object.fromEntries(byGroup.map((r, i) => [r.themeId, i]));
  const optOrder = orderByExpectancy(
    themes.flatMap(t => t.options.map(o => ({
      label: `${t.etf?.tk} ${o.name.toLowerCase()}`, themeId: t.id, structId: o.id,
      evPerRisk: o.econ.ev / Math.max(1, o.pricing.risk) })))
      /* A structure belongs to its theme: if the theme is not carried,
         neither is its option. */
      .filter(r => etfRank[r.themeId] != null),
    { key: r => r.evPerRisk, band: TIE_OPT, sourceRank: r => srcRank[r.themeId] ?? 99, label: "note.order.derivatives" })
    .sort((a, b) => (etfRank[a.themeId] ?? 99) - (etfRank[b.themeId] ?? 99));

  /* ONLY WHAT IS CARRIED IS IN THE NOTE (0.39.1).
     This used to append every theme the gate had excluded. They were never
     printed — the page walks etfOrder — but they were still in note.themes,
     so the drafter wrote a paragraph for each (Semiconductors on 5 Oct,
     Investment Grade Credit the run before: about a hundred words apiece
     that nobody saw), the header's subject line listed an idea the note did
     not contain, the summary was free to argue it, and "accept all" waited
     on a section that was not on the page.
     An excluded theme now lives in weakLegs alone, where the analyst can
     see why and carry it anyway. */
  const orderedThemes = byGroup.map(r => themes.find(t => t.id === r.themeId)).filter(Boolean);
  const dropped = themes.filter(t => !byGroup.some(r => r.themeId === t.id));
  if (dropped.length) RunLog.info("calc", "note.themes.not.carried", {
    themes: dropped.map(t => t.subject), why: "gated out or unscored — kept out of the header, the draft and the page" });

  const dirs = [...new Set((orderedThemes.length ? orderedThemes : themes).map(t => t.direction))];
  const meta = {
    date: settings.date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    ...analystMeta(settings, parsed),
    direction: dirs.length === 1 ? dirs[0] : "mixed",
    subjects: orderedThemes.map(t => t.subject),
    analyst: settings.analyst || { name: "Mike O'Rourke, CMT", title: "Chief Market Strategist",
                                   email: "morourke@jonestrading.com", phone: "203.413.5020" },
    model: parsed.model,
  };

  const note = {
    /* Correlation across the CARRIED legs. Not part of any ordering — see
       correlation.js for why ranking is deliberately left alone. It informs
       sizing and flags the leg that is not in the trade. */
    correlation: (() => {
      const c = analyzeCorrelation(orderedThemes
        .filter(t => t.etf?.tk)
        .map(t => ({ ticker: t.etf.tk, direction: t.direction,
                     bars: menus.find(m => m.id === t.id)?.primary?.closes,
                     riskPct: t.etf.share?.riskPct })));
      return c && { ...c, sentence: correlationNote(c) };
    })(),
    meta, themes: orderedThemes, etfOrder: byGroup, optOrder, weakLegs: weak,
    contra: Boolean(parsed.contra),
    risks: parsed.risks || [],
    prose: settings.prose || { summary: "", themes: {}, execution: "" },
  };
  RunLog.fact("note.composed", { themes: themeIds, etf: etfOrder.map(r => r.label), opts: optOrder.map(r => r.label) },
              { src: "compose" });
  return note;
}

/* Compact view of the model for the draft prompt — enough to write from,
   without the chain. Numbers are pre-formatted so the model quotes them
   rather than recomputing. */
export function draftContext(note) {
  return {
    /* The draft has to know it is a fade. Without this the extractor returned
       bearish themes and the drafter wrote them up as ordinary bearish views,
       never engaging with the document they were taken against — which is the
       whole point of a contra note. */
    contra: Boolean(note.contra),
    title: note.meta.title, subtitle: note.meta.subtitle, date: note.meta.date,
    /* No execute window and no hold window: the note names neither. */
    risks: note.risks,
    themes: note.themes.map(t => ({
      subject: t.subject, direction: t.direction, evidence: t.evidence, rationale: t.rationale,
      catalyst: t.catalyst?.description || null, catalystDate: t.catalyst?.date || null,
      ...(() => { const etfs = (t.legs || []).map(L => {
        /* WHAT THE DRAFTER IS GIVEN IS WHAT IT WILL WRITE (rule 6), so the
           model it sees contains no entry, no scale band, no weighted
           average, no stop and no risk figure. Until 0.37 it carried all
           five and the paragraph was a set of instructions. It now carries
           the wall that frames an entry and facts about the environment;
           how to act on them is the reader's decision.
           The last sale is still withheld — it is stale by the time the
           note is read — so distances are sent as percentages and the wall
           as a level. */
        const w = L.wall, e = L.env || {};
        const range = e.rangeLo != null ? `${fmt(e.rangeLo, 0)} to ${fmt(e.rangeHi, 0)}` : null;
        return {
          ticker: L.tk,
          /* The closing sentence, verbatim. Built in environment.js so the
             wording and the 7% rule have one home. */
          wallSentence: L.wallSentence,
          wall: !w || w.none ? { noWall: true, noChain: !w?.hasChain, ...(w?.thin ? { thinOpenInterest: true } : {}) }
            : { type: `${w.side} wall`, role: w.role, level: w.level,
                distancePct: w.distancePct, direction: w.rel, proximity: w.proximity,
                ...(w.nextLevel != null ? { nextConcentration: w.nextLevel } : {}) },
          ...(!w || w.none ? {} : { putWall: L.vol?.putWall, callWall: L.vol?.callWall }),
          oneMonthRange: range,
          rangeBasis: e.rangeBasis === "realised"
            ? `realised volatility over ${e.rangeWindow} sessions${e.rangeWindow < 30 ? " — all the history this fund has" : ""}`
            : "option-implied",
          ...(e.ivOverRv != null ? {
            impliedVol: fmt(e.iv30, 1), realisedVol: fmt(e.rv30, 1),
            impliedVersusRealised: e.ivOverRv >= 1.1 ? "implied above realised — options are pricing more movement than the tape has delivered"
              : e.ivOverRv <= 0.9 ? "implied below realised — options are pricing less movement than the tape has delivered"
              : "implied in line with realised" } : {}),
          ...(e.avgDailyMovePct != null ? { averageDailyMovePct: fmt(e.avgDailyMovePct, 1) } : {}),
          ...(e.rangePosition != null ? {
            threeMonthCloseRange: `${fmt(e.closeLo)} to ${fmt(e.closeHi)}`,
            positionInThreeMonthRange: e.rangePosition <= 20 ? "near the low" : e.rangePosition >= 80 ? "near the high" : "mid-range" } : {}),
        };
      });
        /* `etf` stays as the first fund so anything reading the old shape
           still works; `etfs` is every fund carried, and the expression
           sentence names them all. */
        return { expressionSentence: t.expressionSentence, etf: etfs[0] || null, etfs };
      })(),
      vol: t.vol && { rr25: t.vol.rr25, term: t.vol.termSlope },
      options: t.options.map(o => ({
        structure: o.name, expiry: o.expiry, legs: o.legText,
        net: fmt(Math.abs(o.pricing.net) / 100), debitOrCredit: o.pricing.net > 0 ? "debit" : "credit",
        maxGain: (o.pricing.gainUnbounded ?? o.pricing.uncapped) ? "uncapped" : fmt(o.pricing.maxGain / 100),
        /* Max loss travels with max gain (Rule 2220 balance). POP does NOT
           reach the drafter: it is a projected outcome, which market
           commentary may not carry. It stays on screen and in the ledger. */
        maxLoss: o.pricing.lossUnbounded ? "unlimited"
          : fmt(Math.abs(Math.min(0, o.pricing.maxLossFull ?? o.pricing.maxLoss)) / 100),
        breakeven: (o.pricing.breakevens || []).join(" / ") || null,
        why: o.why,
      })),
    })),
  };
}
