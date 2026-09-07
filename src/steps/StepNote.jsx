import { useEffect, useMemo, useRef, useState } from "react";
import RunLog from "../lib/runlog.js";
import { api } from "../lib/api.js";
import { composeNote, draftContext } from "../lib/compose.js";
import NoteView from "../note/NoteView.jsx";
import { buildExplainer } from "../lib/explain.js";

export default function StepNote({ parsed, picks, menus, noteState, setNoteState }) {
  const s = noteState;
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const [err, setErr] = useState(null);
  const [voice, setVoice] = useState(null);
  const auto = useRef(false);

  /* Draft on arrival. A blank page every morning defeats the purpose, and
     nothing is committed until a section is accepted. */
  useEffect(() => {
    if (auto.current || s.prose?.summary || note.themes.length === 0) return;
    auto.current = true;
    draft();
    /* eslint-disable-next-line */
  }, []);

  /* Prose is a passthrough in composeNote — it is attached to the model, it
     does not feed the ordering or the economics. Keeping s.prose in this
     dependency list re-derived the entire model on every keystroke: one run
     logged 66 recomposes and 132 ordering decisions while a paragraph was
     being edited, which is 45% of the run log and none of it a change. The
     model memoises on real inputs; prose is attached after. */
  const model = useMemo(() => composeNote({ parsed, picks, menus, settings: s }),
                        [parsed, picks, menus, s.title, s.subtitle, s.executeWindow, s.holdWindow, s.sector]);
  const note = useMemo(() => ({ ...model, prose: s.prose || { summary: "", themes: {}, execution: "" } }),
                       [model, s.prose]);

  const set = (k, v) => setNoteState(prev => ({ ...prev, [k]: v }));
  const setProse = (k, v) => {
    setNoteState(prev => {
      const p = { ...prev.prose };
      if (k === "summary" || k === "execution") p[k] = v; else p.themes = { ...p.themes, [k]: v };
      return { ...prev, prose: p };
    });
    RunLog.info("ui", "prose.edit", { field: k, chars: v.length });
  };
  const accept = (k, on = true) => {
    setNoteState(prev => {
      const a = { ...(prev.accepted || {}) };
      if (on) a[k] = true; else delete a[k];
      return { ...prev, accepted: a };
    });
    RunLog.info("ui", "prose.accept", { field: k, accepted: on });
  };
  /* One update, not one per section: calling accept() in a loop had every
     iteration reading the same snapshot, so only the last stuck. */
  const acceptAll = keys => {
    setNoteState(prev => ({ ...prev, accepted: Object.fromEntries(keys.map(k => [k, true])) }));
    RunLog.info("ui", "prose.acceptAll", { n: keys.length });
  };
  const sectionKeys = ["summary", ...note.themes.map(t => t.id), "execution"];
  const acceptedCount = sectionKeys.filter(k => s.accepted?.[k]).length;
  const allAccepted = acceptedCount === sectionKeys.length && sectionKeys.length > 0;

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
      // Match section headers to themes tolerantly — the model may vary case
      // or spacing in the subject it echoes back.
      const norm = k => String(k || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const bySubj = Object.fromEntries(Object.entries(p.themes || {}).map(([k, v]) => [norm(k), v]));
      const themes = {};
      const unmatched = [];
      for (const th of note.themes) {
        const hit = bySubj[norm(th.subject)] || bySubj[norm(th.id)]
          || Object.entries(bySubj).find(([k]) => k.includes(norm(th.subject)) || norm(th.subject).includes(k))?.[1];
        themes[th.id] = hit || "";
        if (!hit) unmatched.push(th.subject);
      }
      if (unmatched.length) RunLog.warn("ui", "draft.unmatched.themes", { unmatched, returned: Object.keys(p.themes || {}) });
      setNoteState(prev => ({ ...prev, prose: { summary: p.summary || "", themes, execution: p.execution || "" },
                     accepted: {},                       // nothing accepted until read
                     partial: p.partial || null,
                     draftedBy: res.model, draftedAt: new Date().toISOString() }));
      setVoice(res.voice && Object.keys(res.voice).length ? res.voice : null);
      t.end({ model: res.model, voiceHits: res.voice ? Object.keys(res.voice).length : 0 });
    } catch (e) { t.fail(e); setErr(e.message); }
    setBusy(false); setPhase(null);
  }

  /* The browser names the PDF from document.title. Set it for the print
     and put it back afterwards so the tab is unaffected. */
  function fileStem() {
    const d = new Date();
    const stamp = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${d.getFullYear()}`;
    const primary = note.etfOrder[0]?.label || note.themes[0]?.etf?.tk || "NOTE";
    return `${stamp}-${primary}`;
  }

  function print() {
    const name = `${fileStem()}-Tactical Note \u2014 JonesTrading`;
    const prev = document.title;
    document.title = name;
    RunLog.info("ui", "note.print", { filename: name, themes: note.themes.length });
    window.print();
    setTimeout(() => { document.title = prev; }, 800);
  }

  /* Internal audit of every scoring and ordering decision. The note states
     no criterion; this is where the criterion lives. */
  function explainer() {
    const html = buildExplainer({ note, menus });
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileStem()}-Ranking explainer.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    RunLog.info("ui", "explainer.download", { kb: +(html.length / 1024).toFixed(1), themes: note.themes.length });
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
            <input type="text" spellCheck="true" value={s.title || ""} onChange={e => set("title", e.target.value)} placeholder={parsed.sourceTitle} />
          </div>
          <div style={{ flex: 3, minWidth: 300 }}>
            <div className="sec-label">Subtitle</div>
            <input type="text" spellCheck="true" value={s.subtitle || ""} onChange={e => set("subtitle", e.target.value)} placeholder="The argument in one line" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="sec-label">Execute</div>
            <input type="text" spellCheck="true" value={s.executeWindow || ""} onChange={e => set("executeWindow", e.target.value)} placeholder="5 to 10 days" />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div className="sec-label">Hold</div>
            <input type="text" spellCheck="true" value={s.holdWindow || ""} onChange={e => set("holdWindow", e.target.value)} placeholder="4 to 6 weeks" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="sec-label">Sector line</div>
            <input type="text" spellCheck="true" value={s.sector || ""} onChange={e => set("sector", e.target.value)} placeholder="Cross-Asset / Macro" />
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
          <button className="ghost" disabled={!hasProse} onClick={print}
                  title={allAccepted ? "" : "Sections still unaccepted — they will print with a draft mark on screen only"}>
            Print / Save as PDF
          </button>
          <button className="ghost" disabled={note.themes.length === 0} onClick={explainer}
                  title="Internal: every score, weight and ordering decision behind this note">
            Ranking explainer
          </button>
          <button className="ghost" disabled={!hasProse || allAccepted}
                  onClick={() => acceptAll(sectionKeys)}>
            Accept all
          </button>
          {s.draftedBy && <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            drafted by {s.draftedBy} · {new Date(s.draftedAt).toLocaleTimeString()}</span>}
          <span className="spacer" />
          <span style={{ fontSize: 12, color: allAccepted ? "var(--green)" : "var(--muted)" }}>
            {hasProse ? `${acceptedCount} of ${sectionKeys.length} sections accepted · ` : ""}
            {note.etfOrder.length} ETF · {note.optOrder.length} derivatives
          </span>
        </div>
        {busy && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Opus drafts in 20–60 seconds.</div>}
        {s.partial && <div className="note" style={{ marginTop: 10 }}>
          The draft was cut short — <b>{s.partial.join(" and ")}</b> {s.partial.length > 1 ? "are" : "is"} empty.
          Re-draft, or write {s.partial.length > 1 ? "them" : "it"} yourself.
        </div>}
      </div>

      <NoteView note={note} onProse={setProse} accepted={s.accepted || {}} onAccept={accept} />
    </>
  );
}
