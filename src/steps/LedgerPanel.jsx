/* ═══════════════════════════════════════════════════════════════════
   LedgerPanel.jsx — reading the idea history back.

   Deliberately plain. This is a diagnostic surface, not a product one: its
   job is to let a month of notes be exported and replayed against bars, and
   to make the stored inputs legible when a scoring decision needs
   explaining after the fact.

   The export is per LEG rather than per note, because that is the unit the
   monthly review works in — replay asks what happened to a position.
   ═══════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from "react";
import { listEntries, readEntry, removeEntry, toCsv } from "../lib/ledger.js";

const f = (v, d = 2) => v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d);

export default function LedgerPanel({ onClose }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listEntries().then(setRows).catch(e => { setErr(String(e.message || e)); setRows([]); });
  }, []);

  async function show(key) {
    if (open === key) { setOpen(null); setDetail(null); return; }
    setOpen(key); setDetail(null);
    try { setDetail(await readEntry(key)); } catch (e) { setErr(String(e.message || e)); }
  }

  async function exportAll() {
    setBusy(true);
    try {
      /* Every note, fully, then flattened to one row per leg. Slow on a
         large history and that is fine — it runs once a month. */
      const full = [];
      for (const r of rows || []) { try { full.push(await readEntry(r.key)); } catch { /* skip */ } }
      const blob = new Blob([toCsv(full)], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `idea-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    } finally { setBusy(false); }
  }

  async function drop(key) {
    if (!confirm(`Remove ${key} from the history?`)) return;
    try { await removeEntry(key); setRows(await listEntries()); setOpen(null); setDetail(null); }
    catch (e) { setErr(String(e.message || e)); }
  }

  return (
    <div className="ledger">
      <div className="ledger-head">
        <b>Idea history</b>
        <span className="mut">
          {rows == null ? "loading…" : `${rows.length} note${rows.length === 1 ? "" : "s"}`}
          {" · internal, never published"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="ghost" disabled={busy || !rows?.length} onClick={exportAll}>
          {busy ? "Exporting…" : "Export CSV"}
        </button>
        {onClose && <button className="ghost" onClick={onClose}>Close</button>}
      </div>

      {err && <div className="warnbox">{err}</div>}

      {rows?.length === 0 && !err && (
        <p className="mut" style={{ margin: "8px 0" }}>
          Nothing recorded yet. A note is written here when you print it — not when it is
          composed, since a note is composed several times while the prose is edited.
        </p>
      )}

      {rows?.map(r => (
        <div key={r.key} className="ledger-row">
          <button className="ledger-toggle" onClick={() => show(r.key)}>
            <code>{r.date || r.key}</code>
            <span>{r.title}</span>
            <span className="mut">{(r.legs || []).join(", ") || "—"}</span>
            <span className="mut">v{r.version || "?"}</span>
          </button>

          {open === r.key && (
            <div className="ledger-detail">
              {!detail && <span className="mut">loading…</span>}
              {detail && (<>
                <table className="k s"><thead><tr>
                  <th></th><th>spot</th><th>entry</th><th>stop</th><th>risk</th>
                  <th>EV</th><th>EV/risk</th><th>P(stop)</th><th>score</th><th>pur</th><th>conf</th>
                </tr></thead><tbody>
                  {(detail.legs || []).map(l => (
                    <tr key={l.ticker}>
                      <td><b>{l.ticker}</b> <span className="mut">{l.direction}</span></td>
                      <td className="r">{f(l.spot)}</td>
                      <td className="r">{f(l.weightedEntry)}</td>
                      <td className="r">{f(l.stop)}</td>
                      <td className="r">{f(l.riskPct, 1)}%</td>
                      <td className="r">{f(l.expectancy, 2)}%</td>
                      <td className="r">{f(l.evOnRisk, 2)}</td>
                      <td className="r">{f(l.pStopped, 1)}%</td>
                      <td className="r">{f(l.score, 3)}</td>
                      <td className="r">{f(l.purity, 2)}</td>
                      <td className="r">{f(l.confidence, 2)}</td>
                    </tr>
                  ))}
                </tbody></table>
                {detail.correlation && (
                  <div className="mut" style={{ marginTop: "4px" }}>
                    basket ρ {f(detail.correlation.basket, 2)} · independent {f(detail.correlation.independentRiskPct, 1)}%
                    → correlated {f(detail.correlation.correlatedRiskPct, 1)}%
                    {detail.correlation.cluster?.length ? ` · cluster ${detail.correlation.cluster.join(", ")}` : ""}
                    {detail.correlation.hedges?.length ? ` · hedge ${detail.correlation.hedges.join(", ")}` : ""}
                  </div>
                )}
                {detail.excluded?.length > 0 && (
                  <div className="mut" style={{ marginTop: "3px" }}>
                    excluded: {detail.excluded.map(w => `${w.tk} (${w.why})`).join("; ")}
                  </div>
                )}
                <div style={{ marginTop: "5px" }}>
                  <button className="ghost" onClick={() => drop(r.key)}>Remove</button>
                </div>
              </>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
