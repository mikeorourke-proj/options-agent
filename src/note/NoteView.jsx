import "../styles/note.css";

const f = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toFixed(d);
const pct = (n, d = 1) => n == null ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}%`;
const Arrow = ({ d }) => <span className={d === "bearish" ? "dn" : "up"}>{d === "bearish" ? "▼" : "▲"}</span>;

function Wordmark() {
  return <span className="wm"><span className="a">Jones</span><span className="b">Trad</span>
    <span className="dot-i"><span className="b">{"ı"}</span><i className="mark" /></span><span className="b">ng</span></span>;
}
function Foot({ n }) { return <div className="foot"><b>JonesTrading</b><span>Page {n}</span></div>; }

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

export default function NoteView({ note, onProse, accepted = {}, onAccept }) {
  const { meta, themes, etfOrder, optOrder, risks, prose } = note;
  const T = Object.fromEntries(themes.map(t => [t.id, t]));
  const etfRows = etfOrder.map(r => T[r.themeId]).filter(Boolean);
  const optRows = optOrder.map(r => ({ t: T[r.themeId], o: T[r.themeId]?.options.find(x => x.id === r.structId) }))
                          .filter(x => x.t && x.o);
  const subjLine = meta.subjects.join("  ·  ");

  return (
    <div className="noteprint">
      {/* ═══ PAGE 1 ═══ */}
      <div className="page">
        <div className="mast">
          <Wordmark />
          <div className="kind"><div className="k1">Institutional Tactical Note</div><div className="k2">Desk Commentary</div><div className="k3">{meta.date}</div></div>
        </div>
        <div className="band">
          <div className="t">{meta.title}</div>
          <div className="row"><b>{meta.direction.toUpperCase()}</b><span>{subjLine}</span>
            <span>Execute {meta.executeWindow}&nbsp;&nbsp;·&nbsp;&nbsp;Hold {meta.holdWindow}</span>
            <span className="sec">{meta.sector}</span></div>
        </div>

        <div className="cols">
          <div className="col-l">
            <div className="headline">{meta.subtitle}</div>
            <Para lead="Summary:" k="summary" text={prose.summary} onChange={onProse && (v => onProse("summary", v))}
                  accepted={accepted.summary} onAccept={onAccept} />
            {etfRows.map(t => (
              <Para key={t.id} lead={`${t.subject}.`} k={t.id} text={prose.themes[t.id] || ""}
                    onChange={onProse && (v => onProse(t.id, v))}
                    accepted={accepted[t.id]} onAccept={onAccept} />
            ))}
            <Para lead="Execution strategy." k="execution" text={prose.execution} onChange={onProse && (v => onProse("execution", v))}
                  accepted={accepted.execution} onAccept={onAccept} />
          </div>

          <div className="col-r rail">
            <div className="rh">ETF Expression</div>
            <table className="etfr"><thead><tr>
              <th></th><th>Target Entry</th><th>Stop-loss</th><th>Risk</th><th>Put wall</th><th>Call wall</th>
            </tr></thead><tbody>
              {etfRows.map(t => (
                <tr key={t.id}><td><Arrow d={t.direction} /> {t.etf.tk}</td>
                  <td>{t.etf.plan?.single ? "current" : f(t.etf.plan?.entry)}</td><td className="r">{f(t.etf.plan?.stop)}</td>
                  <td>{f(t.etf.share?.riskPct, 1)}%</td>
                  <td className="g">{t.vol?.putWall ?? "—"}</td><td className="r">{t.vol?.callWall ?? "—"}</td></tr>
              ))}
            </tbody></table>

            <div className="rh">Derivatives Expression</div>
            <table><thead><tr><th></th><th></th><th>{optRows.some(x => x.o.pricing.net < 0) ? "Net" : "Debit"}</th><th>Max gain</th></tr></thead><tbody>
              {optRows.map(({ t, o }) => <tr key={t.id + o.id}><td>{t.etf.tk}</td>
                <td style={{ textAlign: "left", color: "var(--n-muted)" }}>{o.name} · {o.expiry.slice(5)}</td>
                <td>${f(Math.abs(o.pricing.net) / 100)}{o.pricing.net < 0 ? " cr" : ""}</td>
                <td className="g">{o.pricing.uncapped ? "uncapped" : "$" + f(o.pricing.maxGain / 100)}</td></tr>)}
              {optRows.length === 0 && <tr><td colSpan={4} className="note">no tradable chain on the selected vehicles</td></tr>}
            </tbody></table>

            <div className="rh">Volatility</div>
            <table><thead><tr><th></th><th>IV30</th><th>25ΔRR</th><th>Term</th><th>Walls</th></tr></thead><tbody>
              {etfRows.map(t => <tr key={t.id}><td>{t.etf.tk}</td><td>{f(t.vol?.iv30, 1)}%</td>
                <td className={t.vol?.rr25 > 0 ? "r" : "g"}>{t.vol?.rr25 > 0 ? "+" : ""}{f(t.vol?.rr25)}</td>
                <td className={t.vol?.termSlope < 0.9 ? "am" : ""}>{f(t.vol?.termSlope)}</td>
                <td>{t.vol?.putWall}/{t.vol?.callWall}</td></tr>)}
            </tbody></table>
            <div className="note">Positive 25ΔRR = calls bid</div>

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
        <div className="disc"><b>Disclosures, Certification and Other Information:</b> Jones is a service offered by JonesTrading
          Institutional Services LLC. JonesTrading Institutional Services LLC does and seeks to do business with companies
          covered in its research reports. As a result, investors should be aware that the firm may have a conflict of interest
          that could affect the objectivity of this report. Please see the <b>Important Disclosures Appendix</b> starting on
          <b style={{ color: "var(--n-blue)" }}> PAGE 3</b>.</div>
        <Foot n={1} />
      </div>

      {/* ═══ PAGE 2 ═══ */}
      <div className="page">
        <div className="rhead">Institutional Tactical Note — {meta.title}<span>{meta.date}</span></div>

        <div className="exhblk"><div className="exh first">Exhibit 1: Vehicle Screening</div>
        <table className="x"><thead><tr><th>Theme</th><th>Selected</th><th>Alternatives considered</th><th>Why not selected</th></tr></thead><tbody>
          {etfRows.map(t => <tr key={t.id}><td>{cap(t.direction)} {t.subject}</td><td className="c">{t.etf.tk}</td>
            <td>{t.screening.considered.join(" · ") || "—"}</td><td>{t.screening.whyNot || "no second vehicle with a usable chain"}</td></tr>)}
        </tbody></table>
        <div className="src">Vehicles selected on directness of exposure, options liquidity, dollar volume, and structural decay over the holding period.</div>
        </div>

        {etfRows.some(t => t.levered.length) && (
          <div className="exhblk"><div className="exh">Exhibit 2: Levered and Inverse Alternatives — Not Recommended at This Horizon</div>
          <table className="x"><thead><tr><th>Underlying</th><th>Fund</th><th>Leverage</th><th>Gamma X(X−1)</th><th>Suitability at {meta.holdWindow}</th></tr></thead><tbody>
            {etfRows.flatMap(t => t.levered.map(l => <tr key={l.tk}><td>{t.etf.tk}</td><td>{l.tk}</td>
              <td className="c">{l.lev > 0 ? "+" : ""}{l.lev}x</td><td className="c">{l.gamma}</td>
              <td>days only — daily reset decay compounds over {meta.holdWindow}</td></tr>))}
          </tbody></table>
          <div className="src">Gamma is the rebalance multiplier: mechanical flow per 1% move per $1bn of fund assets. None is carried here.</div>
          </div>
        )}

        <div className="exhblk"><div className="exh">Exhibit 3: Positioning Map — Spot, Scale Range and Walls</div>
        <div className="pm">
          {etfRows.map(t => {
            const v = t.vol, p = t.etf.plan; if (!v?.putWall || !v?.callWall || !p) return null;
            const lo = v.putWall, hi = v.callWall, pad = (hi - lo) * 0.42, a = lo - pad, b = hi + pad;
            const X = x => `${14 + (x - a) / (b - a) * (100 - 14 - 16) / 1}%`;
            const Xmm = x => `calc(14mm + ${(x - a) / (b - a)} * (100% - 30mm))`;
            const sl = Math.min(t.etf.price, p.wall), sh = Math.max(t.etf.price, p.wall);
            return <div className="row" key={t.id}>
              <span className="tk">{t.etf.tk}</span><div className="ax" />
            {/* An immediate leg has no band to draw and no weighted average
                distinct from spot — drawing both put a ladder on the chart
                that the position does not have. */}
            {!p.single && <div className="band" style={{ left: Xmm(sl), width: `calc(${(sh - sl) / (b - a)} * (100% - 30mm))` }} />}
              {!p.single && p.rungs.map((r, i) => <div className="rung" key={i} style={{ left: Xmm(r.px) }} />)}
              <div className="wall p" style={{ left: Xmm(lo) }} /><span className="lab p" style={{ left: Xmm(lo) }}>{lo}</span>
              <div className="wall c" style={{ left: Xmm(hi) }} /><span className="lab c" style={{ left: Xmm(hi) }}>{hi}</span>
              <span className="lab s" style={{ left: Xmm(t.etf.price) }}>{f(t.etf.price)}</span>
              {!p.single && <><div className="avg" style={{ left: Xmm(p.entry) }} /><span className="avgl" style={{ left: Xmm(p.entry) }}>avg {f(p.entry, 0)}</span></>}
            </div>;
          })}
        </div>
        <div className="src">Walls in green/red. On a scaled leg the ticks are the five executions and the navy line is the weighted average; price-triggered, so an unfilled rung is an unbuilt position. An immediate leg shows spot against the walls only.</div>
        </div>

        <div className="exhblk"><div className="exh">Exhibit 4: ETF Expression</div>
        <table className="x"><thead><tr><th>Theme</th><th>ETF</th><th>Execution</th><th>Scale band</th><th>Target Entry</th><th>Implied 1σ range</th><th>Stop out</th><th>Risk</th></tr></thead><tbody>
          {etfRows.map(t => { const p = t.etf.plan, g = t.etf.tgt, s = t.etf.share; return <tr key={t.id}>
            <td>{cap(t.direction)} {t.subject}</td><td className="c">{t.etf.tk}</td><td className="c">{p?.execution}</td>
            <td className="c">{p?.single ? "—" : `${f(t.etf.price)} → ${f(p?.wall)}`}</td>
            <td className="c">{p?.single ? "current levels" : `${f(p?.entry)} (${pct(p?.entryImprovementPct)})`}</td>
            <td className="c">{f(g?.dn, 0)} – {f(g?.up, 0)}</td><td className="c">{f(p?.stop)}</td><td className="c">{f(s?.riskPct, 1)}%</td></tr>; })}
        </tbody></table>
        <div className="src">Stop is a close 1% beyond the open-interest wall the position was scaled into; risk is measured from the weighted average execution, or from current levels on an immediate leg.<br />
          Implied 1σ is the option-implied range over the holding period — the market's own measure of a normal move, not a price objective.</div>

        </div>
        <div className="exhblk"><div className="exh">Exhibit 5: Derivatives Expression</div>
        <table className="x"><thead><tr><th>Theme</th><th>ETF</th><th>Structure</th><th>Expiry</th><th>Legs</th><th>Net</th><th>Max gain</th><th>Breakeven</th><th>POP</th></tr></thead><tbody>
          {optRows.map(({ t, o }) => <tr key={t.id + o.id}><td>{cap(t.direction)} {t.subject}</td><td className="c">{t.etf.tk}</td>
            <td>{o.name}</td><td className="c">{o.expiry.slice(5)}</td><td className="c">{o.legText}</td>
            <td className="c">${f(Math.abs(o.pricing.net) / 100)} {o.pricing.net > 0 ? "dr" : "cr"}</td>
            <td className="c">{o.pricing.uncapped ? "uncapped" : "$" + f(o.pricing.maxGain / 100)}</td>
            <td className="c">{o.pricing.breakevens.join(" / ") || "—"}</td><td className="c">{f(o.econ.pop, 1)}%</td></tr>)}
          {optRows.length === 0 && <tr><td colSpan={9}>No derivatives expression carried.</td></tr>}
        </tbody></table>
        <div className="src">Marks from {[...new Set(optRows.map(x => x.o.pricing.priceSource))].join(" / ") || "the chain"}. POP is the probability of finishing beyond breakeven under the stated view.</div>
        </div>

        {optRows.length > 0 && <>
          <div className="exhblk"><div className="exh">Exhibit 6: Structure Notes</div>
          <table className="x"><thead><tr><th>Theme</th><th>Structure</th><th>Note</th></tr></thead><tbody>
            {optRows.flatMap(({ t, o }) => [
              <tr key={t.id + o.id}><td>{cap(t.direction)} {t.subject}</td><td>{o.name}</td><td>{o.why}</td></tr>,
              ...t.alternatives.slice(0, 1).map(a => <tr key={t.id + a.id}><td></td><td>{a.name}</td><td>Alternative: {a.why}</td></tr>),
            ])}
          </tbody></table>
          <div className="src">The first structure under each theme is the one carried; the second is the nearest alternative.</div>

          </div>
        <div className="exhblk"><div className="exh">Exhibit 7: Option Leg Detail</div>
          <table className="x"><thead><tr><th></th><th>Action</th><th>Qty</th><th>Expiry</th><th>Strike</th><th>Type</th><th>Mark</th><th>Moneyness</th><th>Delta</th><th>OI</th></tr></thead><tbody>
            {optRows.flatMap(({ t, o }) => o.pricing.legDetail.map((L, i) => <tr key={t.id + o.id + i}>
              <td>{i === 0 ? `${t.etf.tk} ${o.name}` : ""}</td><td className="c">{L.action}</td><td className="c">{L.qty}</td>
              <td className="c">{o.expiry.slice(5)}</td><td className="c">{L.strike}</td><td className="c">{L.type}</td>
              <td className="c">${f(L.px)}</td><td className="c">{pct(L.moneyness)}</td><td className="c">{f(L.delta, 3)}</td><td className="c">{L.oi.toLocaleString()}</td></tr>))}
          </tbody></table>
          <div className="src">One contract equals 100 shares. Delta shown per contract at the mark.</div>
          </div>
        </>}
        <Foot n={2} />
      </div>

      {/* ═══ PAGE 3 ═══ */}
      <div className="page appx">
        <div className="rhead"><span>{meta.date}</span></div>
        <div className="key"><b className="h">Key — Options Liquidity Grade</b>
          <div><b className="A">A</b>deep chain, tight markets, weekly and monthly listings — any structure supported</div>
          <div><b className="B">B</b>usable chain with wider markets — verticals and outrights</div>
          <div><b className="C">C</b>thin chain — outrights only, reduce size</div>
          <div><b className="X">X</b>no usable chain: contracts listed but unpriced or without open interest — shares only</div>
        </div>
        <div className="key"><b className="h">Key — Execution Mode</b>
          <div><b>Scaled</b>five executions at equal price intervals from the last sale to the wall, weighted 10 / 15 / 20 / 25 / 30</div>
          <div><b>Immediate</b>the full position at current levels, with no ladder — used inside 2% of the wall, when time-sensitive, and for every option leg</div>
          <div><b>Stop out</b>a close 1% beyond the wall the position was scaled into; alternative, a flat 5% from the weighted entry</div>
          <div><b>Risk</b>distance to the stop from the weighted average execution, or from current levels on an immediate leg</div>
        </div>
        <h1>IMPORTANT DISCLOSURES APPENDIX</h1>
        <h2>Disclaimer:</h2>
        <p>The following information has been provided only to the person or entity to which it is addressed for informational purposes only and should not be used or construed as an offer to sell, a solicitation, an offer to buy, or a recommendation for any security. This information is not purported to be tailored to any particular investor and is intended for institutional investors as defined by FINRA Rule 4512. Information and securities mentioned may reflect a third party’s independent opinions and are not recommendations of JonesTrading Institutional Services LLC (JTIS). JTIS does not guarantee that the information supplied is accurate, complete, or timely, or make any warranties with regard to the results obtained from its use.</p>
        <h2>Options Risk Disclosure:</h2>
        <p>Options involve risk and are not suitable for all investors. Prior to buying or selling an option, a person must receive a copy of Characteristics and Risks of Standardized Options. The structures illustrated are shown at indicative marks and do not reflect commissions, financing, assignment risk, or the bid-offer spread incurred in execution. Multi-leg strategies entail multiple commissions and may be closed at a loss prior to expiration. Probability of profit is derived from an option-implied distribution adjusted for the stated conviction and is not a forecast.</p>
        <div className="signoff"><Wordmark /></div>
        <div className="copy">Copyright 2026 JonesTrading Institutional Services LLC. All rights reserved.</div>
        <Foot n={3} />
      </div>
    </div>
  );
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
