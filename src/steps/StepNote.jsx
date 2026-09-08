import { useEffect, useMemo, useRef, useState } from "react";
import RunLog from "../lib/runlog.js";
import { api } from "../lib/api.js";
import { composeNote, draftContext, analystMeta } from "../lib/compose.js";
import NoteView from "../note/NoteView.jsx";
import { buildExplainer } from "../lib/explain.js";

export default function StepNote({ parsed, picks, menus, noteState, setNoteState }) {
  const s = noteState;
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const [err, setErr] = useState(null);
  const [voice, setVoice] = useState(null);
  const [spell, setSpell] = useState(null);
  const [proofing, setProofing] = useState(false);
  const auto = useRef(false);

  /* Draft on arrival. A blank page every morning defeats the purpose, and
     nothing is committed until a section is accepted. */
  useEffect(() => {
    if (auto.current || s.prose?.summary || note.themes.length === 0) return;
    auto.current = true;
    draft();
    /* eslint-disable-next-line */
  }, []);

  /* composeNote re-runs only when something it actually computes from
     changes. Everything the analyst types is passthrough and is laid over
     the result afterwards.

     0.15.2 fixed the prose half of this and left the settings half: title,
     subtitle, the two windows and the sector line stayed in the dependency
     list, so a keystroke in any of them still re-ran both orderings and the
     whole theme mapping. One run logged 38 recomposes in 33 seconds of
     typing a subtitle. */
  const model = useMemo(() => composeNote({ parsed, picks, menus, settings: s }),
                        [parsed, picks, menus]);
  const note = useMemo(() => ({
    ...model,
    meta: { ...model.meta, ...analystMeta(s, parsed) },
    prose: s.prose || { summary: "", themes: {}, execution: "" },
  }), [model, parsed, s.title, s.subtitle, s.executeWindow, s.holdWindow, s.sector, s.prose]);

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

  /* Native spellcheck marks a word only while its field is focused, and it
     never reaches the printed page — "Draaaining" printed clean through a
     field that had spellCheck set. So the note gets a proof pass of its own.
     It returns findings, never prose: the model points at a word, it does
     not get to rewrite a sentence, round a number or soften a view. */
  const SETTING_KEYS = { title: "Title", subtitle: "Subtitle", executeWindow: "Execute",
                         holdWindow: "Hold", sector: "Sector line" };

  /* The prompt tells the model to leave these alone; this is the check that
     it did, in the same spirit as vocabulary enforcement on the extractor.
     "Realised" is house style and a suggestion to Americanise it should never
     reach the screen, where one click would apply it. */
  const HOUSE_WORD = /^(realis(e|ed|es|ing|ation))$/i;
  const TICKERISH  = /^[A-Z][A-Z0-9]{1,5}$/;

  function proofSections() {
    const out = {};
    for (const k of Object.keys(SETTING_KEYS)) if (s[k]?.trim()) out[k] = s[k];
    if (s.prose?.summary) out.summary = s.prose.summary;
    if (s.prose?.execution) out.execution = s.prose.execution;
    for (const th of note.themes) {
      const v = s.prose?.themes?.[th.id];
      if (v?.trim()) out[th.id] = v;
    }
    return out;
  }

  async function proof() {
    setProofing(true); setErr(null); setSpell(null);
    const sections = proofSections();
    const t = RunLog.timer("llm", "spell", { sections: Object.keys(sections).length });
    try {
      const res = await api.thinkLong("spell", JSON.stringify(sections), {},
        (status, polls, secs) => setPhase(`proofing · ${secs}s`));
      const raw = res?.parsed;
      if (!Array.isArray(raw)) throw new Error(res?.parseError || "proof returned no list");

      /* A finding whose word is not in the section verbatim cannot be applied
         safely, so it is dropped rather than shown. The model is told to copy
         exactly; this is the check that it did. */
      const found = [], rejected = [], blocked = [];
      raw.forEach((f, i) => {
        const body = sections[f?.section];
        if (!body || !f.wrong || !f.suggest || !body.includes(f.wrong)) { rejected.push(`${f?.section}:${f?.wrong}`); return; }
        if (HOUSE_WORD.test(f.wrong) || TICKERISH.test(f.wrong)) { blocked.push(`${f.section}:${f.wrong}`); return; }
        found.push({ ...f, key: `${f.section}:${f.wrong}:${i}` });
      });
      if (rejected.length) RunLog.warn("llm", "spell.unmatched", { rejected });
      if (blocked.length) RunLog.warn("llm", "spell.house.blocked", { blocked });
      RunLog.info("ui", "spell.result", { found: found.length, rejected: rejected.length, blocked: blocked.length });
      setSpell({ found, checked: Object.keys(sections).length });
      t.end({ found: found.length, rejected: rejected.length, model: res.model });
    } catch (e) { t.fail(e); setErr(e.message); }
    setProofing(false); setPhase(null);
  }

  /* Replace every occurrence in the one section it was found in. Settings and
     prose live in different places in state, so the write is routed. */
  function applyFix(f) {
    const swap = str => str.split(f.wrong).join(f.suggest);
    if (SETTING_KEYS[f.section]) set(f.section, swap(s[f.section] || ""));
    else if (f.section === "summary" || f.section === "execution") setProse(f.section, swap(s.prose?.[f.section] || ""));
    else setProse(f.section, swap(s.prose?.themes?.[f.section] || ""));
    setSpell(prev => prev && { ...prev, found: prev.found.filter(x => x.key !== f.key) });
    RunLog.info("ui", "spell.applied", { section: f.section, wrong: f.wrong, suggest: f.suggest });
  }

  const dismissFix = f => {
    setSpell(prev => prev && { ...prev, found: prev.found.filter(x => x.key !== f.key) });
    RunLog.info("ui", "spell.dismissed", { section: f.section, wrong: f.wrong });
  };

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

        {spell && (
          <div className={spell.found.length ? "note" : "ok-banner"} style={{ marginTop: 12 }}>
            {spell.found.length === 0
              ? <><b>Proofread clean.</b> {spell.checked} sections checked, nothing flagged.</>
              : <>
                  <b>{spell.found.length} spelling {spell.found.length === 1 ? "item" : "items"}</b> across {spell.checked} sections.
                  Tickers, options vocabulary and the house "realised" are excluded.
                  <ul className="spellfix">
                    {spell.found.map(f => (
                      <li key={f.key}>
                        <code>{SETTING_KEYS[f.section] || note.themes.find(t => t.id === f.section)?.subject || f.section}</code>
                        <s>{f.wrong}</s> → <b>{f.suggest}</b>
                        {f.note ? <em> {f.note}</em> : null}
                        <button className="ghost" onClick={() => applyFix(f)}>replace</button>
                        <button className="ghost" onClick={() => dismissFix(f)}>keep</button>
                      </li>
                    ))}
                  </ul>
                </>}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={busy || proofing || note.themes.length === 0} onClick={draft}>
            {busy ? <><span className="spin" />&nbsp; {phase || "Sending…"}</> : hasProse ? "Re-draft with Opus" : "Draft with Opus"}
          </button>
          <button className="ghost" disabled={busy || proofing || !hasProse} onClick={proof}
                  title="Spelling and typos only — tickers, options vocabulary and the house 'realised' are left alone. Nothing is changed until you click replace.">
            {proofing ? <><span className="spin" />&nbsp; {phase || "Proofing…"}</> : "Proofread"}
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
        {busy && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Opus drafts in 1–2 minutes. Proofreading takes under 10 seconds.</div>}
        {s.partial && <div className="note" style={{ marginTop: 10 }}>
          The draft was cut short — <b>{s.partial.join(" and ")}</b> {s.partial.length > 1 ? "are" : "is"} empty.
          Re-draft, or write {s.partial.length > 1 ? "them" : "it"} yourself.
        </div>}
      </div>

      <NoteView note={note} onProse={setProse} accepted={s.accepted || {}} onAccept={accept} />
    </>
  );
}
