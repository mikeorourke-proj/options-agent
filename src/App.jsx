import { useEffect, useState } from "react";
import RunLog from "./lib/runlog.js";
import StepThesis from "./steps/StepThesis.jsx";
import StepVehicles from "./steps/StepVehicles.jsx";
import "./styles/app.css";

const STEPS = [
  { id: "thesis",    label: "Idea" },
  { id: "vehicles",  label: "Vehicles" },
  { id: "structure", label: "Structure" },
  { id: "scenarios", label: "Scenarios" },
  { id: "note",      label: "Note" },
];

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="a">Jones</span><span className="b">Trad</span>
      <span className="b">i</span><span className="mark" /><span className="b">ng</span>
    </span>
  );
}

/* Floating diagnostic bar. Present from build one so any bug report
   arrives with the full trace attached. */
function LogBar() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 1200); return () => clearInterval(i); }, []);
  const es = RunLog.entries;
  const errs = es.filter(e => e.lvl === "error").length;
  const warns = es.filter(e => e.lvl === "warn").length;
  const cls = errs ? "err" : warns ? "warn" : "";
  return (
    <div className="logbar" data-tick={tick}>
      <span className={`dot ${cls}`} />
      <code>{es.length} events{errs ? ` · ${errs} err` : ""}{warns ? ` · ${warns} warn` : ""}</code>
      <button className="ghost" style={{ padding: "3px 9px" }} onClick={() => RunLog.download()}>Download log</button>
      <button className="ghost" style={{ padding: "3px 9px" }}
              onClick={async () => alert(await RunLog.copy())}>Copy</button>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState(null);
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => { RunLog.start("session", { app: "tactical-note", v: "0.1.0" }); }, []);

  const reach = i =>
    i === 0 ? true :
    i === 1 ? Boolean(intent) :
    i === 2 ? vehicles.length > 0 : false;

  return (
    <div className="app">
      <div className="topbar">
        <Wordmark />
        <span className="title">Tactical Note — Desk Commentary</span>
        <span className="spacer" />
        <a className="ghost" href="/legacy.html" style={{ textDecoration: "none", padding: "6px 12px" }}>
          Options dashboard
        </a>
      </div>

      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s.id}
                  className={`step-tab ${i === step ? "active" : ""} ${i < step && reach(i) ? "done" : ""}`}
                  disabled={!reach(i)}
                  onClick={() => reach(i) && setStep(i)}>
            <span className="n">{i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      <div className="main">
        {step === 0 && <StepThesis intent={intent} setIntent={setIntent} onNext={() => setStep(1)} />}
        {step === 1 && intent &&
          <StepVehicles intent={intent} vehicles={vehicles} setVehicles={setVehicles} onNext={() => setStep(2)} />}
        {step >= 2 && (
          <div className="card">
            <h2>{STEPS[step].label}</h2>
            <p className="hint">Next build. Selection so far is carried in state and in the run log.</p>
            <pre style={{ fontSize: 11.5, background: "var(--bg)", padding: 12, borderRadius: 6, overflow: "auto" }}>
{JSON.stringify({ intent: intent && { headline: intent.headline, direction: intent.direction, tags: intent.tags, catalyst: intent.catalyst }, vehicles }, null, 2)}
            </pre>
            <button className="ghost" onClick={() => setStep(1)}>← Back</button>
          </div>
        )}
      </div>

      <LogBar />
    </div>
  );
}
