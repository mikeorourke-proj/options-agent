import { useState } from "react";
import RunLog from "../lib/runlog.js";
import { api } from "../lib/api.js";
import { TAG_VOCAB } from "../data/etf-universe.js";

const SAMPLE = `Buy Treasury bonds ahead of the Treasury Department's increased long bond \
repurchases starting September 9th. The buybacks pull duration out of the 20-30 year \
sector right when dealer inventories are heavy and the quarter's supply has already \
been absorbed. This should support the long end regardless of what the data does.`;

export default function StepThesis({ intent, setIntent, onNext }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function parse() {
    setBusy(true); setErr(null);
    const t = RunLog.timer("ui", "thesis.parse", { chars: text.length });
    try {
      const res = await api.think("thesis", text, { vocab: TAG_VOCAB });
      if (!res.parsed) throw new Error(res.parseError || res.error || "model returned unparseable output");

      RunLog.fact("intent.direction", res.parsed.direction, { src: "think/thesis" });
      RunLog.fact("intent.tags", res.parsed.tags, { src: "think/thesis", vocabGated: true });
      if (res.droppedTags?.length) RunLog.warn("ui", "tags outside vocabulary were dropped", res.droppedTags);

      setIntent({ ...res.parsed, sourceText: text });
      t.end({ direction: res.parsed.direction, tags: res.parsed.tags?.length, tokens: res.usage });
      onNext();
    } catch (e) {
      t.fail(e); setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <>
      <div className="card">
        <h2>The idea</h2>
        <p className="hint">
          Write it the way you would say it to a client. Paste a story in if the idea came from one.
          The parser extracts direction, asset class, catalyst and timeframe — it does not pick tickers.
        </p>

        {err && <div className="err-banner"><b>Parse failed.</b> {err}</div>}

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="e.g. Buy duration ahead of the Treasury buyback expansion on September 9th…"
        />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || text.trim().length < 40} onClick={parse}>
            {busy ? <><span className="spin" /> &nbsp;Reading…</> : "Parse idea →"}
          </button>
          <button className="ghost" onClick={() => setText(SAMPLE)}>Load example</button>
          {text.trim().length > 0 && text.trim().length < 40 &&
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {40 - text.trim().length} more characters
            </span>}
        </div>
      </div>

      {intent && (
        <div className="card">
          <div className="sec-label">Parsed intent</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--jblue)", marginBottom: 10 }}>
            {intent.headline}
          </div>

          <div className="veh" style={{ display: "block" }}>
            <div className="stats" style={{ marginTop: 0 }}>
              <span>direction <b>{intent.direction}</b></span>
              <span>class <b>{intent.assetClass}</b></span>
              <span>horizon <b>{intent.horizon}</b></span>
              <span>conviction <b>{intent.conviction}</b></span>
              <span>catalyst <b>{intent.catalyst?.date || "none stated"}</b></span>
            </div>

            <div style={{ marginTop: 10 }}>
              {intent.tags?.map(t => <span className="tag" key={t}>{t}</span>)}
              {intent.direction === "pair" && intent.pairShort?.length > 0 && (
                <>
                  <span style={{ fontSize: 11, color: "var(--muted)", margin: "0 6px" }}>vs short</span>
                  {intent.pairShort.map(t => <span className="tag" key={t} style={{ background: "rgba(192,0,0,.08)", color: "var(--red)" }}>{t}</span>)}
                </>
              )}
            </div>

            <div className="why" style={{ marginTop: 9 }}>{intent.rationale}</div>

            {intent.risks?.length > 0 && (
              <div style={{ marginTop: 9, fontSize: 12, color: "var(--muted)" }}>
                <b style={{ color: "var(--ink)" }}>Invalidated by:</b> {intent.risks.join(" · ")}
              </div>
            )}
          </div>

          {!intent.catalyst?.date && (
            <div className="note" style={{ marginTop: 12 }}>
              No catalyst date was stated, so the expiry can't be anchored to an event.
              You can set one on the next step.
            </div>
          )}
        </div>
      )}
    </>
  );
}
