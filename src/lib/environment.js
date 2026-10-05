/* ═══════════════════════════════════════════════════════════════════
   environment.js — what the note may say about entering an idea.

   From 0.38.0 the note is market commentary in substance as well as in
   label. It gives the SEED of an idea, the INSTRUMENTS that could express
   it, and FACTS ABOUT THE ENVIRONMENT the reader would want before deciding
   how to act. It gives no entry, no stop, no size, no holding period and no
   schedule: execution and management are the client's.

   The ladder, the weighted entry and the stop still exist — the ranking is
   built on them and the ledger records them — but none of it prints. This
   file is the whole of what replaces them on the page.

   Everything here is a description of the market as it stands: where the
   open-interest walls sit, how far away they are, how much the vehicle
   moves in a day, where it is in its recent range, and what the option
   market is charging relative to what the tape has delivered. Nothing is a
   forecast and nothing is an instruction.
   ═══════════════════════════════════════════════════════════════════ */

/* Inside this distance the wall is "nearby" and the sentence is about the
   level; beyond it the sentence is about scaling in. It was 2% while the
   tool was nominating an entry, where "near" meant "no room to ladder".
   It is 7% now because nothing is being nominated: the question is only
   whether the wall is close enough to be the relevant fact. */
export const NEAR_WALL_PCT = 7;

/* The range printed is ONE CALENDAR MONTH, stated as such. It used to be
   "over the holding period", which stopped meaning anything once the note
   stopped naming one. Deliberately not the ranking horizon. */
export const RANGE_DAYS = 30;

const r1 = x => x == null || !isFinite(x) ? null : +x.toFixed(1);
const r2 = x => x == null || !isFinite(x) ? null : +x.toFixed(2);

/* THE WALL THAT FRAMES THE ENTRY.
   A buyer cares about support beneath: the put wall. A seller cares about
   resistance overhead: the call wall. vol.js guarantees the put wall is
   below spot and the call wall above, and this re-checks rather than
   trusts, because a wall on the wrong side would print "support 3% lower"
   about a level that is higher. */
export function wallContext(spot, vol, direction) {
  const bull = String(direction).toLowerCase() === "bullish";
  const wall = bull ? vol?.putWall : vol?.callWall;
  const valid = spot > 0 && wall != null && (bull ? wall < spot : wall > spot);
  /* Two different absences. No chain at all is a statement about the
     vehicle; a chain with nothing concentrated on the side that matters is
     a statement about positioning. Saying "no listed-options market" of a
     fund that has one would simply be false. */
  if (!valid) return { none: true, side: bull ? "put" : "call", role: bull ? "support" : "resistance",
                       hasChain: vol?.iv30 != null || vol?.putWall != null || vol?.callWall != null };
  const distancePct = r1(Math.abs(wall - spot) / spot * 100);
  const ladder = (bull ? vol.putWalls : vol.callWalls) || [];
  const next = ladder.find(w => w.strike !== wall && (bull ? w.strike < wall : w.strike > wall));
  return {
    side: bull ? "put" : "call",
    role: bull ? "support" : "resistance",
    rel: bull ? "lower" : "higher",
    level: wall, distancePct,
    proximity: distancePct <= NEAR_WALL_PCT ? "nearby" : "away",
    openInterest: (bull ? vol.putWallOI : vol.callWallOI) || null,
    /* The next concentration beyond the wall — where the structure is if
       the first level gives way. A fact about the chain, not a stop. */
    nextLevel: next?.strike ?? null,
  };
}

/* The exact sentence the note carries. Built here as well as asked of the
   drafter so the guard has something to compare against and the rail can
   print it without waiting on a draft. */
export function wallSentence(tk, w) {
  if (!w) return null;
  if (w.none) return w.hasChain
    ? `${tk} shows no concentration of ${w.side} open interest ${w.side === "put" ? "below" : "above"} the last price, so there is no ${w.side}-wall ${w.role} to frame an entry against.`
    : `${tk} has no listed-options market deep enough to show open-interest walls, so there is no wall to frame an entry against.`;
  const name = `${w.side}-wall ${w.role}`;
  return w.proximity === "nearby"
    ? `Investors looking to trade the idea have ${name} nearby at ${w.level}.`
    : `With ${name} ${w.distancePct}% ${w.rel}, investors looking to trade the idea may prefer to scale in opportunistically.`;
}

/* FACTS FOR FRAMING AN EXECUTION — the reader's, not ours.
   `closes` is daily closes, oldest first; roughly four months are fetched. */
export function environment({ spot, vol, closes = [] }) {
  const px = (closes || []).filter(c => typeof c === "number" && c > 0);
  const iv = vol?.iv30 ?? null, rv = vol?.rv30 ?? null;
  const basisVol = iv ?? rv;
  const sd = basisVol != null ? (basisVol / 100) * Math.sqrt(RANGE_DAYS / 365) : null;

  /* Average daily move: mean absolute close-to-close change over the last
     20 sessions. Closes only — the tool does not hold highs and lows — so
     this understates the intraday range and is labelled as what it is. */
  const last21 = px.slice(-21);
  const moves = last21.slice(1).map((c, i) => Math.abs(c / last21[i] - 1) * 100);
  const avgDailyMovePct = moves.length >= 10 ? r2(moves.reduce((s, x) => s + x, 0) / moves.length) : null;

  /* Where spot sits in the range of closes held. Spot is included so a
     fresh high or low reads 100 or 0 rather than something outside it. */
  const win = px.slice(-63);
  const lo = win.length >= 20 ? Math.min(...win, spot) : null;
  const hi = win.length >= 20 ? Math.max(...win, spot) : null;
  const ma50 = px.length >= 50 ? px.slice(-50).reduce((s, x) => s + x, 0) / 50 : null;

  const dPut = vol?.putWall != null && vol.putWall < spot ? (vol.putWall - spot) / spot * 100 : null;
  const dCall = vol?.callWall != null && vol.callWall > spot ? (vol.callWall - spot) / spot * 100 : null;

  return {
    rangeDays: RANGE_DAYS,
    rangeBasis: iv != null ? "implied" : rv != null ? "realised" : null,
    rangeWindow: iv != null ? null : (vol?.rvWindow ?? 30),
    rangeLo: sd ? spot * (1 - sd) : null,
    rangeHi: sd ? spot * (1 + sd) : null,
    rangePct: sd ? r1(sd * 100) : null,
    putWallDistPct: r1(dPut), callWallDistPct: r1(dCall),
    /* The same distances in units of the one-month range: 0.5 means the
       wall is half a normal month's move away. */
    putWallDistSd: sd && dPut != null ? r1(Math.abs(dPut) / (sd * 100)) : null,
    callWallDistSd: sd && dCall != null ? r1(Math.abs(dCall) / (sd * 100)) : null,
    iv30: iv, rv30: rv,
    /* Implied over realised. Above 1 the option market is charging more
       than the tape has delivered; below 1, less. */
    ivOverRv: iv != null && rv ? r2(iv / rv) : null,
    avgDailyMovePct,
    rangeSessions: win.length >= 20 ? win.length : null,
    closeLo: r2(lo), closeHi: r2(hi),
    rangePosition: lo != null && hi > lo ? Math.round((spot - lo) / (hi - lo) * 100) : null,
    ma50: r2(ma50),
    vsMa50Pct: ma50 ? r1((spot / ma50 - 1) * 100) : null,
  };
}
