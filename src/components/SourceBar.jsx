import RunLog from "../lib/runlog.js";

/* Persistent header: what was parsed, and what is currently selected. */
export default function SourceBar({ parsed, picks, onEdit }) {
  if (!parsed) return null;
  const chosen = Object.values(picks?.sel || {});
  const byTheme = {};
  for (const c of chosen) (byTheme[c.themeId] ||= []).push(c);

  return (
    <div className="intentbar">
      <div className="ib-main">
        <span className="ib-head">{parsed.sourceTitle || "Source"}</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {parsed.themes?.length} theme{parsed.themes?.length === 1 ? "" : "s"}
        </span>
        {parsed.analystNote && <span className="pill b" title={parsed.analystNote}>your read attached</span>}

        <span className="ib-veh">
          {parsed.themes?.filter(t => byTheme[t.id]).map(t => (
            <span key={t.id} className={`ib-tk ${t.direction === "bearish" ? "sh" : ""}`}>
              {t.direction === "bearish" ? "\u25BC" : "\u25B2"} {t.subject}
              <span style={{ opacity: .6, marginLeft: 4 }}>{byTheme[t.id].length}</span>
            </span>
          ))}
        </span>

        <span className="spacer" />
        {parsed.model && <code style={{ fontSize: 10.5, color: "var(--muted)" }}>{parsed.model}</code>}
        <button className="ib-btn" onClick={onEdit}>edit source</button>
      </div>
    </div>
  );
}
