import { useEffect, useState } from "react";
import RunLog from "./lib/runlog.js";
import { clearCache } from "./lib/api.js";
import StepSource from "./steps/StepSource.jsx";
import StepIdeas from "./steps/StepIdeas.jsx";
import SourceBar from "./components/SourceBar.jsx";
import "./styles/app.css";

export const VERSION = "0.8.1";

const STEPS = [
  { id: "source",    label: "Source" },
  { id: "ideas",     label: "Themes" },
  { id: "structure", label: "Structure" },
  { id: "scenarios", label: "Scenarios" },
  { id: "note",      label: "Note" },
];

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="a">Jones</span><span className="b">Trad</span>
      {/* dotless i, with the square mark absolutely placed above it so it
          takes no horizontal space and cannot push "ng" sideways */}
      <span className="dot-i"><span className="b">{"\u0131"}</span><i className="mark" /></span>
      <span className="b">ng</span>
    </span>
  );
}

function LogBar() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 1200); return () => clearInterval(i); }, []);
  const es = RunLog.entries;
  const errs = es.filter(e => e.lvl === "error").length;
  const warns = es.filter(e => e.lvl === "warn").length;
  return (
    <div className="logbar" data-tick={tick}>
      <span className={`dot ${errs ? "err" : warns ? "warn" : ""}`} />
      <code>{es.length} events{errs ? ` · ${errs} err` : ""}{warns ? ` · ${warns} warn` : ""}</code>
      <button className="ghost" style={{ padding: "3px 9px" }} onClick={() => RunLog.download()}>Download log</button>
      <button className="ghost" style={{ padding: "3px 9px" }} onClick={async () => alert(await RunLog.copy())}>Copy</button>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState(null);
  const [picks, setPicks] = useState({ sel: {}, primaryThemeId: null, split: [] });
  const [menuCache, setMenuCache] = useState(null);

  useEffect(() => { RunLog.start("session", { app: "tactical-note", v: VERSION }); }, []);

  function applyParsed(next) {
    clearCache();
    setParsed(next);
    setPicks({ sel: {}, primaryThemeId: next?.primaryThemeId || null, split: [] });
    setMenuCache(null);
  }

  const reach = i => i === 0 ? true
                   : i === 1 ? Boolean(parsed)
                   : i === 2 ? Object.keys(picks.sel).length > 0 : false;

  return (
    <div className="app">
      <div className="topbar">
        <Wordmark />
        <span className="title">Tactical Note — Desk Commentary</span>
        <code className="ver" title="hard-refresh if this looks stale">v{VERSION}</code>
        <span className="spacer" />
        <a className="ghost" href="/legacy.html" style={{ textDecoration: "none", padding: "6px 12px" }}>Options dashboard</a>
      </div>

      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s.id} className={`step-tab ${i === step ? "active" : ""} ${i < step && reach(i) ? "done" : ""}`}
                  disabled={!reach(i)} onClick={() => reach(i) && setStep(i)}>
            <span className="n">{i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      {step > 0 && parsed && <SourceBar parsed={parsed} picks={picks} onEdit={() => setStep(0)} />}

      <div className="main">
        {step === 0 && <StepSource parsed={parsed} setParsed={applyParsed} onNext={() => setStep(1)} />}
        {step === 1 && parsed &&
          <StepIdeas parsed={parsed} setParsed={setParsed} picks={picks} setPicks={setPicks}
                     menuCache={menuCache} setMenuCache={setMenuCache} onNext={() => setStep(2)} />}
        {step >= 2 && (
          <div className="card">
            <h2>{STEPS[step].label}</h2>
            <p className="hint">Next build. Selections are carried in state and in the run log.</p>
            <pre style={{ fontSize: 11.5, background: "var(--bg)", padding: 12, borderRadius: 6, overflow: "auto", maxHeight: 420 }}>
{JSON.stringify({ primaryThemeId: picks.primaryThemeId, split: picks.split, selections: Object.values(picks.sel) }, null, 2)}
            </pre>
            <button className="ghost" onClick={() => setStep(1)}>← Back</button>
          </div>
        )}
      </div>

      <LogBar />
    </div>
  );
}
