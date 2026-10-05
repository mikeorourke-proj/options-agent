/* ═══════════════════════════════════════════════════════════════════
   run.mjs — golden-master harness for the scoring core.

     node test/run.mjs            compare against the recorded snapshot
     node test/run.mjs --record   overwrite the snapshot with today's output

   It records what the code DOES, not what it should do. Several recorded
   values are known to be wrong; the harness exists so that when the
   redesign moves them, every movement is listed and has to be explained,
   instead of a regression hiding inside an improvement.

   Pure functions only — scalePlan, targets, scoreShares, entryWall,
   exitWall. No network, no chain fetch, no model call, so it is
   deterministic and runs in about a second.
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";


/* FREEZE THE CLOCK before anything is imported.

   priceStructure measures time to expiry against Date.now(), so an option
   fixture recorded at 09:00 and replayed at 17:00 prices a slightly shorter
   contract and every derived number drifts. Relative expiry dates do not fix
   that — they move the drift from days to hours. Pinning the clock makes the
   whole suite reproducible, and no production code has to know about it. */
const FROZEN = Date.parse("2026-09-15T16:00:00Z");
Date.now = () => FROZEN;

const NOW = new Date(FROZEN);

/* Imported DYNAMICALLY, after the freeze. A static import is hoisted and
   evaluated before any statement in this file runs, so fixtures.mjs would
   read the real clock for its expiry offsets while pricing.js read the
   frozen one — and the gap between them grows by a day every day. That is
   exactly what happened: prTdays moved 9.2 -> 10.2 overnight. */
const { CASES, CHAIN_CASES, EXPIRY_CASES, VOICE_CASES, VOICE_CTX, WALL_CASES, PROX_CASES, SKEW_CASES, ECON_CASES, CORR_CASES, CLAIM_CASES, COMPOSE_CASES } =
  await import("./fixtures.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = join(HERE, "snapshot.json");
const RECORD = process.argv.includes("--record");

/* The run log writes to console on every fact and gate. Useful in the
   browser, noise here — and it would bury the diff. */
const real = { log: console.log, warn: console.warn, error: console.error };
const hush = () => { console.log = console.warn = console.error = () => {}; };
const speak = () => Object.assign(console, real);

hush();
const { scalePlan, targets, scoreShares, entryWall, exitWall } =
  await import("../src/lib/shares.js");
const { analyzeChain, rankExpiries, ivAtDelta } = await import("../src/lib/vol.js");
const { buildLegs, priceStructure, scoreEconomics } = await import("../src/lib/pricing.js");
const { analyzeCorrelation, correlationNote } = await import("../src/lib/correlation.js");
const { composeNote, draftContext } = await import("../src/lib/compose.js");
const { wallContext, wallSentence, environment, consequentialWalls, orderByWallProximity } = await import("../src/lib/environment.js");
const { checkVoice, checkWallSentence, checkThemeOpening, checkSourcedClaims } =
  await import("../netlify/functions/_prompts.mjs");
speak();

const r = (n, d = 3) => n == null || Number.isNaN(n) ? null : +Number(n).toFixed(d);

function score(c) {
  hush();
  try {
    const [ew, ewFrom] = entryWall(c.spot, c.vol, c.direction);
    const [xw, xwFrom] = exitWall(c.spot, c.vol, c.direction);
    const plan = scalePlan(c.spot, c.vol, c.direction,
                           { execution: c.execution, mode: c.stopMode, horizonDays: c.horizonDays });
    const tgt = targets(c.spot, c.vol, c.direction, c.horizonDays);
    const sh = plan && tgt
      ? scoreShares(plan, tgt, c.vol, { direction: c.direction, conviction: c.conviction,
                                        liq: c.liq, horizonDays: c.horizonDays })
      : null;
    return {
      entryWall: ew, entryWallFrom: ewFrom, exitWall: xw, exitWallFrom: xwFrom,
      execution: plan?.execution ?? null, noWall: plan?.noWall ?? false,
      bandPct: plan?.bandPct ?? null, entryImprovementPct: r(plan?.entryImprovementPct, 2),
      planEntry: r(plan?.entry, 4), stop: r(plan?.stop, 4),
      rungs: plan?.rungs?.length ?? 0,
      target: r(tgt?.struct, 4), targetFrom: tgt?.structFrom ?? null,
      volFrom: tgt?.volFrom ?? null, range: [r(tgt?.dn, 2), r(tgt?.up, 2)],
      score: r(sh?.score), expectancy: r(sh?.expectancy, 2), evOnRisk: r(sh?.evOnRisk),
      pop: r(sh?.pop, 1), pStopped: r(sh?.pStopped, 1), purity: sh?.purity ?? null, confidence: sh?.confidence ?? null, expectancyRaw: r(sh?.expectancyRaw, 2),
      riskPct: r(sh?.riskPct, 2), riskSigma: r(sh?.riskSigma), rankedFrom: sh?.rankedFrom ?? null,
      parts: sh?.parts ? Object.fromEntries(Object.entries(sh.parts).map(([k, v]) => [k, r(v)])) : null,
    };
  } catch (e) {
    return { ERROR: e.message };
  } finally { speak(); }
}

function chain(c) {
  hush();
  try {
    const v = analyzeChain(c.id.split(".")[0], c.contracts, c.spot, NOW);
    return {
      callWall: v.callWall, putWall: v.putWall,
      callWallAboveSpot: v.callWall == null ? null : v.callWall > c.spot,
      putWallBelowSpot: v.putWall == null ? null : v.putWall < c.spot,
      collided: v.callWall != null && v.callWall === v.putWall,
      callLadder: (v.callWalls || []).map(w => w.strike),
      putLadder: (v.putWalls || []).map(w => w.strike),
      iv30: v.iv30, contracts: v.contracts, ok: v.ok,
      /* The walls the NOTE falls back to when the ranking has none. */
      display: v.display && { put: v.display.putWall, putOI: v.display.putWallOI, call: v.display.callWall,
                              callOI: v.display.callWallOI, n: v.display.contracts },
    };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function compose(c) {
  hush();
  try {
    const n = composeNote({ parsed: c.parsed, picks: c.picks, menus: c.menus, settings: c.settings });
    return {
      order: (n.etfOrder || []).map(r => `${r.label}:${r.immediate ? "immediate" : "scaled"}`),
      printed: (n.themes || []).map(t => t.etf?.tk),
      /* What the header lists and what the drafter is asked to write must be
         exactly what is printed — no more. */
      header: n.meta?.subjects, drafted: draftContext(n).themes.map(t => t.subject),
      excluded: (n.weakLegs || []).map(w => w.tk),
      /* The invariant the QC pass found broken in the UI: anything gated out
         must be REPORTED, never merely absent. Every selected leg is either
         in the order or in weakLegs. */
      /* 0.38.0 — WHAT THE DRAFTER IS GIVEN IS WHAT IT WRITES. The model sent
         to the drafter must contain the wall sentence and environment facts
         and NOTHING of the plan: no entry, scale band, weighted average,
         stop, risk figure or window. Checked on the JSON itself, with the
         sanctioned wall sentence removed first ("scale in", "an entry"). */
      wallSentences: (n.themes || []).flatMap(t => (t.legs || []).map(l => `${l.tk}: ${l.wallSentence}`)),
      /* Every fund ticked, in print order, and the sentence that names them. */
      funds: (n.themes || []).map(t => (t.legs || []).map(l => `${l.tk}${l.primary ? "" : "*"}:${l.liq}`).join(",")),
      expression: (n.themes || []).map(t => t.expressionSentence),
      drafterFunds: draftContext(n).themes.map(t => (t.etfs || []).map(e => e.ticker).join(",")),
      /* The theme's lead fund (ordering, gate, ledger) must NOT follow the
         print order, and an option names the fund it is written on. */
      leadFund: (n.themes || []).map(t => t.etf?.tk),
      drafterOptions: draftContext(n).themes.flatMap(t => t.options.map(o =>
        `${o.expiry} ${o.underlying} ${o.strikes ?? o.legs} ${o.structure} ${o.net} / ${o.maxLoss} / ${o.maxGain}`)),
      drafterEtfKeys: Object.keys(draftContext(n).themes[0]?.etf || {}).sort(),
      drafterLeaks: (JSON.stringify(draftContext(n), (k, v) => k === "wallSentence" || k === "risks" ? undefined : v)
        .match(/stop|riskPct|scaleTo|weighted|entry|executeWindow|holdWindow|"execution"|"pop"/gi) || []),
      nothingSilentlyDropped: c.menus.every(m =>
        (n.etfOrder || []).some(r => r.label === m.primary.t) ||
        (n.weakLegs || []).some(w => w.tk === m.primary.t)),
    };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function claim(c) {
  hush();
  try {
    const hits = (checkSourcedClaims({ summary: c.body }, c.source).summary || [])
      .map(h => h.phrase).sort();
    return { expect: c.expect, flagged: hits.length > 0, hits,
             correct: (hits.length > 0) === (c.expect === "flag") };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function corr(c) {
  hush();
  try {
    const a = analyzeCorrelation(c.legs);
    if (!a) return { view: null, sentence: null };
    return {
      basket: a.basket, meanTo: a.meanTo, cluster: a.cluster, outliers: a.outliers,
      hedges: a.hedges, directions: a.directions,
      sumRiskPct: a.sumRiskPct, independentRiskPct: a.independentRiskPct,
      correlatedRiskPct: a.correlatedRiskPct, amplification: a.amplification,
      /* The invariant the first build broke: a concentration warning must
         report MORE risk than the independent case, never less. */
      warnsUpward: a.correlatedRiskPct >= a.independentRiskPct,
      sentence: correlationNote(a),
    };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function econ(c) {
  hush();
  try {
    const legs = buildLegs(c.structure, c.contracts, c.expiry, c.spot, c.vol);
    if (!legs) return { ERROR: "buildLegs returned null" };
    const pr = priceStructure(legs, c.spot, c.expiry);
    if (!pr) return { ERROR: "priceStructure returned null" };
    const e = scoreEconomics(pr, legs, c.spot, c.vol, {
      direction: c.direction, conviction: c.conviction, rv: c.rv,
      horizonDays: c.horizonDays, catalystDate: c.catalystDate });
    return {
      /* prT is the clock the option is valued on; horizonDays is the clock
         the shares leg uses. They differ, and both feed one composite. */
      prTdays: +(pr.T * 365).toFixed(1), horizonDays: c.horizonDays,
      /* OBSERVED from scoreEconomics, not re-derived here. The first
         version of this check recomputed min(horizon, expiry) with the same
         formula the code uses, which made it a tautology that could never
         fail. Now a regression back to expiry-based valuation shows up as
         valuedAtDays jumping to the option's own life. */
      valuedAtDays: e.valuedAtDays, lifeLeftDays: e.lifeLeftDays,
      clocksAgree: Math.abs(e.valuedAtDays - Math.min(c.horizonDays, pr.T * 365)) < 0.15,
      net: +pr.net.toFixed(2), risk: +pr.risk.toFixed(2),
      maxGain: pr.uncapped ? "uncapped" : +pr.maxGain.toFixed(2),
      breakevens: pr.breakevens, legs: legs.length,
      carryDays: e.carryDays,
      evRaw: e.evRaw, confidence: e.confidence,
      ev: +e.ev.toFixed(3), evOnRisk: +e.evOnRisk.toFixed(4), pop: +e.pop.toFixed(1),
      score: +e.score.toFixed(3),
      parts: e.parts ? Object.fromEntries(Object.entries(e.parts).map(([k, x]) => [k, r(x)])) : null,
    };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function skew(c) {
  hush();
  try {
    const iv = ivAtDelta(c.quotes, c.target);
    const ivs = c.quotes.map(x => x.implied_volatility);
    return {
      iv: iv == null ? null : +(iv * 100).toFixed(2),
      /* The invariant: a reading may never fall outside the quotes it was
         built from. Extrapolation is exactly the failure that produced -37. */
      withinQuotedRange: iv == null ? null
        : iv >= Math.min(...ivs) - 1e-9 && iv <= Math.max(...ivs) + 1e-9,
      quotedRange: ivs.length ? [+(Math.min(...ivs) * 100).toFixed(2), +(Math.max(...ivs) * 100).toFixed(2)] : null,
    };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function expiry(c) {
  hush();
  try {
    const out = rankExpiries(Object.keys(c.oi), c.catalyst, c.horizon, 5,
                             NOW, c.oi);
    const deepest = Object.entries(c.oi).reduce((a, b) => b[1] > a[1] ? b : a)[0];
    return {
      candidates: out, oi: out.map(e => c.oi[e] ?? 0),
      includesDeepest: out.includes(deepest), deepest,
      thinnestOffered: out.length ? Math.min(...out.map(e => c.oi[e] ?? 0)) : null,
    };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function voice(c) {
  hush();
  try {
    /* Theme paragraphs carry the opening and wall checks; the summary is
       held to the voice rules alone. There is no execution section. */
    const isSummary = c.section === "summary";
    const paras = isSummary ? { summary: c.body } : { [c.subject]: c.body };
    const hits = (isSummary
      ? [...checkVoice(c.body)]
      : [...checkVoice(c.body),
         ...(checkWallSentence(paras, VOICE_CTX)[c.subject] || []),
         ...(checkThemeOpening(paras, VOICE_CTX)[c.subject] || [])]
    ).map(h => `${h.id}:${h.phrase}`).sort();
    return { expect: c.expect, flagged: hits.length > 0, hits,
             correct: (hits.length > 0) === (c.expect === "flag") };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function wall(c) {
  hush();
  try {
    /* Through consequentialWalls first, exactly as compose does it. */
    const v = consequentialWalls(c.vol);
    const w = wallContext(c.spot, v, c.direction);
    const e = environment({ spot: c.spot, vol: v, closes: c.closes });
    return { wall: w, sentence: wallSentence("TK", w), named: wallSentence("TK", w, { named: true }),
             env: { basis: e.rangeBasis, lo: r(e.rangeLo, 2), hi: r(e.rangeHi, 2), pct: e.rangePct,
                    dPut: e.putWallDistPct, dCall: e.callWallDistPct, sdPut: e.putWallDistSd, sdCall: e.callWallDistSd,
                    ivOverRv: e.ivOverRv, avgDay: e.avgDailyMovePct, closeLo: e.closeLo, closeHi: e.closeHi,
                    pos: e.rangePosition, ma50: e.ma50, vsMa50: e.vsMa50Pct } };
  } catch (e) { return { ERROR: e.message }; } finally { speak(); }
}

function prox(c) {
  try {
    const legs = c.legs.map(([tk, d]) => ({ tk, wall: d == null ? { none: true } : { distancePct: d } }));
    return { order: orderByWallProximity(legs).map(l => l.tk) };
  } catch (e) { return { ERROR: e.message }; }
}

const now = {
  ...Object.fromEntries(CASES.map(c => [c.id, score(c)])),
  ...Object.fromEntries(CHAIN_CASES.map(c => ["chain:" + c.id, chain(c)])),
  ...Object.fromEntries(EXPIRY_CASES.map(c => ["expiry:" + c.id, expiry(c)])),
  ...Object.fromEntries(VOICE_CASES.map(c => ["voice:" + c.id, voice(c)])),
  ...Object.fromEntries(WALL_CASES.map(c => ["wall:" + c.id, wall(c)])),
  ...Object.fromEntries(PROX_CASES.map(c => ["prox:" + c.id, prox(c)])),
  ...Object.fromEntries(SKEW_CASES.map(c => ["skew:" + c.id, skew(c)])),
  ...Object.fromEntries(ECON_CASES.map(c => ["econ:" + c.id, econ(c)])),
  ...Object.fromEntries(CORR_CASES.map(c => ["corr:" + c.id, corr(c)])),
  ...Object.fromEntries(CLAIM_CASES.map(c => ["claim:" + c.id, claim(c)])),
  ...Object.fromEntries(COMPOSE_CASES.map(c => ["compose:" + c.id, compose(c)])),
};

if (RECORD || !existsSync(SNAP)) {
  writeFileSync(SNAP, JSON.stringify(now, null, 1) + "\n");
  console.log(`recorded ${CASES.length + CHAIN_CASES.length + EXPIRY_CASES.length + VOICE_CASES.length + WALL_CASES.length + PROX_CASES.length + SKEW_CASES.length + ECON_CASES.length + CORR_CASES.length + CLAIM_CASES.length + COMPOSE_CASES.length} cases -> test/snapshot.json`);
  const broken = Object.entries(now).filter(([k, v]) => v.ERROR || (!k.startsWith("chain:") && !k.startsWith("expiry:") && !k.startsWith("voice:") && !k.startsWith("skew:") && !k.startsWith("econ:") && !k.startsWith("corr:") && !k.startsWith("claim:") && !k.startsWith("compose:") && v.score == null) || (k.startsWith("voice:") && v.correct === false) || (k.startsWith("skew:") && v.withinQuotedRange === false) || (k.startsWith("corr:") && v.warnsUpward === false) || (k.startsWith("claim:") && v.correct === false) || (k.startsWith("compose:") && v.nothingSilentlyDropped === false) || (k.startsWith("chain:") && !v.ok));
  if (broken.length) {
    console.log("\ncases producing no score (expected for some — check they are the ones you expect):");
    for (const [id, v] of broken) console.log("  " + id.padEnd(32) + (v.ERROR ? "THREW: " + v.ERROR : "no expectancy"));
  }
  process.exit(0);
}

const was = JSON.parse(readFileSync(SNAP, "utf8"));
let moved = 0, added = 0;
const lines = [];

for (const [id, cur] of Object.entries(now)) {
  const old = was[id];
  if (!old) { added++; lines.push(`  + ${id}  (new case, not in snapshot)`); continue; }
  const keys = [...new Set([...Object.keys(old), ...Object.keys(cur)])];
  const diffs = [];
  for (const k of keys) {
    const a = JSON.stringify(old[k]), b = JSON.stringify(cur[k]);
    if (a !== b) diffs.push(`      ${k}:  ${a}  ->  ${b}`);
  }
  if (diffs.length) { moved++; lines.push(`  ~ ${id}`, ...diffs); }
}
for (const id of Object.keys(was)) if (!(id in now)) lines.push(`  - ${id}  (case removed)`);

if (!lines.length) {
  console.log(`${CASES.length + CHAIN_CASES.length + EXPIRY_CASES.length + VOICE_CASES.length + WALL_CASES.length + PROX_CASES.length + SKEW_CASES.length + ECON_CASES.length + CORR_CASES.length + CLAIM_CASES.length + COMPOSE_CASES.length} cases, nothing moved.`);
  process.exit(0);
}
console.log(`${moved} case(s) changed, ${added} added:\n`);
console.log(lines.join("\n"));
console.log(`\nIf every change above is intended, re-record:  node test/run.mjs --record`);
process.exit(1);
