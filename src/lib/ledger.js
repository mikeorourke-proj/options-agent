/* ═══════════════════════════════════════════════════════════════════
   ledger.js — what the idea history records, and why each field is in it.

   Every field below exists to answer a specific question that has come up
   in design and could not be settled. Nothing is here for completeness.

     spot, band, weighted entry     did the ladder FILL? the single
                                    assumption the tool takes for free
     stop + provenance              did price stall at the wall, or go
                                    through it? the question about whether
                                    walls resist at all
     pStopped                       is the barrier model CALIBRATED? legs
                                    marked 25% should stop out a quarter of
                                    the time
     expectancy + raw + confidence  does the chain-quality shrink help or
                                    hurt the ordering?
     purity, conviction             do the two drift multipliers earn their
                                    place?
     score + parts                  do the six weights order legs better
                                    than EV/risk alone would?
     iv30, rv30, walls              enough to REPLAY the scoring from
                                    stored inputs, so an old note can be
                                    re-scored under new code

   Internal only. Nothing here appears in a published note.
   ═══════════════════════════════════════════════════════════════════ */
import RunLog from "./runlog.js";

const API = "/api/ledger";

/* A stable key per note: date plus a slug of the title. Printing the same
   note twice REPLACES its entry rather than creating a near-duplicate, which
   matters because a note is usually printed two or three times while the
   prose is being edited. */
export function ledgerKey(note) {
  const d = (note?.meta?.date || new Date().toISOString().slice(0, 10)).replace(/[^0-9]/g, "").slice(0, 8);
  const slug = (note?.meta?.title || "note").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${d}-${slug}`;
}

/* Flatten the composed note into the record. Reads only what is already on
   the model — no recomputation, so the ledger cannot disagree with what was
   printed. */
export function buildRecord(note, { version } = {}) {
  const legs = (note?.themes || []).filter(t => t.etf?.tk).map(t => {
    const sh = t.etf.share, plan = t.etf.plan, tgt = t.etf.tgt;
    return {
      ticker: t.etf.tk, subject: t.subject, direction: t.direction,
      conviction: t.conviction || "medium",

      // execution — the fill-rate question
      spot: plan?.spot ?? null, execution: plan?.execution ?? null,
      rungs: (plan?.rungs || []).map(r => +Number(r.px).toFixed(4)),
      weightedEntry: plan?.entry ?? null,
      bandPct: plan?.bandPct ?? null,
      entryImprovementPct: plan?.entryImprovementPct ?? null,

      // levels — the wall-resistance question
      stop: plan?.stop ?? null, stopMode: plan?.mode ?? null,
      wall: plan?.wall ?? null, wallFrom: plan?.wallFrom ?? null,
      callWall: t.vol?.callWall ?? null, putWall: t.vol?.putWall ?? null,
      structural: tgt?.struct ?? null, structuralFrom: tgt?.structFrom ?? null,

      // scoring — the calibration questions
      score: sh?.score ?? null, expectancy: sh?.expectancy ?? null,
      expectancyRaw: sh?.expectancyRaw ?? null, evOnRisk: sh?.evOnRisk ?? null,
      pop: sh?.pop ?? null, pStopped: sh?.pStopped ?? null,
      riskPct: sh?.riskPct ?? null, riskSigma: sh?.riskSigma ?? null,
      purity: sh?.purity ?? null, purityFrom: sh?.purityFrom ?? null,
      confidence: sh?.confidence ?? null,
      parts: sh?.parts ?? null,

      // inputs — enough to replay under new code
      iv30: t.vol?.iv30 ?? null, rv30: t.vol?.rv30 ?? null,
      rr25: t.vol?.rr25 ?? null, sdPct: sh?.sdPct ?? null,

      options: (t.options || []).map(o => ({
        name: o.name, expiry: o.expiry, legs: o.legText,
        net: o.pricing?.net ?? null, risk: o.pricing?.risk ?? null,
        ev: o.econ?.ev ?? null, evRaw: o.econ?.evRaw ?? null,
        pop: o.econ?.pop ?? null, score: o.econ?.score ?? null,
      })),
    };
  });

  return {
    printedAt: new Date().toISOString(), version: version || null,
    title: note?.meta?.title || "Tactical Note", date: note?.meta?.date || null,
    holdWindow: note?.meta?.holdWindow ?? null,
    executeWindow: note?.meta?.executeWindow ?? null,
    correlation: note?.correlation
      ? { basket: note.correlation.basket, cluster: note.correlation.cluster,
          hedges: note.correlation.hedges, outliers: note.correlation.outliers,
          independentRiskPct: note.correlation.independentRiskPct,
          correlatedRiskPct: note.correlation.correlatedRiskPct }
      : null,
    excluded: note?.weakLegs || [],
    legs,
  };
}

export async function record(note, { version } = {}) {
  const key = ledgerKey(note);
  try {
    const res = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, note: buildRecord(note, { version }) }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const out = await res.json();
    RunLog.info("ui", "ledger.recorded", { key, entries: out.count });
    return out;
  } catch (e) {
    /* A ledger failure must never block a print. The note is the product;
       this is diagnostics. */
    RunLog.warn("ui", "ledger.failed", { key, error: String(e?.message || e) });
    return null;
  }
}

export async function listEntries() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()).entries || [];
}

export async function readEntry(key) {
  const res = await fetch(`${API}?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function removeEntry(key) {
  const res = await fetch(`${API}?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/* One row per LEG, which is the unit the monthly review works in — replay
   asks what happened to a position, not to a note. */
export function toCsv(records) {
  const cols = ["printedAt", "date", "title", "version", "ticker", "subject", "direction",
    "conviction", "spot", "execution", "weightedEntry", "entryImprovementPct", "bandPct",
    "stop", "stopMode", "wall", "wallFrom", "callWall", "putWall",
    "score", "expectancy", "expectancyRaw", "evOnRisk", "pop", "pStopped",
    "riskPct", "riskSigma", "purity", "confidence", "iv30", "rv30", "rr25", "sdPct"];
  const esc = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = [cols.join(",")];
  for (const r of records)
    for (const l of r.legs || [])
      rows.push(cols.map(c => esc(c in l ? l[c] : r[c])).join(","));
  return rows.join("\n");
}
