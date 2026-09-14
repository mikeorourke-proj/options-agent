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
import { CASES } from "./fixtures.mjs";

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
speak();

const r = (n, d = 3) => n == null || Number.isNaN(n) ? null : +Number(n).toFixed(d);

function score(c) {
  hush();
  try {
    const [ew, ewFrom] = entryWall(c.spot, c.vol, c.direction);
    const [xw, xwFrom] = exitWall(c.spot, c.vol, c.direction);
    const plan = scalePlan(c.spot, c.vol, c.direction,
                           { execution: c.execution, mode: c.stopMode });
    const tgt = targets(c.spot, c.vol, c.direction, c.horizonDays);
    const sh = plan && tgt?.struct
      ? scoreShares(plan, tgt, c.vol, { direction: c.direction, conviction: c.conviction,
                                        liq: c.liq, horizonDays: c.horizonDays })
      : null;
    return {
      entryWall: ew, entryWallFrom: ewFrom, exitWall: xw, exitWallFrom: xwFrom,
      execution: plan?.execution ?? null, noWall: plan?.noWall ?? false,
      planEntry: r(plan?.entry, 4), stop: r(plan?.stop, 4),
      rungs: plan?.rungs?.length ?? 0,
      target: r(tgt?.struct, 4), targetFrom: tgt?.structFrom ?? null,
      volFrom: tgt?.volFrom ?? null, range: [r(tgt?.dn, 2), r(tgt?.up, 2)],
      score: r(sh?.score), expectancy: r(sh?.expectancy, 2), evOnRisk: r(sh?.evOnRisk),
      pop: r(sh?.pop, 1), pTarget: r(sh?.pTarget, 1), pStop: r(sh?.pStop, 1),
      rewardPct: r(sh?.rewardPct, 2), riskPct: r(sh?.riskPct, 2), rr: r(sh?.rr),
      rewardSigma: r(sh?.rewardSigma), riskSigma: r(sh?.riskSigma),
      parts: sh?.parts ? Object.fromEntries(Object.entries(sh.parts).map(([k, v]) => [k, r(v)])) : null,
    };
  } catch (e) {
    return { ERROR: e.message };
  } finally { speak(); }
}

const now = Object.fromEntries(CASES.map(c => [c.id, score(c)]));

if (RECORD || !existsSync(SNAP)) {
  writeFileSync(SNAP, JSON.stringify(now, null, 1) + "\n");
  console.log(`recorded ${CASES.length} cases -> test/snapshot.json`);
  const broken = Object.entries(now).filter(([, v]) => v.ERROR || v.score == null);
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
  console.log(`${CASES.length} cases, nothing moved.`);
  process.exit(0);
}
console.log(`${moved} case(s) changed, ${added} added:\n`);
console.log(lines.join("\n"));
console.log(`\nIf every change above is intended, re-record:  node test/run.mjs --record`);
process.exit(1);
