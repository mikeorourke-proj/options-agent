import { useMemo, useState } from "react";
import RunLog from "../lib/runlog.js";
import { api } from "../lib/api.js";
import { composeNote, draftContext } from "../lib/compose.js";
import NoteView from "../note/NoteView.jsx";

export default function StepNote({ parsed, picks, menus, noteState, setNoteState }) {
  const s = noteState;
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const [err, setErr] = useState(null);
  const [voice, setVoice] = useState(null);

  const note = useMemo(() => composeNote({ parsed, picks, menus, settings: s }),
                       [parsed, picks, menus, s.title, s.subtitle, s.executeWindow, s.holdWindow, s.sector, s.prose]);

  const set = (k, v) => setNoteState({ ...s, [k]: v });
  const setProse = (k, v) => {
    const p = { ...s.prose };
    if (k === "summary" || k === "execution") p[k] = v; else p.themes = { ...p.themes, [k]: v };
    setNoteState({ ...s, prose: p });
    RunLog.info("ui", "prose.edit", { field: k, chars: v.length });
  };

  /* The draft is a button, not a side effect: a draft you didn't ask for
     is worse than a blank page. */
  async function draft() {
    setBusy(true); setErr(null); setVoice(null);
    const t = RunLog.timer("llm", "draft");
    try {
      const ctx = draftContext(note);
      const res = await api.thinkLong("draft", JSON.stringify(ctx), {},
        (status, polls, secs) => setPhase(`${status} · ${secs}s`));
      if (!res?.parsed) throw new Error(res?.parseError || "no draft returned");
      const p = res.parsed;
      // Map the model's subject keys back to theme ids.
      const themes = {};
      for (const th of note.themes) themes[th.id] = p.themes?.[th.subject] || p.themes?.[th.id] || "";
      setNoteState({ ...s, prose: { summary: p.summary || "", themes, execution: p.execution || "" },
                     draftedBy: res.model, draftedAt: new Date().toISOString() });
      setVoice(res.voice && Object.keys(res.voice).length ? res.voice : null);
      t.end({ model: res.model, voiceHits: res.voice ? Object.keys(res.voice).length : 0 });
    } catch (e) { t.fail(e); setErr(e.message); }
    setBusy(false); setPhase(null);
  }

  function print() {
    RunLog.info("ui", "note.print", { title: note.meta.title, themes: note.themes.length });
    window.print();
  }

  const hasProse = Boolean(s.prose?.summary);

  return (
    <>
      <div className="card">
        <h2>Note</h2>
        <p className="hint">Title, subtitle and windows are yours. Draft fills the prose from the selections; every paragraph
          is then editable in the page below — click into it and type. Print exports the three pages to PDF.</p>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 260 }}>
            <div className="sec-label">Title</div>
            <input type="text" value={s.title || ""} onChange={e => set("title", e.target.value)} placeholder={parsed.sourceTitle} />
          </div>
          <div style={{ flex: 3, minWidth: 300 }}>
            <div className="sec-label">Subtitle</div>
            <input type="text" value={s.subtitle || ""} onChange={e => set("subtitle", e.target.value)} placeholder="The argument in one line" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="sec-label">Execute</div>
            <input type="text" value={s.executeWindow || ""} onChange={e => set("executeWindow", e.target.value)} placeholder="5 to 10 days" />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="sec-label">Hold</div>
            <input type="text" value={s.holdWindow || ""} onChange={e => set("holdWindow", e.target.value)} placeholder="4 to 6 weeks" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="sec-label">Sector line</div>
            <input type="text" value={s.sector || ""} onChange={e => set("sector", e.target.value)} placeholder="Cross-Asset / Macro" />
          </div>
        </div>

        {err && <div className="err-banner" style={{ marginTop: 12 }}><b>Draft failed.</b> {err}</div>}
        {voice && (
          <div className="note" style={{ marginTop: 12 }}>
            <b>Voice checks flagged the draft.</b> Edit before printing:
            <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
              {Object.entries(voice).map(([k, hits]) => <li key={k}><b>{k}</b>: {hits.map(h => `${h.msg} ("${h.phrase}")`).join("; ")}</li>)}
            </ul>
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={busy || note.themes.length === 0} onClick={draft}>
            {busy ? <><span className="spin" />&nbsp; {phase || "Sending…"}</> : hasProse ? "Re-draft with Opus" : "Draft with Opus"}
          </button>
          <button className="ghost" disabled={!hasProse} onClick={print}>Print / Save as PDF</button>
          {s.draftedBy && <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            drafted by {s.draftedBy} · {new Date(s.draftedAt).toLocaleTimeString()}</span>}
          <span className="spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {note.etfOrder.length} ETF · {note.optOrder.length} derivatives · {note.themes.length} theme{note.themes.length === 1 ? "" : "s"}
          </span>
        </div>
        {busy && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Opus drafts in 20–40 seconds.</div>}
      </div>

      <NoteView note={note} onProse={setProse} />
    </>
  );
}
