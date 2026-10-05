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

/* A WALL NEEDS WEIGHT. The "wall" is simply the strike with the most open
   interest on its side, so every chain has one — including a chain where the
   largest strike holds a few dozen contracts. That is not a level anyone is
   hedging against, and telling a reader they "have support" there would be
   inventing structure. Below this, the wall is treated as absent everywhere
   it would print: the sentence, the map and the table. */
export const MIN_WALL_OI = 1000;

/* The vol object as the NOTE may use it: walls too thin to matter removed,
   and a flag left behind so the sentence can say why there is none. Open
   interest that is simply unknown (older fixtures, a hand-built leg) is not
   treated as thin — only a figure that is present and small. */
export function consequentialWalls(vol) {
  if (!vol) return vol;
  /* Where the ranking's walls are absent — a chain too sparse for them —
     fall back to the display walls vol.js keeps for exactly this (0.39.2).
     A wall the ranking DID compute is never overridden: the page and the
     plan must agree wherever both exist. */
  const d = vol.display;
  let v = vol;
  if (d) {
    const add = {};
    if (vol.putWall == null && d.putWall != null) Object.assign(add, { putWall: d.putWall, putWallOI: d.putWallOI, putWalls: d.putWalls, putWallFrom: "open interest" });
    if (vol.callWall == null && d.callWall != null) Object.assign(add, { callWall: d.callWall, callWallOI: d.callWallOI, callWalls: d.callWalls, callWallFrom: "open interest" });
    if (Object.keys(add).length) v = { ...vol, ...add };
  }
  const thin = oi => typeof oi === "number" && oi > 0 && oi < MIN_WALL_OI;
  const tp = v.putWall != null && thin(v.putWallOI), tc = v.callWall != null && thin(v.callWallOI);
  if (!tp && !tc) return v;
  /* The size is kept so the page can say how thin, not just that it is. */
  return { ...v, ...(tp ? { putWall: null, thinPut: true, thinPutOI: v.putWallOI } : {}),
                 ...(tc ? { callWall: null, thinCall: true, thinCallOI: v.callWallOI } : {}) };
}

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
                       thin: Boolean(bull ? vol?.thinPut : vol?.thinCall),
                       thinOI: (bull ? vol?.thinPutOI : vol?.thinCallOI) ?? null,
                       hasChain: vol?.iv30 != null || vol?.putWall != null || vol?.callWall != null
                                 || Boolean(vol?.thinPut || vol?.thinCall) };
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
export function wallSentence(tk, w, { named = false } = {}) {
  if (!w) return null;
  if (w.none) return w.thin
    ? (w.thinOI
        ? `${tk}'s largest ${w.side} strike holds only ${Number(w.thinOI).toLocaleString("en-US")} contracts, too few for a wall to be meaningful, so there is no wall to frame an entry against.`
        : `${tk}'s option open interest is too thin for its ${w.side} wall to be meaningful, so there is no wall to frame an entry against.`)
    : w.hasChain
    ? `${tk} shows no concentration of ${w.side} open interest ${w.side === "put" ? "below" : "above"} the last price, so there is no ${w.side}-wall ${w.role} to frame an entry against.`
    : `${tk} has no listed-options market deep enough to show open-interest walls, so there is no wall to frame an entry against.`;
  const name = `${w.side}-wall ${w.role}`;
  /* `named` is for a theme carrying more than one ETF (0.39.0): each
     sentence has to say which fund it is about. Same wording otherwise. */
  if (named) return w.proximity === "nearby"
    ? `In ${tk}, investors looking to trade the idea have ${name} nearby at ${w.level}.`
    : `With ${name} ${w.distancePct}% ${w.rel} in ${tk}, investors looking to trade the idea may prefer to scale in opportunistically.`;
  return w.proximity === "nearby"
    ? `Investors looking to trade the idea have ${name} nearby at ${w.level}.`
    : `With ${name} ${w.distancePct}% ${w.rel}, investors looking to trade the idea may prefer to scale in opportunistically.`;
}

/* "One way to express the view is HYG." / "Ways to express the view include
   HYG and JNK." Built here so the drafter copies it and the guard can check
   every ticked fund is named. */
export function expressionSentence(tickers) {
  const t = (tickers || []).filter(Boolean);
  if (t.length <= 1) return `One way to express the view is ${t[0]}.`;
  return `Ways to express the view include ${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}.`;
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

/* THE FUND NEAREST ITS WALL IS LISTED FIRST (0.40.0).
   A seller wants resistance close overhead and a buyer wants support close
   beneath, so among several funds expressing one view the one sitting
   nearest the wall that matters is the more natural place to start: SOXX
   2.2% under its call wall against SMH 11% under its own, 5 Oct.
   The preference is expressed as ORDER and nothing else. The note may not
   call one fund "better" — that is ranking a security — so the order of the
   sentence and the table carries it, as the order of themes always has.
   Small differences are not a preference: funds within WALL_TIE_PCT of the
   group's nearest are tied and keep the order they came in (primary first),
   the same leader-and-band rule the theme ordering uses. A fund with no
   wall on the relevant side has nothing to be near and goes last. */
export const WALL_TIE_PCT = 2;
export function orderByWallProximity(legs) {
  const has = [], none = [];
  (legs || []).forEach((l, i) => (l.wall && !l.wall.none && l.wall.distancePct != null ? has : none).push({ l, i }));
  has.sort((a, b) => a.l.wall.distancePct - b.l.wall.distancePct || a.i - b.i);
  const out = [];
  for (let k = 0; k < has.length;) {
    const lead = has[k].l.wall.distancePct;
    let j = k;
    while (j < has.length && has[j].l.wall.distancePct - lead <= WALL_TIE_PCT) j++;
    out.push(...has.slice(k, j).sort((a, b) => a.i - b.i));
    k = j;
  }
  return [...out, ...none].map(x => x.l);
}
