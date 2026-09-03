import { useState } from "react";
import RunLog from "../lib/runlog.js";
import { api } from "../lib/api.js";
import { TAG_VOCAB } from "../data/etf-universe.js";

const SAMPLES = {
  debasement: `Debunking Debasement

With gold crossing the $4,000 mark to a new record and silver pulling within pennies of its 2011 record peak, the "debasement trade" was at the center of the news cycle today. It represents a lack of confidence in both central banks and governments. It is important to note the risk-on trend in these assets has been strong since the April lows.

The key underlying factors supporting the thesis behind this trade are not new. The crypto crowd has been there for years. Thus, it is understandable that it is consensus thinking that debasement is an intended policy.

Then there is the government debt argument. We are all aware that deficit spending has been out of control since the pandemic. The irresponsible spending has pushed U.S. debt to GDP to 124%. That is alarming but note Japan's debt to GDP is 235% and over the past 25 years Japan's core CPI has averaged 0.27%.

There is little doubt in our mind that the transitory policy missteps 3-4 years ago set the stage for the current "debasement" trade. We would argue that this iteration of the trade is much closer to the end rather than the beginning. After peaking at $2 trillion at the end of 2022, the overnight reverse repo facility is essentially drained as it is down to $5 billion. Bank reserves just dipped below $3 trillion for the first time since 2022 this month. It suggests the debasement the market is currently excited about is akin to a general fighting the last war rather than placing the data in perspective. When signs emerge that the U.S. government shutdown is set to end, it will be an ideal trigger for a reversal.`,
  semis: `Evolving Mix

We know it is the week before Labor Day and volumes are light, but there were some interesting moves. Nvidia, Dell, Meta Platforms, Micron Technology and Google accounted for the entirety of the S&P 500 gain today. The disappointing reaction to Palo Alto's earnings fueled selling throughout the software space, especially cybersecurity. Investor disappointment in Credo Technology's earnings led to selling throughout the AI equipment space.

Broadcom's earnings release after the market close today was the day's key event. The fiscal Q3 numbers reported were slightly better than forecast. The Q4 revenue guidance was slightly below forecast. Nvidia is funding its customers at will while Broadcom needs to allow its customers to grow into its product deliveries.

Google is being supplanted as Broadcom's largest XPU customer by two companies that remain cash flow negative. When you add Nvidia's combined exposure to SpaceX and OpenAI, the fates of the largest semiconductor companies in the world are irrevocably tied to financially insecure AI enterprises that are in the midst of a fierce LLM token price war. One can understand if P/E multiples are constrained at least until those enterprises receive an influx of cash.`,
};

export default function StepSource({ parsed, setParsed, onNext }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const [err, setErr] = useState(null);
  const [fileName, setFileName] = useState(null);

  async function onFile(f) {
    if (!f) return;
    setErr(null); setFileName(f.name);
    if (f.type === "application/pdf") {
      setErr("PDF upload lands in the next build — for now copy the text across.");
      setFileName(null); return;
    }
    setText(await f.text());
    RunLog.info("ui", "source.file", { name: f.name, kb: +(f.size / 1024).toFixed(1) });
  }

  async function extract() {
    setBusy(true); setErr(null);
    const t = RunLog.timer("ui", "themes.extract", { chars: text.length, hasNote: Boolean(note.trim()) });
    try {
      const res = await api.thinkLong(
        "themes", text,
        { vocab: TAG_VOCAB, note: note.trim() || undefined },
        (status, polls, secs) => setPhase(`${status === "running" ? "reading" : "queued"} · ${secs}s`)
      );
      if (res.truncated && !res.parsed)
        throw new Error(`${res.parseError} (${res.usage?.out} tokens returned)`);
      if (!res.parsed?.themes?.length) throw new Error(res.parseError || res.error || "no themes returned");

      RunLog.fact("themes", res.parsed.themes.map(x => `${x.direction}:${x.subject}`),
                  { src: "think/themes", model: res.model });
      if (res.quotedEvidenceRejected?.length)
        RunLog.warn("ui", "evidence rejected as quoted material", res.quotedEvidenceRejected);

      setParsed({ ...res.parsed, sourceText: text, analystNote: note, model: res.model });
      t.end({ themes: res.parsed.themes.length, model: res.model, tokens: res.usage });
      onNext();
    } catch (e) { t.fail(e); setErr(e.message); }
    setBusy(false); setPhase(null);
  }

  return (
    <>
      <div className="card">
        <h2>Source</h2>
        <p className="hint">
          Paste a Closing Print, a news story, or write the idea directly. The parser reads what
          <b> you </b>conclude — material inside quotation marks is treated as context, never as evidence.
        </p>

        {err && <div className="err-banner"><b>Extraction failed.</b> {err}</div>}

        <textarea value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 210 }}
          placeholder="Paste the note or story here…" />

        <div className="row" style={{ marginTop: 8 }}>
          <label className="ghost" style={{ cursor: "pointer" }}>
            Upload .txt / .md
            <input type="file" accept=".txt,.md,.markdown" style={{ display: "none" }}
                   onChange={e => onFile(e.target.files?.[0])} />
          </label>
          {fileName && <span style={{ fontSize: 12, color: "var(--muted)" }}>{fileName}</span>}
          <span className="spacer" />
          <button className="ghost" onClick={() => setText(SAMPLES.debasement)}>Example: debasement</button>
          <button className="ghost" onClick={() => setText(SAMPLES.semis)}>Example: semis</button>
        </div>
      </div>

      <div className="card">
        <div className="sec-label">Your read <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— authoritative, overrides the document</span></div>
        <p className="hint" style={{ marginBottom: 10 }}>
          Anything you add here is treated as your own stated view. Use it for the inference the
          document doesn't contain — a second-order read, a group the story never names, or a
          direction you disagree with.
        </p>
        <textarea value={note} onChange={e => setNote(e.target.value)} style={{ minHeight: 92 }}
          placeholder="e.g. This pushes the neoclouds to the back of OpenAI's compute queue — bearish that group even though the story never mentions them." />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || text.trim().length < 120} onClick={extract}>
            {busy ? <><span className="spin" />&nbsp; {phase || "Sending…"}</> : "Extract themes →"}
          </button>
          {busy && <span style={{ fontSize: 12, color: "var(--muted)" }}>Opus takes 25-40s on a full note.</span>}
          {text.trim().length > 0 && text.trim().length < 120 &&
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{120 - text.trim().length} more characters</span>}
        </div>
      </div>
    </>
  );
}
