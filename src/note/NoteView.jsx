import { useEffect, useRef, useState } from "react";
import RunLog from "../lib/runlog.js";
import "../styles/note.css";
import { APPROVED, MAST, FOOTER, LEGEND, APPENDIX } from "./disclosures.js";
import { NEAR_WALL_PCT, MIN_WALL_OI } from "../lib/environment.js";

const f = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toFixed(d);

/* How far down page 1 the content may run before it meets the legend,
   which is pinned above the footer rule (bottom 14.2mm, three lines). Since
   0.39.0 nothing else is pinned: the sign-off is in the flow. */
const PAGE1_LIMIT_MM = 273;
/* One body line: 8.9pt at 1.36 leading. Used to turn an overage in
   millimetres into something an analyst can act on. */
const LINE_MM = 8.9 * 1.36 * 25.4 / 72;
const pct = (n, d = 1) => n == null ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}%`;
const Arrow = ({ d }) => <span className={d === "bearish" ? "dn" : "up"}>{d === "bearish" ? "▼" : "▲"}</span>;

function Wordmark() {
  return <span className="wm"><span className="a">Jones</span><span className="b">Trad</span>
    <span className="dot-i"><span className="b">{"ı"}</span><i className="mark" /></span><span className="b">ng</span></span>;
}
function Foot({ n }) { return <div className="foot"><b>JonesTrading</b><i>{FOOTER}</i><span>Page {n}</span></div>; }
/* Max loss beside max gain — Rule 2220 balance. A naked short leg has no
   finite worst case, and printing the scan's edge value would understate it. */
function maxLossText(pr) {
  if (pr.lossUnbounded) return "unlimited";
  const v = pr.maxLossFull ?? pr.maxLoss;
  return v == null || !isFinite(v) ? "\u2014" : "$" + f(Math.abs(Math.min(0, v)) / 100);
}

/* Editable paragraph. onChange fires on blur so typing is not re-rendered
   on every keystroke. */
/* Lead-in fixed, body editable, accept button per section. Unaccepted
   sections carry a draft rule on screen and print clean either way. */
function Para({ lead, text, onChange, k, accepted, onAccept }) {
  const editable = Boolean(onChange);
  return (
    <p className={`para${editable && !accepted ? " unaccepted" : ""}`} data-k={k}>
      {lead && <span className="lead" contentEditable={false}>{lead} </span>}
      {/* Native spellcheck: squiggles plus the browser's own right-click
          replacements, which beats shipping a dictionary. No lang is forced —
          pinning en-US would put a squiggle under "realised" and offer to
          "correct" it, against the house rule. */}
      <span className="body" contentEditable={editable} spellCheck={editable} suppressContentEditableWarning
            onInput={() => accepted && onAccept?.(k, false)}
            onBlur={e => onChange?.(e.currentTarget.innerText)}>{text}</span>
      {editable && onAccept && text && (
        <button className={`acc${accepted ? " on" : ""}`} contentEditable={false}
                onClick={() => onAccept(k, !accepted)}
                title={accepted ? "Accepted — click to reopen" : "Accept this section"}>
          {accepted ? "\u2713 accepted" : "accept"}
        </button>
      )}
    </p>
  );
}


/* "2026-10-30" -> "October 30th". The note's prose already writes expiries in
   words, so the two derivatives tables printing "10-30" beside it read as a
   different date format for the same thing. Parsed from the string, never
   through Date, so no timezone can shift the day. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
function longExpiry(iso) {
  const [, m, d] = String(iso || "").split("-").map(Number);
  if (!m || !d) return iso || "";
  const sfx = d % 100 >= 11 && d % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th");
  return `${MONTHS[m - 1]} ${d}${sfx}`;
}

export default function NoteView({ note, layout = "auto", onProse, accepted = {}, onAccept }) {
  const { meta, themes, etfOrder, optOrder, risks, prose } = note;
  const T = Object.fromEntries(themes.map(t => [t.id, t]));
  const themeRows = etfOrder.map(r => T[r.themeId]).filter(Boolean);
  /* One row per FUND, not per theme (0.39.0): a theme may carry several
     ETFs, and each is printed with its own levels. A theme built before
     legs existed is read as a single leg so old notes still render. */
  const legRows = themeRows.flatMap(t => (t.legs?.length ? t.legs
      : [{ tk: t.etf?.tk, price: t.etf?.price, vol: t.vol, wall: t.wall, env: t.env, liq: t.etf?.liq }])
    .filter(l => l.tk).map((l, i, arr) => ({ ...l, t, first: i === 0, n: arr.length })));
  const optRows = optOrder.map(r => ({ t: T[r.themeId], o: T[r.themeId]?.options.find(x => x.id === r.structId) }))
                          .filter(x => x.t && x.o);
  const mapRows = legRows.filter(l => l.vol?.putWall && l.vol?.callWall && l.price);
  const unplotted = legRows.filter(l => !(l.vol?.putWall && l.vol?.callWall)).map(l => l.tk);
  const levRows = themeRows.flatMap(t => [
    ...(t.leveredCarried || []).map(l => ({ ...l, t, carried: true })),
    ...(t.levered || []).map(l => ({ ...l, t, carried: false, underlying: t.etf?.tk })),
  ]);

  /* EXHIBIT NUMBERS ARE ASSIGNED BY WHAT RENDERS, in page order. Vehicle
     Screening, Structure Notes and Option Leg Detail are gone; what is left
     is the map, the levels table, the structures and the levered funds. */
  const hasOpts = optRows.length > 0;
  const EX_ORDER = [["map", mapRows.length > 0], ["etf", true], ["deriv", hasOpts], ["lev", levRows.length > 0]];
  const exNo = key => {
    let n = 0;
    for (const [k, shown] of EX_ORDER) { if (shown) n++; if (k === key) return n; }
    return null;
  };
  const subjLine = meta.subjects.join("  ·  ");

  /* ONE PAGE WHEN IT FITS, TWO WHEN IT DOES NOT (0.39.0).
     The whole note is laid out on page 1 — prose in two columns, exhibits
     full width beneath — and the sheet is measured. If it runs past the
     legend, the exhibits move to a second page and page 1 keeps the prose.
     "auto" does that by measurement; "one" and "two" are the analyst
     overruling it.
     Falling back is sticky for a given note: re-trying one page the moment
     two pages fits would oscillate on every keystroke. It is tried again
     only when the CONTENT changes — a new draft, a fund added or removed. */
  const flowRef = useRef(null);
  const [overflow, setOverflow] = useState(null);
  const contentKey = `${prose?.summary?.length || 0}:${Object.values(prose?.themes || {}).join("").length}:${legRows.length}:${optRows.length}:${levRows.length}`;
  const [spill, setSpill] = useState({ key: null });
  const autoTwo = spill.key === contentKey;
  const mode = layout === "two" ? "two" : layout === "one" ? "one" : (autoTwo ? "two" : "one");

  const lastFit = useRef(undefined);
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const check = () => {
      const page = el.closest(".page");
      if (!page) return;
      const box = page.getBoundingClientRect();
      if (!box.width) return;
      const mmPerPx = 210 / box.width;
      const used = (el.getBoundingClientRect().bottom - box.top) * mmPerPx;
      const over = used > PAGE1_LIMIT_MM ? +(used - PAGE1_LIMIT_MM).toFixed(1) : null;
      const hasProse = Boolean(prose?.summary);

      if (over != null && layout === "auto" && mode === "one") {
        RunLog.info("ui", "page1.layout", { from: "one", to: "two", usedMm: +used.toFixed(1), limitMm: PAGE1_LIMIT_MM,
          overMm: over, funds: legRows.length, structures: optRows.length,
          why: "the exhibits do not fit beneath the prose on one sheet" });
        setSpill({ key: contentKey });
        return;                       // re-measures on the next paint
      }
      setOverflow(over);
      const state = `${mode}:${over == null}`;
      if (hasProse && lastFit.current !== state) {
        lastFit.current = state;
        const m = { mode, layout, usedMm: +used.toFixed(1), limitMm: PAGE1_LIMIT_MM, overMm: over,
                    overLines: over == null ? null : Math.max(1, Math.ceil(over / LINE_MM)),
                    themes: themeRows.length, funds: legRows.length };
        if (over == null) RunLog.info("ui", "page1.fits", m);
        else RunLog.warn("ui", "page1.overflow", { ...m,
               note: mode === "one" ? "one page was forced and the content runs past the legend"
                                    : "the prose alone runs past the legend" });
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [prose, contentKey, layout, mode]);

  /* ── pieces, placed differently by the two layouts ─────────────── */
  const Prose = (
    <div className="prose2">
      <Para lead="Summary:" k="summary" text={prose.summary} onChange={onProse && (v => onProse("summary", v))}
            accepted={accepted.summary} onAccept={onAccept} />
      {themeRows.map(t => (
        <Para key={t.id} lead={`${t.subject}.`} k={t.id} text={prose.themes[t.id] || ""}
              onChange={onProse && (v => onProse(t.id, v))}
              accepted={accepted[t.id]} onAccept={onAccept} />
      ))}
    </div>
  );

  const Map = mapRows.length > 0 && (
    <div className="exhblk">
      <div className="exh first">Exhibit {exNo("map")}: Positioning Map — Last Price and Open-Interest Walls</div>
      <div className="pm">
        {mapRows.map(l => {
          const lo = l.vol.putWall, hi = l.vol.callWall, pad = (hi - lo) * 0.42, a = lo - pad, b = hi + pad;
          const fr = x => (x - a) / (b - a);
          const X = x => `calc(11mm + ${fr(x)} * (100% - 14mm))`;
          /* When the last price sits almost on a wall the two labels land on
             top of each other (RSP at 210.43 against a 210 put wall), so the
             price label drops beneath the axis instead. */
          const crowded = Math.min(Math.abs(fr(l.price) - fr(lo)), Math.abs(fr(l.price) - fr(hi))) < 0.1;
          return <div className={`row${crowded ? " crowded" : ""}`} key={l.tk}>
            <span className="tk">{l.tk}</span><div className="ax" />
            <div className="wall p" style={{ left: X(lo) }} /><span className="lab p" style={{ left: X(lo) }}>{lo}</span>
            <div className="wall c" style={{ left: X(hi) }} /><span className="lab c" style={{ left: X(hi) }}>{hi}</span>
            <div className="spot" style={{ left: X(l.price) }} />
            <span className={`lab s${crowded ? " lo" : ""}`} style={{ left: X(l.price) }}>{f(l.price)}</span>
          </div>;
        })}
      </div>
      <div className="src">Put wall green, call wall red, last price ringed. A wall is the strike holding the most open interest on that side, not a level price is expected to reach or hold.
        {unplotted.length > 0 && <> {unplotted.join(", ")} {unplotted.length > 1 ? "have" : "has"} no two-sided walls to plot.</>}</div>
    </div>
  );

  const Side = (
    <div className="rail">
      {risks.length > 0 && <>
        <div className="rh" style={{ marginTop: 0 }}>Risks to the View</div>
        {risks.slice(0, 4).map((r, i) => <div className="risk" key={i}><b>{r}</b></div>)}
      </>}
      {/* Sizing context, not ranking: several funds on one thesis are one
          position. Silent when there is nothing to say. */}
      {note.correlation?.sentence && <div className="rnote"><b>Correlation.</b> {note.correlation.sentence}</div>}
      <div className="sig"><b>{meta.analyst.name}</b> · {meta.analyst.title}<br />
        <span className="em">{meta.analyst.email}</span> · {meta.analyst.phone}</div>
    </div>
  );

  const anyRealised = legRows.some(l => l.env?.rangeBasis === "realised");
  const Levels = (
    <div className="exhblk">
      <div className="exh">Exhibit {exNo("etf")}: ETF Expression — Levels, Trading Range and Volatility</div>
      {/* LEVELS, NOT A PLAN. Where the market is and where the walls sit;
          what to do about it is the reader's. One row per fund carried. */}
      <table className="x lv"><thead><tr><th>Theme</th><th className="c">ETF</th><th className="c">Last</th><th className="c">Put wall</th><th className="c">Call wall</th><th className="c">One-month range</th><th className="c">3-month closes</th><th className="c">In range</th><th className="c">vs 50-day</th><th className="c">IV30 / RV30</th><th className="c">Avg day</th><th className="c">25ΔRR</th><th className="c">Options</th></tr></thead><tbody>
        {legRows.map(l => { const e = l.env || {}, v = l.vol || {}; return <tr key={l.t.id + l.tk}>
          <td>{l.first ? <><Arrow d={l.t.direction} /> {l.t.subject}</> : ""}</td><td className="c"><b>{l.tk}</b></td><td className="c">{f(l.price)}</td>
          <td className="c">{v.putWall != null ? `${v.putWall} (${pct(e.putWallDistPct)})` : v.thinPut ? "thin" : "—"}</td>
          <td className="c">{v.callWall != null ? `${v.callWall} (${pct(e.callWallDistPct)})` : v.thinCall ? "thin" : "—"}</td>
          <td className="c">{e.rangeLo != null ? `${f(e.rangeLo, 0)} – ${f(e.rangeHi, 0)}${e.rangeBasis === "realised" ? " \u2020" : ""}` : "—"}</td>
          <td className="c">{e.closeLo != null ? `${f(e.closeLo)} – ${f(e.closeHi)}` : "—"}</td>
          <td className="c">{e.rangePosition != null ? `${e.rangePosition}%` : "—"}</td>
          <td className="c">{e.vsMa50Pct != null ? pct(e.vsMa50Pct) : "—"}</td>
          <td className="c">{e.iv30 != null || e.rv30 != null ? `${e.iv30 != null ? f(e.iv30, 1) : "—"} / ${e.rv30 != null ? f(e.rv30, 1) : "—"}` : "—"}</td>
          <td className="c">{e.avgDailyMovePct != null ? f(e.avgDailyMovePct, 1) + "%" : "—"}</td>
          <td className="c">{v.rr25 != null ? (v.rr25 > 0 ? "+" : "") + f(v.rr25) : "—"}</td>
          <td className="c">{l.liq ? `grade ${l.liq}` : "—"}</td></tr>; })}
      </tbody></table>
      <div className="src">Walls show distance from the last price. One-month range is one standard deviation from option prices, not a forecast or price objective{anyRealised ? " (\u2020 from realised volatility; no option chain)" : ""}. In range: position in the 3-month closing range. Avg day: average close-to-close move, 20 sessions. Entry, sizing, exit and timing are the reader's decisions.</div>
    </div>
  );

  const Derivs = hasOpts && (
    <div className="exhblk">
      <div className="exh">Exhibit {exNo("deriv")}: Derivatives Expression — Illustrative Structures</div>
      <table className="x"><thead><tr><th>Theme</th><th className="c">ETF</th><th>Structure</th><th className="c">Expiry</th><th className="c">Legs</th><th className="c">Net</th><th className="c">Max loss</th><th className="c">Max gain</th><th className="c">Breakeven</th><th>Note</th></tr></thead><tbody>
        {optRows.map(({ t, o }) => <tr key={t.id + o.id}><td><Arrow d={t.direction} /> {t.subject}</td><td className="c">{t.etf.tk}</td>
          <td className="nw">{o.name}</td><td className="c nw">{longExpiry(o.expiry)}</td><td className="c nw">{o.legText}</td>
          <td className="c nw">${f(Math.abs(o.pricing.net) / 100)} {o.pricing.net > 0 ? "dr" : "cr"}</td>
          <td className="c">{maxLossText(o.pricing)}</td>
          <td className="c">{(o.pricing.gainUnbounded ?? o.pricing.uncapped) ? "uncapped" : "$" + f(o.pricing.maxGain / 100)}</td>
          <td className="c">{o.pricing.breakevens.join(" / ") || "—"}</td><td>{o.why}</td></tr>)}
      </tbody></table>
      <div className="src">Per share at expiration at indicative marks ({[...new Set(optRows.map(x => x.o.pricing.priceSource))].join(" / ") || "the chain"}), before costs; one contract is 100 shares. Illustrations of how the view could be expressed with defined risk.</div>
    </div>
  );

  const Lev = levRows.length > 0 && (
    <div className="exhblk">
      <div className="exh">Exhibit {exNo("lev")}: Levered and Inverse Funds</div>
      <table className="x"><thead><tr><th>Underlying</th><th>Fund</th><th className="c">Leverage</th><th className="c">Gamma X(X−1)</th><th>Note</th></tr></thead><tbody>
        {levRows.map(l => <tr key={l.t.id + l.tk}><td>{l.underlying}</td><td>{l.tk}</td>
          <td className="c">{l.lev > 0 ? "+" : ""}{l.lev}x</td><td className="c">{l.gamma ?? "—"}</td>
          <td>{l.carried ? "an expression of the view for short periods — daily reset means the realised multiple drifts the longer it is held"
                         : "listed for reference — daily reset decay compounds the longer the fund is held"}</td></tr>)}
      </tbody></table>
      <div className="src">Gamma is the rebalance multiplier: mechanical flow per 1% move per $1bn of fund assets.</div>
    </div>
  );

  const Head = (
    <>
      <div className="mast">
        <Wordmark />
        <div className="kind"><div className="k1">{MAST.kind}</div><div className="k2">{MAST.audience}</div><div className="k3">{meta.date}</div></div>
      </div>
      <div className="band">
        <div className="t">{meta.title}</div>
        <div className="row"><b>{meta.direction.toUpperCase()}</b><span>{subjLine}</span>
          <span className="sec">{meta.sector}</span></div>
      </div>
      <div className="headline">{meta.subtitle}</div>
    </>
  );
  const lastPage = mode === "one" ? 2 : 3;

  return (
    <div className="noteprint">
      {!APPROVED && (
        <div className="fitnote screen-only pending">
          Legend and disclosure wording are drafts pending Compliance and Registered Options
          Principal approval (src/note/disclosures.js). This banner does not print.
        </div>
      )}
      {/* Screen only — a note about the page must never be on the page. */}
      {layout === "auto" && mode === "two" && overflow == null && (
        <div className="fitnote screen-only">
          Too much for one page, so the exhibits are on page 2. Fewer funds, fewer structures or
          shorter paragraphs bring it back to one.
        </div>
      )}
      {overflow != null && (
        <div className="overflowwarn">
          <b>Page 1 is over by about {Math.max(1, Math.ceil(overflow / LINE_MM))} line
          {Math.ceil(overflow / LINE_MM) > 1 ? "s" : ""} ({overflow}mm)</b>.
          {mode === "one" ? " One page is forced and the content runs past the legend — switch Layout to Auto or Two pages, or cut the prose."
                          : ` The prose alone runs past the legend. Cut roughly ${Math.max(8, Math.ceil(overflow / LINE_MM) * 18)} words, or drop a theme, before saving the PDF.`}
        </div>
      )}

      {/* ═══ PAGE 1 ═══ */}
      <div className={`page np ${mode === "one" ? "compact" : ""}`}>
        <div ref={flowRef}>
          {Head}
          {Prose}
          {mode === "one" ? (
            <>
              <div className="split">{Map ? <div className="half">{Map}</div> : null}<div className="half">{Side}</div></div>
              {Levels}{Derivs}{Lev}
            </>
          ) : (
            <div className="split solo"><div className="half">{Side}</div></div>
          )}
        </div>
        {/* The market-commentary legend: what the communication is and is
            not. Wording lives in disclosures.js. */}
        <div className="legend">{LEGEND.replace("page 3", `page ${lastPage}`)}</div>
        <Foot n={1} />
      </div>

      {/* ═══ PAGE 2 — exhibits, only when they did not fit on page 1 ═══ */}
      {mode === "two" && (
        <div className="page np">
          <div className="rhead">{MAST.kind} — {meta.title}<span>{MAST.audience} · {meta.date}</span></div>
          {Map}{Levels}{Derivs}{Lev}
          <Foot n={2} />
        </div>
      )}

      {/* ═══ DISCLOSURES ═══ */}
      <div className="page appx">
        <div className="rhead">{MAST.kind} — Important Disclosures<span>{MAST.audience} · {meta.date}</span></div>
        <div className="key"><b className="h">Key — Options Liquidity Grade</b>
          <div><b className="A">A</b>deep chain, tight markets, weekly and monthly listings — any structure supported</div>
          <div><b className="B">B</b>usable chain with wider markets — verticals and outrights</div>
          <div><b className="C">C</b>thin chain — outrights only, reduce size</div>
          <div><b className="X">X</b>no usable chain: contracts listed but unpriced or without open interest — shares only</div>
        </div>
        {/* EVERY COLUMN HEADER OF THE ETF TABLE IS DEFINED HERE, in the order
            the columns appear, so nothing on page 1 is left for the reader to
            guess. A column added to the table needs a line here; the render
            test compares the two lists. */}
        <div className="key wide"><b className="h">Key — ETF Expression Table</b>
          <div><b>Last</b>the last traded price when the note was prepared</div>
          <div><b>Put wall</b>the strike below the last price holding the most put open interest, with its distance from the last price</div>
          <div><b>Call wall</b>the strike above the last price holding the most call open interest, with its distance from the last price</div>
          <div><b>One-month range</b>one standard deviation over one month, from option prices where a chain exists, otherwise (†) from realised volatility; not a forecast</div>
          <div><b>3-month closes</b>the lowest and highest daily closing price over the last three months</div>
          <div><b>In range</b>where the last price sits within the 3-month closing range: 0% is the low, 100% the high</div>
          <div><b>vs 50-day</b>the last price relative to its 50-day average closing price</div>
          <div><b>IV30 / RV30</b>30-day implied volatility against the volatility realised over the last 30 sessions, annualised</div>
          <div><b>Avg day</b>the average daily close-to-close move over the last 20 sessions</div>
          <div><b>25ΔRR</b>the 25-delta call's implied volatility less the 25-delta put's, in volatility points; positive means calls are bid</div>
          <div><b>Options</b>the options liquidity grade, A to X, defined above</div>
        </div>
        <div className="key wide"><b className="h">Key — Walls in the Text</b>
          <div><b>Nearby</b>a wall within {NEAR_WALL_PCT}% of the last price; beyond that the note describes it by its distance</div>
          <div><b>Thin</b>a wall holding fewer than {MIN_WALL_OI.toLocaleString("en-US")} contracts is treated as no wall</div>
        </div>
        <h1>IMPORTANT DISCLOSURES APPENDIX</h1>
        {APPENDIX({ author: meta.analyst?.name, title: meta.analyst?.title }).map(x => (
          <div key={x.h}><h2>{x.h}</h2><p>{x.p}</p></div>
        ))}
        <div className="signoff"><Wordmark /></div>
        <div className="copy">Copyright 2026 JonesTrading Institutional Services LLC. All rights reserved.</div>
        <Foot n={lastPage} />
      </div>
    </div>
  );
}
