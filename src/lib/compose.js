/* ═══════════════════════════════════════════════════════════════════
   compose.js — build the note model from state

   Everything the note shows comes through here, from state the user has
   already seen and selected. Nothing is re-derived, nothing is invented.
   The draft prompt reads this model; the print view renders it.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";
import { orderByExpectancy, TIE_ETF, TIE_OPT } from "./ordering.js";
import { leveredFor } from "../data/etf-universe.js";

const fmt = (n, d = 2) => n == null ? "—" : Number(n).toFixed(d);
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

export function composeNote({ parsed, picks, menus, settings = {} }) {
  const chosen = Object.values(picks.sel || {});
  const srcRank = Object.fromEntries((parsed.themes || []).map((t, i) => [t.id, i]));
  const byId = Object.fromEntries(menus.map(m => [m.id, m]));

  // Themes carried: any theme with at least one selected expression.
  const themeIds = [...new Set(chosen.map(c => c.themeId))].filter(id => byId[id]);

  const themes = themeIds.map(id => {
    const m = byId[id];
    const etfSel = chosen.find(c => c.themeId === id && (c.kind === "primary" || c.kind === "secondary"));
    // House rule: the ETF line is always present — the asset class is the idea.
    const etfTk = etfSel?.ticker || m.primary?.t;
    const etf = m.primary?.t === etfTk ? m.primary : (m.secondary || []).find(s => s.t === etfTk) || m.primary;
    const optSel = chosen.filter(c => c.themeId === id && c.kind === "option");
    const options = optSel.map(o => (m.structures || []).find(st => st.id === o.ticker)).filter(Boolean);
    const alternatives = (m.structures || []).filter(st => !options.some(o => o.id === st.id));
    const levSel = chosen.filter(c => c.themeId === id && c.kind === "levered").map(c => c.ticker);

    return {
      id, subject: m.subject, direction: m.direction, basis: m.basis,
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
      levered: (m.levered || []).map(l => ({ tk: l.t, lev: l.lev, gamma: l.gamma, selected: levSel.includes(l.t) })),
      vol: m.vol,
      contracts: m.vol?.contracts,
    };
  });

  // Two ordered sections, no stated criterion.
  const etfOrder = orderByExpectancy(
    themes.filter(t => t.etf?.share).map(t => ({ label: t.etf.tk, themeId: t.id, ev: t.etf.share.expectancy })),
    { key: r => r.ev, band: TIE_ETF, sourceRank: r => srcRank[r.themeId] ?? 99, label: "note.order.etf" });
  const optOrder = orderByExpectancy(
    themes.flatMap(t => t.options.map(o => ({
      label: `${t.etf?.tk} ${o.name.toLowerCase()}`, themeId: t.id, structId: o.id,
      evPerRisk: o.econ.ev / Math.max(1, o.pricing.risk) }))),
    { key: r => r.evPerRisk, band: TIE_OPT, sourceRank: r => srcRank[r.themeId] ?? 99, label: "note.order.derivatives" });

  const orderedThemes = etfOrder.map(r => themes.find(t => t.id === r.themeId))
    .concat(themes.filter(t => !etfOrder.some(r => r.themeId === t.id)));

  const dirs = [...new Set(themes.map(t => t.direction))];
  const meta = {
    date: settings.date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    title: settings.title || parsed.sourceTitle || "Tactical Note",
    subtitle: settings.subtitle || "",
    direction: dirs.length === 1 ? dirs[0] : "mixed",
    subjects: orderedThemes.map(t => t.subject),
    executeWindow: settings.executeWindow || "5 to 10 days",
    holdWindow: settings.holdWindow || "4 to 6 weeks",
    sector: settings.sector || "Cross-Asset / Macro",
    analyst: settings.analyst || { name: "Mike O'Rourke, CMT", title: "Chief Market Strategist",
                                   email: "morourke@jonestrading.com", phone: "203.413.5020" },
    model: parsed.model,
  };

  const note = {
    meta, themes: orderedThemes, etfOrder, optOrder,
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
    title: note.meta.title, subtitle: note.meta.subtitle, date: note.meta.date,
    executeWindow: note.meta.executeWindow, holdWindow: note.meta.holdWindow,
    risks: note.risks,
    themes: note.themes.map(t => ({
      subject: t.subject, direction: t.direction, evidence: t.evidence, rationale: t.rationale,
      catalyst: t.catalyst?.description || null, catalystDate: t.catalyst?.date || null,
      etf: t.etf && {
        ticker: t.etf.tk, execution: t.etf.plan?.execution,
        scaleFrom: fmt(t.etf.price), scaleTo: fmt(t.etf.plan?.wall),
        targetExecution: fmt(t.etf.plan?.entry), entryImprovementPct: fmt(t.etf.plan?.entryImprovementPct, 1),
        /* No price objective reaches the draft. Targets anchor the reader,
           and the structural target is not always coherent: when the put
           wall sits above the last sale on a bearish trade, "targeting 60
           at +0.3%" is a target in the wrong direction. The implied range
           conveys scale without nominating a level. */
        impliedRange: t.etf.tgt ? `${fmt(t.etf.tgt.dn, 0)} to ${fmt(t.etf.tgt.up, 0)}` : null,
        putWall: t.vol?.putWall, callWall: t.vol?.callWall,
        stop: fmt(t.etf.plan?.stop), riskPct: fmt(t.etf.share?.riskPct, 1),
        wallDistancePct: fmt(t.etf.plan?.distToWallPct, 1),
      },
      vol: t.vol && { iv30: t.vol.iv30, rv30: t.vol.rv30, rr25: t.vol.rr25, term: t.vol.termSlope,
                      putWall: t.vol.putWall, callWall: t.vol.callWall },
      options: t.options.map(o => ({
        structure: o.name, expiry: o.expiry, legs: o.legText,
        net: fmt(Math.abs(o.pricing.net) / 100), debitOrCredit: o.pricing.net > 0 ? "debit" : "credit",
        maxGain: o.pricing.uncapped ? "uncapped" : fmt(o.pricing.maxGain / 100),
        pop: o.econ.pop, why: o.why,
      })),
    })),
  };
}
