import { useEffect, useState } from "react";
import RunLog from "../lib/runlog.js";
import { api, mapLimit } from "../lib/api.js";
import { searchUniverse, BY_TICKER } from "../data/etf-universe.js";

const fmtM = n => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${(n || 0).toFixed(0)}`;
const fmtSh = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${((n || 0) / 1e3).toFixed(0)}K`;

/* Liquidity gate. A chain with no greeks and no open interest cannot
   support an options structure — RSP is the canonical case. This is the
   check that decides whether the note offers options at all. */
function gradeChain(q) {
  if (!q) return { grade: "X", tradable: false, why: "no chain returned" };
  const { withGreeks = 0, withOI = 0, fetched = 0 } = q;
  if (withGreeks < 20 || withOI < 20) return { grade: "X", tradable: false, why: `${fetched} contracts, ${withGreeks} priced, ${withOI} with OI — shares only` };
  if (withGreeks < 120) return { grade: "C", tradable: true, why: `${withGreeks} priced contracts — thin, outrights only` };
  if (withGreeks < 400) return { grade: "B", tradable: true, why: `${withGreeks} priced contracts — verticals workable` };
  return { grade: "A", tradable: true, why: `${withGreeks} priced contracts — full structure range` };
}

export default function StepVehicles({ intent, vehicles, setVehicles, onNext }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [sel, setSel] = useState(new Set(vehicles.map(v => v.ticker)));

  useEffect(() => { screen(); /* eslint-disable-next-line */ }, []);

  async function screen() {
    setBusy(true);
    const t = RunLog.timer("ui", "vehicles.screen");

    // Retrieval, not recall: candidates come from the curated table only.
    const longSide = searchUniverse(intent.tags, { cls: intent.assetClass, limit: 6 });
    const shortSide = intent.direction === "pair" && intent.pairShort?.length
      ? searchUniverse(intent.pairShort, { cls: intent.assetClass, limit: 4 })
      : [];

    const cands = [
      ...longSide.map(e => ({ ...e, leg: "long" })),
      ...shortSide.filter(e => !longSide.some(l => l.t === e.t)).map(e => ({ ...e, leg: "short" })),
    ];
    RunLog.info("ui", "candidates", { n: cands.length, tickers: cands.map(c => c.t), fromTags: intent.tags });

    if (!cands.length) { setRows([]); setBusy(false); t.end({ n: 0 }); return; }

    const out = await mapLimit(cands, 3, async (c) => {
      try {
        const [q, ref] = await Promise.all([api.quote(c.t), api.reference(c.t)]);
        const price = q?.price || 0;
        const chain = price > 0 ? await api.chain(c.t, price) : null;
        const gate = gradeChain(chain?.quality);

        const so = ref?.sharesOutstanding || 0;
        const aum = so && price ? so * price : 0;

        RunLog.gate(`liquidity:${c.t}`, gate.tradable, { grade: gate.grade, ...chain?.quality });
        if (aum) RunLog.fact(`aum.${c.t}`, aum, { src: "shares_outstanding × price", so, price });

        return { ...c, price, volume: q?.volume || 0, aum, sharesOut: so, name: ref?.name || c.n, gate };
      } catch (e) {
        RunLog.error("ui", `screen ${c.t} failed`, e);
        return { ...c, error: e.message, gate: { grade: "X", tradable: false, why: "data error" } };
      }
    });

    // Rank: tag fit first, tradable chains ahead of untradable ones.
    out.sort((a, b) => (b.gate.tradable - a.gate.tradable) || (b.score - a.score));
    setRows(out);
    setBusy(false);
    t.end({ screened: out.length, tradable: out.filter(r => r.gate.tradable).length });
  }

  function toggle(tk) {
    const next = new Set(sel);
    next.has(tk) ? next.delete(tk) : next.add(tk);
    setSel(next);
    RunLog.info("ui", "vehicle.toggle", { ticker: tk, selected: next.has(tk) });
  }

  function proceed() {
    const chosen = rows.filter(r => sel.has(r.t)).map(r => ({
      ticker: r.t, name: r.name, leg: r.leg, price: r.price, aum: r.aum,
      volume: r.volume, sharesOut: r.sharesOut, liq: r.gate.grade, optionable: r.gate.tradable,
    }));
    RunLog.fact("vehicles", chosen.map(c => `${c.ticker}:${c.leg}`), { src: "user selection" });
    setVehicles(chosen);
    onNext();
  }

  const chosen = rows.filter(r => sel.has(r.t));
  const anyOptionable = chosen.some(r => r.gate.tradable);

  return (
    <div className="card">
      <h2>Vehicles</h2>
      <p className="hint">
        Candidates are matched from the curated ETF table on the parsed tags, then screened live for
        price, size and options liquidity. Tick the ones to carry into the note.
      </p>

      {busy && <div className="row" style={{ padding: "18px 0" }}>
        <span className="spin" /> <span style={{ color: "var(--muted)", fontSize: 13 }}>Screening candidates…</span>
      </div>}

      {!busy && rows.length === 0 &&
        <div className="note">No vehicle in the table matches these tags. Broaden the idea, or add the fund to the universe file.</div>}

      {rows.map(r => (
        <label key={r.t} className={`veh ${sel.has(r.t) ? "sel" : ""} ${r.gate.tradable ? "" : "blocked"}`}>
          <input type="checkbox" checked={sel.has(r.t)} onChange={() => toggle(r.t)} />
          <div style={{ flex: 1 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="tk">{r.t}</span>
              <span className={`pill ${r.gate.grade.toLowerCase()}`}>
                {r.gate.grade === "X" ? "shares only" : `options ${r.gate.grade}`}
              </span>
              {r.leg === "short" && <span className="pill x">short leg</span>}
              {r.lev && <span className="pill c">{r.lev > 0 ? `${r.lev}x` : `${r.lev}x inverse`}</span>}
            </div>
            <div className="nm">{r.name}</div>

            <div className="stats">
              <span>px <b>{r.price ? `$${r.price.toFixed(2)}` : "—"}</b></span>
              <span>aum <b>{r.aum ? fmtM(r.aum) : "—"}</b></span>
              <span>vol <b>{fmtSh(r.volume)}</b></span>
              {r.dur && <span>dur <b>{r.dur}y</b></span>}
              <span style={{ color: "var(--muted)" }}>{r.gate.why}</span>
            </div>

            <div style={{ marginTop: 5 }}>
              {r.hits?.map(h => <span className="tag" key={h}>{h}</span>)}
            </div>
            {r.error && <div className="why" style={{ color: "var(--red)" }}>{r.error}</div>}
          </div>
        </label>
      ))}

      {!busy && chosen.length > 0 && !anyOptionable && (
        <div className="note" style={{ marginTop: 12 }}>
          Nothing selected has a tradable options chain. The note will be built as a shares
          expression with a hedge ratio, and the options section will be omitted.
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={chosen.length === 0} onClick={proceed}>
          Continue with {chosen.length || "no"} vehicle{chosen.length === 1 ? "" : "s"} →
        </button>
        <button className="ghost" onClick={screen} disabled={busy}>Re-screen</button>
      </div>
    </div>
  );
}
