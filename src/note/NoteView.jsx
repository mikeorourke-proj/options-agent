import { useEffect, useRef, useState } from "react";
import RunLog from "../lib/runlog.js";
import "../styles/note.css";
import { APPROVED, MAST, FOOTER, LEGEND, APPENDIX } from "./disclosures.js";
import { NEAR_WALL_PCT } from "../lib/environment.js";

const f = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toFixed(d);

/* How far down the sheet the two columns may run. The sign-off is pinned at
   bottom 24mm and nothing pushes it, so anything past this is printed over.
   Keep in step with .analyst in note.css. It was 20mm until 0.37.0; the
   market-commentary legend now sits beneath the sign-off and took 4mm. */
const PAGE1_LIMIT_MM = 297 - 24 - 2;
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

export default function NoteView({ note, onProse, accepted = {}, onAccept }) {
  const { meta, themes, etfOrder, optOrder, risks, prose } = note;
  const T = Object.fromEntries(themes.map(t => [t.id, t]));
  const etfRows = etfOrder.map(r => T[r.themeId]).filter(Boolean);
  const optRows = optOrder.map(r => ({ t: T[r.themeId], o: T[r.themeId]?.options.find(x => x.id === r.structId) }))
                          .filter(x => x.t && x.o);

  /* EXHIBIT NUMBERS ARE ASSIGNED BY WHAT RENDERS, in page order.
     Three exhibits exist only when an option is carried and one only when a
     levered fund is listed. They used to sit at the end, so a shares-only
     note simply stopped at 4. In the current order they sit in the MIDDLE,
     and fixed numbers would print a shares-only note as Exhibits 1, 2, 5, 6. */
  const hasOpts = optRows.length > 0;
  const EX_ORDER = [
    ["map", true], ["etf", true], ["deriv", hasOpts], ["notes", hasOpts],
    ["screen", true], ["lev", etfRows.some(t => t.levered.length)],
  ];
  const exNo = key => {
    let n = 0;
    for (const [k, shown] of EX_ORDER) { if (shown) n++; if (k === key) return n; }
    return null;
  };
  const subjLine = meta.subjects.join("  ·  ");

  /* Page 1 is a fixed sheet: the analyst block, the disclaimer and the footer
     are absolutely positioned at fixed offsets from the bottom, so the two
     columns above them do not push anything down — they just grow over the
     top of it. Nothing on screen says so, and the overlap only becomes
     obvious in the PDF.
     After the fonts went up a step this stopped being theoretical, so the
     column height is measured against the space actually available and the
     analyst is told before printing rather than after. */
  const colsRef = useRef(null);
  const [overflow, setOverflow] = useState(null);
  /* The banner is on screen; the log is where this project is actually
     diagnosed. Without an entry, a session that overflowed and one that fit
     look identical afterwards — which is the same blindness that made the
     PDF invocation failure take three sessions to find.
     Logged on CHANGE only: a ResizeObserver fires on every keystroke, and
     the run log's signal-to-noise is worth more than the extra samples. */
  const lastFit = useRef(undefined);
  useEffect(() => {
    const el = colsRef.current;
    if (!el) return;
    const check = () => {
      const page = el.closest(".page");
      if (!page) return;
      const box = page.getBoundingClientRect();
      if (!box.height) return;
      const mmPerPx = 297 / box.height;
      const used = (el.getBoundingClientRect().bottom - box.top) * mmPerPx;
      const limit = PAGE1_LIMIT_MM;
      const over = used > limit ? +(used - limit).toFixed(1) : null;
      setOverflow(over);

      /* An empty note always fits, so measuring before the draft lands
         produces a "fits" at 214mm that means nothing — and the real reading
         arrives nineteen seconds later at 275.6mm. Say nothing until there
         is prose on the page. */
      const hasProse = Boolean(prose?.summary);

      const fits = over == null;
      if (hasProse && lastFit.current !== fits) {
        lastFit.current = fits;
        /* Millimetres are precise and useless to act on. A body line at
           8.9pt with 1.36 leading is about 4.3mm, so the overage in LINES is
           what tells the analyst how much to cut. */
        const meta = { usedMm: +used.toFixed(1), limitMm: limit, overMm: over,
                       overLines: over == null ? null : Math.max(1, Math.ceil(over / LINE_MM)),
                       themes: etfRows.length, bodyPt: 8.9 };
        if (fits) RunLog.info("ui", "page1.fits", meta);
        else RunLog.warn("ui", "page1.overflow", { ...meta,
               note: "the columns run past the analyst block, which is pinned to the sheet and will be printed over" });
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [prose, etfRows.length, optRows.length]);

  return (
    <div className="noteprint">
      {/* ═══ PAGE 1 ═══ */}
      {!APPROVED && (
        <div className="fitnote screen-only pending">
          Legend and disclosure wording are drafts pending Compliance and Registered Options
          Principal approval (src/note/disclosures.js). This banner does not print.
        </div>
      )}
      {/* Screen only — a warning about the page must never be on the page. */}
      {overflow != null && (
        <div className="overflowwarn">
          <b>Page 1 is over by about {Math.max(1, Math.ceil(overflow / LINE_MM))} line
          {Math.ceil(overflow / LINE_MM) > 1 ? "s" : ""} ({overflow}mm)</b>
. The two columns have
          grown past the analyst block, which is pinned to the bottom of the sheet and will be
          printed over. Cut roughly {Math.max(8, Math.ceil(overflow / LINE_MM) * 9)} words, or drop
          a theme, before saving the PDF.
        </div>
      )}

      <div className="page">
        <div className="mast">
          <Wordmark />
          <div className="kind"><div className="k1">{MAST.kind}</div><div className="k2">{MAST.audience}</div><div className="k3">{meta.date}</div></div>
        </div>
        <div className="band">
          <div className="t">{meta.title}</div>
          <div className="row"><b>{meta.direction.toUpperCase()}</b><span>{subjLine}</span>
            <span className="sec">{meta.sector}</span></div>
        </div>

        <div className="cols" ref={colsRef}>
          <div className="col-l">
            <div className="headline">{meta.subtitle}</div>
            <Para lead="Summary:" k="summary" text={prose.summary} onChange={onProse && (v => onProse("summary", v))}
                  accepted={accepted.summary} onAccept={onAccept} />
            {etfRows.map(t => (
              <Para key={t.id} lead={`${t.subject}.`} k={t.id} text={prose.themes[t.id] || ""}
                    onChange={onProse && (v => onProse(t.id, v))}
                    accepted={accepted[t.id]} onAccept={onAccept} />
            ))}
          </div>

          <div className="col-r rail">
            <div className="rh">ETF Expression</div>
            {/* LEVELS, NOT A PLAN (0.38.0). This table used to carry a scale-in
                average, a stop-loss and a risk figure — an entry, an exit and a
                size. It now carries where the market is and where the
                open-interest walls sit; what to do about it is the reader's. */}
            <table className="etfr"><thead><tr>
              <th></th><th>Last</th><th>Put wall</th><th>Call wall</th><th>1-mo range</th>
            </tr></thead><tbody>
              {etfRows.map(t => { const e = t.env || {}; return (
                <tr key={t.id}><td><Arrow d={t.direction} /> {t.etf.tk}</td>
                  <td>{f(t.etf.price)}</td>
                  <td className="g">{t.vol?.putWall ?? "—"}{e.putWallDistPct != null && <i className="d"> {pct(e.putWallDistPct)}</i>}</td>
                  <td className="r">{t.vol?.callWall ?? "—"}{e.callWallDistPct != null && <i className="d"> {pct(e.callWallDistPct)}</i>}</td>
                  <td>{e.rangePct != null ? `±${f(e.rangePct, 1)}%` : "—"}</td></tr>
              ); })}
            </tbody></table>
            <div className="rnote">Walls are the largest open-interest strikes below (puts) and above (calls)
              the last price, with the distance to each. Range is one standard deviation over one month.</div>

            {etfRows.some(t => t.leveredCarried?.length) && (<>
              <div className="rh">Levered ETF Expression</div>
              <table><thead><tr><th></th><th>Leverage</th><th>Underlying</th></tr></thead><tbody>
                {etfRows.flatMap(t => (t.leveredCarried || []).map(l => (
                  <tr key={l.tk}><td><Arrow d={t.direction} /> {l.tk}</td>
                    <td className="c">{l.lev > 0 ? "+" : ""}{l.lev}x</td>
                    <td className="c">{l.underlying}</td></tr>)))}
              </tbody></table>
              <div className="rnote">A levered fund moves at roughly the stated multiple of its underlying each
                day. Daily reset means the realised multiple drifts the longer it is held.</div>
            </>)}

            <div className="rh">Derivatives Expression</div>
            <table><thead><tr><th></th><th></th><th>{optRows.some(x => x.o.pricing.net < 0) ? "Net" : "Debit"}</th><th>Max loss</th><th>Max gain</th></tr></thead><tbody>
              {optRows.map(({ t, o }) => <tr key={t.id + o.id}><td>{t.etf.tk}</td>
                <td style={{ textAlign: "left", color: "var(--n-muted)" }}>{o.name} · {longExpiry(o.expiry)}</td>
                <td>${f(Math.abs(o.pricing.net) / 100)}{o.pricing.net < 0 ? " cr" : ""}</td>
                <td className="r">{maxLossText(o.pricing)}</td>
                <td className="g">{(o.pricing.gainUnbounded ?? o.pricing.uncapped) ? "uncapped" : "$" + f(o.pricing.maxGain / 100)}</td></tr>)}
              {/* "No tradable chain" and "none carried" are different statements
                  and only one of them is about the market. SMH priced a long
                  put at 0.635 and a put spread at 0.55 on 15 Sep; neither was
                  ticked, and the note would have told the client there was no
                  chain. `alternatives` holds what was priced and passed over. */}
              {/* The panel follows the ETF sequence rather than ranking
                independently: an option is the same idea expressed
                differently — the right tool when spot is not where you want
                to buy — so the note reads theme by theme. */}
            {optRows.length === 0 && <tr><td colSpan={5} className="note">
                {etfRows.some(t => t.alternatives?.length)
                  ? "shares only \u2014 no derivatives carried alongside"
                  : "no tradable chain on the selected vehicles"}</td></tr>}
            </tbody></table>

            <div className="rh">Volatility</div>
            <table><thead><tr><th></th><th>IV30</th><th>RV30</th><th>Avg day</th><th>25ΔRR</th><th>Term</th></tr></thead><tbody>
              {etfRows.map(t => { const e = t.env || {}; return <tr key={t.id}><td>{t.etf.tk}</td><td>{t.vol?.iv30 != null ? f(t.vol.iv30, 1) + "%" : "—"}</td>
                <td>{t.vol?.rv30 != null ? f(t.vol.rv30, 1) + "%" : "—"}</td>
                <td>{e.avgDailyMovePct != null ? f(e.avgDailyMovePct, 1) + "%" : "—"}</td>
                <td className={t.vol?.rr25 > 0 ? "r" : "g"}>{t.vol?.rr25 > 0 ? "+" : ""}{f(t.vol?.rr25)}</td>
                <td className={t.vol?.termSlope < 0.9 ? "am" : ""}>{f(t.vol?.termSlope)}</td></tr>; })}
            </tbody></table>
            {/* This number is not decoration — strategy.js switches structure
                on it at -3 and +1, so the footnote should say what it drives,
                not just which way the sign points. The closing clause reads
                the note's own legs so it describes this note rather than
                stating a general rule. */}
            {(() => {
              const rrs = etfRows.map(t => t.vol?.rr25).filter(v => v != null);
              const here = !rrs.length ? ""
                : rrs.every(v => v <= -3) ? " Every leg here is bid for downside."
                : rrs.every(v => v >= 1) ? " Every leg here is bid for upside."
                : rrs.some(v => v <= -3) && rrs.some(v => v >= 1) ? " The legs here are split."
                : "";
              return (
                <div className="note">IV30 is 30-day implied volatility and RV30 what the last 30 sessions
                  delivered; Avg day is the average daily close-to-close move over 20 sessions.
                  25ΔRR is the 25-delta call's implied volatility less the
                  25-delta put's, in volatility points; positive means calls are bid. Past −3 downside
                  strikes are comparatively rich; past +1 they are comparatively neglected.{here}</div>
              );
            })()}

            {/* Sizing, not ranking. Four legs on one thesis is one position
                at several times the intended risk, and nothing else on the
                page says so. Silent when there is nothing to warn about. */}
            {note.correlation?.sentence && (<>
              <div className="rh">Correlation</div>
              <div className="rnote">{note.correlation.sentence}</div>
            </>)}

            <div className="rh">Liquidity Screen</div>
            <table><tbody>
              {etfRows.map(t => <tr key={t.id}><td>{t.etf.tk}</td>
                <td style={{ textAlign: "left" }} className={t.etf.liq === "A" ? "g" : t.etf.liq === "X" ? "r" : "am"}>grade {t.etf.liq}</td>
                <td style={{ color: "var(--n-muted)" }}>{t.contracts?.toLocaleString() || "—"} contracts</td></tr>)}
            </tbody></table>

            {risks.length > 0 && <>
              <div className="rh">Risks to the View</div>
              {risks.slice(0, 4).map((r, i) => <div className="risk" key={i}><b>{r}</b></div>)}
            </>}
          </div>
        </div>

        <div className="analyst"><b>{meta.analyst.name}</b><br />{meta.analyst.title}<br />
          <span className="em">{meta.analyst.email}</span><br />{meta.analyst.phone}</div>
        {/* The page-1 disclosure block was removed at the analyst's request:
            his Closing Prints do not carry one, and it was taking 17mm off a
            sheet the prose had already overrun.

            What it contained was a POINTER — the conflict-of-interest line
            plus "see the Important Disclosures Appendix starting on PAGE 3".
            The appendix itself is untouched and still ships on page 3, so
            this removes the cover reference to the disclosures, not the
            disclosures. Whether the reference is required is a compliance
            question, not a formatting one.

            To restore: put this block back and return .analyst to bottom 34mm
            and PAGE1_LIMIT_MM to 261. */}
        {/* The market-commentary legend. The old disclosure block (removed
            above) was a pointer; this is the statement itself — what the
            communication is and is not — and it is what the research
            exclusion leans on. Wording lives in disclosures.js. */}
        <div className="legend">{LEGEND}</div>
        <Foot n={1} />
      </div>

      {/* ═══ PAGE 2 ═══ */}
      <div className="page">
        <div className="rhead">{MAST.kind} — {meta.title}<span>{MAST.audience} · {meta.date}</span></div>

        <div className="exhblk"><div className="exh first">Exhibit {exNo("map")}: Positioning Map — Last Price and Open-Interest Walls</div>
        <div className="pm">
          {etfRows.map(t => {
            const v = t.vol; if (!v?.putWall || !v?.callWall || !t.etf?.price) return null;
            const lo = v.putWall, hi = v.callWall, pad = (hi - lo) * 0.42, a = lo - pad, b = hi + pad;
            const Xmm = x => `calc(14mm + ${(x - a) / (b - a)} * (100% - 30mm))`;
            return <div className="row" key={t.id}>
              <span className="tk">{t.etf.tk}</span><div className="ax" />
              {/* Spot and the two walls, nothing else. The scale band, the five
                  rungs and the weighted average were drawn here until 0.38.0;
                  they were a picture of an order, and the note no longer
                  describes one. */}
              <div className="wall p" style={{ left: Xmm(lo) }} /><span className="lab p" style={{ left: Xmm(lo) }}>{lo}</span>
              <div className="wall c" style={{ left: Xmm(hi) }} /><span className="lab c" style={{ left: Xmm(hi) }}>{hi}</span>
              <div className="spot" style={{ left: Xmm(t.etf.price) }} />
              <span className="lab s" style={{ left: Xmm(t.etf.price) }}>{f(t.etf.price)}</span>
            </div>;
          })}
        </div>
        <div className="src">Put wall in green, call wall in red, last price ringed. A wall is the strike holding the most open interest on that side of the market — a level where dealer hedging has tended to concentrate, not a level price is expected to reach or hold.
          {etfRows.some(t => !t.vol?.putWall || !t.vol?.callWall) && <> {etfRows.filter(t => !t.vol?.putWall || !t.vol?.callWall).map(t => t.etf.tk).join(", ")} {etfRows.filter(t => !t.vol?.putWall || !t.vol?.callWall).length > 1 ? "are" : "is"} absent from this map: with no two-sided option chain there are no walls to plot.</>}</div>
        </div>

        <div className="exhblk"><div className="exh">Exhibit {exNo("etf")}: ETF Expression — Levels and Trading Range</div>
        <table className="x"><thead><tr><th>Theme</th><th className="c">ETF</th><th className="c">Last</th><th className="c">Put wall</th><th className="c">Call wall</th><th className="c">One-month range</th><th className="c">3-month closes</th><th className="c">In range</th><th className="c">50-day avg</th><th className="c">Implied / realised</th></tr></thead><tbody>
          {etfRows.map(t => { const e = t.env || {}, w = t.wall || {}; const dag = e.rangeBasis === "realised" ? " \u2020" : ""; return <tr key={t.id}>
            <td>{cap(t.direction)} {t.subject}</td><td className="c">{t.etf.tk}</td><td className="c">{f(t.etf.price)}</td>
            <td className="c">{t.vol?.putWall != null ? `${t.vol.putWall} (${pct(e.putWallDistPct)})` : "—"}</td>
            <td className="c">{t.vol?.callWall != null ? `${t.vol.callWall} (${pct(e.callWallDistPct)})` : "—"}</td>
            <td className="c">{e.rangeLo != null ? `${f(e.rangeLo, 0)} – ${f(e.rangeHi, 0)}${dag}` : "—"}</td>
            <td className="c">{e.closeLo != null ? `${f(e.closeLo)} – ${f(e.closeHi)}` : "—"}</td>
            <td className="c">{e.rangePosition != null ? `${e.rangePosition}%` : "—"}</td>
            <td className="c">{e.ma50 != null ? `${f(e.ma50)} (${pct(e.vsMa50Pct)})` : "—"}</td>
            <td className="c">{e.ivOverRv != null ? `${f(e.iv30, 1)} / ${f(e.rv30, 1)}` : "—"}</td></tr>; })}
        </tbody></table>
        <div className="src">Walls show the distance from the last price. The one-month range is one standard deviation derived from current option prices — the option market's own measure of a normal month, not a forecast and not a price objective.
          3-month closes is the range of daily closing prices over the last three months and In range is where the last price sits within it (0% the low, 100% the high). 50-day avg shows the last price relative to it. Implied / realised compares 30-day implied volatility with what the last 30 sessions delivered.
          {etfRows.some(t => t.env?.rangeBasis === "realised") && <><br />
            <b>†</b> No tradeable option chain on this vehicle, so it carries no open-interest walls and its range is
            measured from realised volatility over {etfRows.find(t => t.env?.rangeBasis === "realised")?.env?.rangeWindow ?? 30} sessions
            rather than from option prices.
          </>}<br />
          These are descriptions of the market as of the date shown. Entry, sizing, exit and timing are the reader's decisions.</div>

        </div>
        {/* Exhibits 6 and 7 were already suppressed when nothing is carried;
            5 was not, so a shares-only note printed one lone table of column
            headers over an empty body. */}
        {optRows.length > 0 && (
        <div className="exhblk"><div className="exh">Exhibit {exNo("deriv")}: Derivatives Expression — Illustrative Structures</div>
        <table className="x"><thead><tr><th>Theme</th><th className="c">ETF</th><th>Structure</th><th className="c">Expiry</th><th className="c">Legs</th><th className="c">Net</th><th className="c">Max loss</th><th className="c">Max gain</th><th className="c">Breakeven</th></tr></thead><tbody>
          {optRows.map(({ t, o }) => <tr key={t.id + o.id}><td>{cap(t.direction)} {t.subject}</td><td className="c">{t.etf.tk}</td>
            <td>{o.name}</td><td className="c">{longExpiry(o.expiry)}</td><td className="c">{o.legText}</td>
            <td className="c">${f(Math.abs(o.pricing.net) / 100)} {o.pricing.net > 0 ? "dr" : "cr"}</td>
            <td className="c">{maxLossText(o.pricing)}</td>
            <td className="c">{(o.pricing.gainUnbounded ?? o.pricing.uncapped) ? "uncapped" : "$" + f(o.pricing.maxGain / 100)}</td>
            <td className="c">{o.pricing.breakevens.join(" / ") || "—"}</td></tr>)}
        </tbody></table>
        <div className="src">Marks from {[...new Set(optRows.map(x => x.o.pricing.priceSource))].join(" / ") || "the chain"}, per share at expiration, before costs; one contract is 100 shares. Breakeven is where the structure neither gains nor loses at expiry. Structures are illustrations of how the view could be expressed with defined risk, priced at indicative marks.</div>
        </div>)}

        {optRows.length > 0 && <>
          <div className="exhblk"><div className="exh">Exhibit {exNo("notes")}: Structure Notes</div>
          <table className="x"><thead><tr><th>Theme</th><th>Structure</th><th>Note</th></tr></thead><tbody>
            {optRows.flatMap(({ t, o }) => [
              <tr key={t.id + o.id}><td>{cap(t.direction)} {t.subject}</td><td>{o.name}</td><td>{o.why}</td></tr>,
              ...t.alternatives.slice(0, 1).map(a => <tr key={t.id + a.id}><td></td><td>{a.name}</td><td>Alternative: {a.why}</td></tr>),
            ])}
          </tbody></table>
          <div className="src">The first structure under each theme is the one carried; the second is the nearest alternative.</div>

          </div>
        </>}

        <div className="exhblk"><div className="exh">Exhibit {exNo("screen")}: Vehicle Screening</div>
        <table className="x"><thead><tr><th>Theme</th><th>Selected</th><th>Alternatives considered</th><th>Why not selected</th></tr></thead><tbody>
          {etfRows.map(t => <tr key={t.id}><td>{cap(t.direction)} {t.subject}</td><td className="c">{t.etf.tk}</td>
            <td>{t.screening.considered.join(" · ") || "—"}</td><td>{t.screening.whyNot || "no second vehicle with a usable chain"}</td></tr>)}
        </tbody></table>
        <div className="src">Vehicles selected on directness of exposure, options liquidity, dollar volume, and structural decay.</div>
        </div>

        {etfRows.some(t => t.levered.length) && (
          <div className="exhblk"><div className="exh">Exhibit {exNo("lev")}: Levered and Inverse Alternatives — Not Carried</div>
          <table className="x"><thead><tr><th>Underlying</th><th>Fund</th><th>Leverage</th><th>Gamma X(X−1)</th><th>Suitability beyond a few days</th></tr></thead><tbody>
            {etfRows.flatMap(t => t.levered.map(l => <tr key={l.tk}><td>{t.etf.tk}</td><td>{l.tk}</td>
              <td className="c">{l.lev > 0 ? "+" : ""}{l.lev}x</td><td className="c">{l.gamma}</td>
              <td>days only — daily reset decay compounds the longer the fund is held</td></tr>))}
          </tbody></table>
          <div className="src">Gamma is the rebalance multiplier: mechanical flow per 1% move per $1bn of fund assets.
            {etfRows.some(t => t.leveredCarried?.length)
              ? " The funds listed above are the ones passed over; anything carried appears under Levered ETF Expression on page 1."
              : " None is carried here."}</div>
          </div>
        )}

        <Foot n={2} />
      </div>

      {/* ═══ PAGE 3 ═══ */}
      <div className="page appx">
        <div className="rhead">{MAST.kind} — Important Disclosures<span>{MAST.audience} · {meta.date}</span></div>
        <div className="key"><b className="h">Key — Options Liquidity Grade</b>
          <div><b className="A">A</b>deep chain, tight markets, weekly and monthly listings — any structure supported</div>
          <div><b className="B">B</b>usable chain with wider markets — verticals and outrights</div>
          <div><b className="C">C</b>thin chain — outrights only, reduce size</div>
          <div><b className="X">X</b>no usable chain: contracts listed but unpriced or without open interest — shares only</div>
        </div>
        <div className="key"><b className="h">Key — Levels and Ranges</b>
          <div><b>Put wall</b>the strike below the last price holding the most put open interest</div>
          <div><b>Call wall</b>the strike above the last price holding the most call open interest</div>
          <div><b>Nearby</b>a wall within {NEAR_WALL_PCT}% of the last price; beyond that the note describes it by its distance</div>
          <div><b>1-mo range</b>one standard deviation over one month, from option prices where a chain exists, otherwise from realised volatility</div>
        </div>
        <h1>IMPORTANT DISCLOSURES APPENDIX</h1>
        {APPENDIX({ author: meta.analyst?.name, title: meta.analyst?.title }).map(x => (
          <div key={x.h}><h2>{x.h}</h2><p>{x.p}</p></div>
        ))}
        <div className="signoff"><Wordmark /></div>
        <div className="copy">Copyright 2026 JonesTrading Institutional Services LLC. All rights reserved.</div>
        <Foot n={3} />
      </div>
    </div>
  );
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
