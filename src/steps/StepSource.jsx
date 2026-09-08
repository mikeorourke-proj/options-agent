import { useState } from "react";
import RunLog from "../lib/runlog.js";
import { api } from "../lib/api.js";
import { TAG_VOCAB, ANCHOR_VOCAB } from "../data/etf-universe.js";

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

/* The file is uploaded to pdf-stash, an ordinary synchronous function, and
   only its key is passed to the background job. Synchronous functions accept
   6 MB and the raw bytes go up unencoded, so 4 MB leaves ample room. */
const PDF_MAX = 4 * 1024 * 1024;

export default function StepSource({ parsed, setParsed, onNext }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const [err, setErr] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [reading, setReading] = useState(false);
  const [transcribed, setTranscribed] = useState(null);
  const [stalled, setStalled] = useState(null);

  function loadSample(key) {
    setText(SAMPLES[key]); setFileName(null); setTranscribed(null); setErr(null);
  }

  async function onFile(f) {
    if (!f) return;
    setErr(null);
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    const kb = +(f.size / 1024).toFixed(1);

    if (!isPdf) {
      setFileName(f.name); setTranscribed(null);
      setText(await f.text());
      RunLog.info("ui", "source.file", { name: f.name, kb });
      return;
    }

    if (f.size > PDF_MAX) {
      setErr(`${f.name} is ${(f.size / 1048576).toFixed(1)} MB. The upload ceiling is 4 MB — print a shorter range or paste the text.`);
      return;
    }

    setFileName(f.name); setTranscribed(null); setStalled(null); setReading(true);
    const t = RunLog.timer("ui", "source.pdf", { name: f.name, kb });
    try {
      const res = await api.transcribe(f, tick);
      applyTranscript(res, f.name);
      t.end({ chars: res.parsed.text.length, model: res.model, tokens: res.usage });
    } catch (e) {
      t.fail(e);
      /* A timeout is not a failure of the job, only of the wait. The
         background function runs to 15 minutes and the blob is never
         deleted, so the transcript is usually there shortly after. Keep the
         jobId and offer to look again rather than making the analyst
         re-upload and pay for the read twice. */
      if (e.jobId) {
        setStalled({ jobId: e.jobId, name: f.name });
        setErr(`${f.name} has not come back in four minutes. ${e.lastStatus === "running" ? "The model is still working on it" : "The job never reached the model"} — the read continues on the server for up to 15 minutes.`);
      } else {
        setErr(`Could not read ${f.name}. ${e.message}`);
        setFileName(null);
      }
    }
    setReading(false); setPhase(null);
  }

  const tick = (status, polls, secs) => setPhase(`${status === "running" ? "reading" : "queued"} · ${secs}s`);

  function applyTranscript(res, name) {
    const out = res?.parsed?.text;
    if (!out) throw new Error(res?.parseError || res?.error || "no text came back");
    setText(out);
    setTranscribed({ name, chars: out.length });
    setStalled(null); setErr(null);
    RunLog.fact("sourceText", `${out.length} chars from ${name}`,
                { src: "think/transcribe", model: res.model });
  }

  async function checkAgain() {
    if (!stalled) return;
    setReading(true); setErr(null);
    const t = RunLog.timer("ui", "source.pdf.resume", { jobId: stalled.jobId, name: stalled.name });
    try {
      const res = await api.pollJob("transcribe", stalled.jobId, tick, 120000);
      applyTranscript(res, stalled.name);
      t.end({ chars: res.parsed.text.length, model: res.model });
    } catch (e) {
      t.fail(e);
      setErr(e.jobId
        ? `${stalled.name} is still running. Check again, or paste the text instead.`
        : `Could not read ${stalled.name}. ${e.message}`);
    }
    setReading(false); setPhase(null);
  }

  async function extract() {
    setBusy(true); setErr(null);
    const t = RunLog.timer("ui", "themes.extract", { chars: text.length, hasNote: Boolean(note.trim()) });
    try {
      const res = await api.thinkLong(
        "themes", text,
        { vocab: TAG_VOCAB, anchors: ANCHOR_VOCAB, note: note.trim() || undefined },
        (status, polls, secs) => setPhase(`${status === "running" ? "reading" : "queued"} · ${secs}s`)
      );
      if (res.truncated && !res.parsed)
        throw new Error(`${res.parseError} (${res.usage?.out} tokens returned)`);
      if (!res.parsed?.themes?.length) throw new Error(res.parseError || res.error || "no themes returned");

      RunLog.fact("themes", res.parsed.themes.map(x => `${x.direction}:${x.subject}`),
                  { src: "think/themes", model: res.model });
      if (res.quotedEvidenceRejected?.length)
        RunLog.warn("ui", "evidence rejected as quoted material", res.quotedEvidenceRejected);
      if (res.attributionFlags?.length)
        RunLog.warn("ui", "possible attribution in output", res.attributionFlags);

      setParsed({ ...res.parsed, sourceText: text, analystNote: note, model: res.model,
                  attributionFlags: res.attributionFlags || [], quotedRejected: res.quotedEvidenceRejected || [] });
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

        {err && (
          <div className={stalled ? "note" : "err-banner"}>
            <b>{stalled ? "Still reading." : "Extraction failed."}</b> {err}
            {stalled && !reading && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={checkAgain}>Check again</button>
                <span style={{ fontSize: 11.5 }}>
                  Nothing is re-sent and nothing is charged twice — this only looks for the finished read.
                </span>
              </div>
            )}
            {stalled && reading && <div style={{ marginTop: 6, fontSize: 12 }}><span className="spin" />&nbsp; {phase || "checking…"}</div>}
          </div>
        )}

        <textarea spellCheck="true" value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 210 }}
          placeholder="Paste the note or story here…" />

        {transcribed && (
          <div className="note" style={{ marginTop: 10 }}>
            <b>Read from {transcribed.name}</b> — {transcribed.chars.toLocaleString()} characters, now
            editable above. Check it before extracting, and check the quotation marks in particular:
            a quoted sentence is treated as someone else's view rather than yours, so a pair lost in
            the PDF would hand the parser an argument you were rebutting.
          </div>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          <label className="ghost" style={{ cursor: reading ? "default" : "pointer", opacity: reading ? .55 : 1 }}>
            {reading ? <><span className="spin" />&nbsp; {phase || "Reading PDF…"}</> : "Upload .pdf / .txt / .md"}
            <input type="file" accept=".pdf,.txt,.md,.markdown" style={{ display: "none" }} disabled={reading}
                   onChange={e => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {fileName && !reading && <span style={{ fontSize: 12, color: "var(--muted)" }}>{fileName}</span>}
          <span className="spacer" />
          <button className="ghost" disabled={reading} onClick={() => loadSample("debasement")}>Example: debasement</button>
          <button className="ghost" disabled={reading} onClick={() => loadSample("semis")}>Example: semis</button>
        </div>
        {reading && (
          <p className="hint" style={{ marginTop: 6 }}>
            The PDF is transcribed rather than summarised, so a Closing Print takes about as long as
            the extraction does.
          </p>
        )}
      </div>

      <div className="card">
        <div className="sec-label">Your read <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— authoritative, overrides the document</span></div>
        <p className="hint" style={{ marginBottom: 10 }}>
          Anything you add here is treated as your own stated view. Use it for the inference the
          document doesn't contain — a second-order read, a group the story never names, or a
          direction you disagree with.
        </p>
        <textarea spellCheck="true" value={note} onChange={e => setNote(e.target.value)} style={{ minHeight: 92 }}
          placeholder="e.g. This pushes the neoclouds to the back of OpenAI's compute queue — bearish that group even though the story never mentions them." />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || reading || text.trim().length < 120} onClick={extract}>
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
