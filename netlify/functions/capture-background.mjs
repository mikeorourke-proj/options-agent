import { getStore } from "@netlify/blobs";

// ─── 112-TICKER UNIVERSE (100 stocks + 12 ETFs) ───────────────────
const TICKERS = [
  "NVDA","GOOGL","AAPL","MSFT","AMZN","AVGO","TSLA","META","BRK.B","WMT",
  "LLY","MU","JPM","AMD","INTC","V","XOM","ORCL","JNJ","COST","MA","CAT",
  "CSCO","LRCX","CVX","NFLX","BAC","ABBV","AMAT","UNH","KO","PG","PLTR",
  "GE","HD","MS","GS","GEV","PM","MRK","TXN","QCOM","KLAC","RTX","LIN",
  "SNDK","WFC","C","AXP","IBM","TMUS","ADI","PEP","NEE","VZ","MCD","BA",
  "STX","DIS","GLW","AMGN","WDC","BLK","PANW","T","ANET","TMO","GILD",
  "TJX","ETN","APP","DELL","DE","SCHW","UNP","UBER","WELL","APH","BX",
  "ISRG","PFE","CRM","IBKR","ABT","VRT","COP","HON","CRWD","PLD","NEM",
  "SPGI","LOW","CB","BKNG","SBUX","LMT","DHR","CVS","PWR","PGR","MO","COF",
  "SPY","QQQ","IWM","DIA","XLF","XLK","XLE","XLV","XLI","XLP","RSP","XBI"
];

// ─── CONCURRENCY & RATE CONTROL ────────────────────────────────────
const BATCH_SIZE = 5;           // tickers processed concurrently per batch
const INTER_BATCH_DELAY = 1000; // 1s pause between batches
const MAX_RETRIES = 3;          // retry count for rate-limited / failed requests
const INITIAL_BACKOFF = 2000;   // ms backoff for first retry (doubles each time)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── FETCH WITH RETRY + BACKOFF ────────────────────────────────────
async function polyFetch(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });

      // Rate limited — back off and retry
      if (r.status === 429) {
        if (attempt < retries) {
          const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
          console.warn(`  429 rate-limited, backing off ${backoff}ms (attempt ${attempt + 1}/${retries})`);
          await sleep(backoff);
          continue;
        }
        console.error(`  429 rate-limited, exhausted retries`);
        return null;
      }

      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (attempt < retries) {
        const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function getQuote(ticker, apiKey) {
  // 1. Try stock snapshot first — gives current/15-min delayed price + volume
  const snap = await polyFetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`);
  if (snap && snap.ticker) {
    const s = snap.ticker;
    const price = s.lastTrade?.p || s.min?.c || s.day?.c || 0;
    const volume = s.day?.v || 0;
    const prevClose = s.prevDay?.c || 0;
    const changePerc = s.todaysChangePerc || 0;
    if (price > 0) return { results: [{ c: price, vw: s.day?.vw || price, v: volume, prevClose, changePerc }] };
  }

  // 2. Fallback: prev-day aggs (yesterday's close)
  const prev = await polyFetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`);
  if (prev && prev.results && prev.results.length > 0) return prev;

  // 3. Fallback: derive spot from options chain underlying asset
  const probe = await polyFetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?limit=1&apiKey=${apiKey}`);
  if (probe && probe.results && probe.results.length > 0) {
    const ud = probe.results[0].underlying_asset;
    if (ud && ud.price && ud.price > 0) return { results: [{ c: ud.price, vw: ud.price }] };
  }

  return null;
}

async function getChain(ticker, spot, apiKey) {
  // Tighter range for high-volume ETFs with $1 strike spacing
  const highVol = ["SPY","QQQ","IWM","DIA","SPX","NDX"].includes(ticker);
  const pct = highVol ? 0.07 : 0.15;
  const low = Math.round(spot * (1 - pct));
  const high = Math.round(spot * (1 + pct));
  const data = await polyFetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?limit=250&strike_price.gte=${low}&strike_price.lte=${high}&apiKey=${apiKey}`);
  if (!data || !data.results) return data;
  let nextUrl = data.next_url ? data.next_url + `&apiKey=${apiKey}` : null;
  let pages = 0;
  const maxPages = highVol ? 6 : 3;
  while (nextUrl && pages < maxPages) {
    await sleep(300);
    const nd = await polyFetch(nextUrl);
    if (!nd || !nd.results) break;
    data.results.push(...nd.results);
    nextUrl = nd.next_url ? nd.next_url + `&apiKey=${apiKey}` : null;
    pages++;
  }
  return data;
}

function computePositioning(ticker, spot, chainData) {
  const now = new Date();
  const result = {
    ticker, spot, capturedAt: now.toISOString(),
    netGex: 0, regime: "positive", gammaFlip: spot, flipDist: 0,
    callWall: spot * 1.02, putWall: spot * 0.98,
    callWallConf: 0, callWallOI: 0, putWallConf: 0, putWallOI: 0,
    maxPain: spot,
    dpc: 0, nds: 0, cdf: 0, pdf: 0,
    zdteVol: 0, zdtePct: 0, zdteDpc: 0, zdteNetDelta: 0, zdteCallFlow: 0, zdtePutFlow: 0,
    openVol: 0, openDpc: 0, openNetDelta: 0, openCallFlow: 0, openPutFlow: 0,
    optVolRaw: 0, optVolShares: 0, sweeps: [],
    skewZ: 0, termSlope: 1, iv: 0, sq: 0, dspct: 0,
    rr25d: 0, rr25dPutIV: 0, rr25dCallIV: 0,
    skew25d: 0, skew25dPutIV: 0, skew25dCallIV: 0,
    smileRatio: 0, skewCurve: "reverse", skewCurveLabel: "",
    nearTermSkew: 0, farTermSkew: 0, skewTermSpread: 0, zdteSkew: 0,
    ndf: 0, hvl: spot, pcp: 50,
    _live: false,
  };

  if (!chainData || !chainData.results || !chainData.results.length) return result;
  const contracts = chainData.results.filter(c => c.details && c.greeks && c.details.expiration_date && c.details.strike_price);
  if (contracts.length === 0) return result;

  // Near-term GEX (1-60 DTE) — includes this week's expiry for OPEX accuracy
  // Today's date at midnight for DTE calculation (avoids UTC midnight issues)
  const todayET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayMidnight = new Date(todayET.getFullYear(), todayET.getMonth(), todayET.getDate());

  const nearTerm = contracts.filter(c => {
    const [ey, em, ed] = c.details.expiration_date.split("-").map(Number);
    const expDate = new Date(ey, em - 1, ed);
    const dte = Math.round((expDate - todayMidnight) / 864e5);
    return dte >= 1 && dte <= 60;
  });

  let netGex = 0;
  const strikeGex = {}, strikeCallOI = {}, strikePutOI = {};

  nearTerm.forEach(c => {
    const isCall = c.details.contract_type === "call";
    const gamma = Math.abs(c.greeks.gamma || 0);
    const oi = c.open_interest || 0;
    const strike = c.details.strike_price;
    if (oi < 10) return;
    const contractGex = gamma * oi * 100 * spot * spot * 0.01;
    const signedGex = isCall ? contractGex : -contractGex;
    netGex += signedGex;
    if (!strikeGex[strike]) strikeGex[strike] = 0;
    strikeGex[strike] += signedGex;
    if (!strikeCallOI[strike]) strikeCallOI[strike] = 0;
    if (!strikePutOI[strike]) strikePutOI[strike] = 0;
    if (isCall) strikeCallOI[strike] += oi; else strikePutOI[strike] += oi;
  });

  const strikes = Object.keys(strikeGex).map(Number).sort((a, b) => a - b);

  if (strikes.length > 0) {
    result.netGex = netGex;
    result.regime = netGex > 0 ? "positive" : "negative";

    let cumGex = 0, flipStrike = spot, foundFlip = false;
    for (let i = 0; i < strikes.length; i++) {
      const prevCum = cumGex;
      cumGex += strikeGex[strikes[i]];
      if ((prevCum <= 0 && cumGex > 0) || (prevCum >= 0 && cumGex < 0)) {
        flipStrike = i > 0 ? strikes[i-1] + (strikes[i] - strikes[i-1]) * (Math.abs(prevCum) / (Math.abs(prevCum) + Math.abs(cumGex))) : strikes[i];
        foundFlip = true; break;
      }
    }
    if (!foundFlip || Math.abs(flipStrike - spot) / spot > 0.20) flipStrike = spot;
    result.gammaFlip = flipStrike; result.flipDist = ((spot - flipStrike) / spot) * 100;

    let maxCallOI = 0; const callOIAbove = {};
    Object.entries(strikeCallOI).forEach(([s, oi]) => { const sn = Number(s); if (sn >= spot * 0.98) { callOIAbove[sn] = oi; if (oi > maxCallOI) { maxCallOI = oi; result.callWall = sn; } } });
    const totalCallAbove = Object.values(callOIAbove).reduce((s, v) => s + v, 0);
    result.callWallConf = totalCallAbove > 0 ? (maxCallOI / totalCallAbove * 100) : 0; result.callWallOI = maxCallOI;

    let maxPutOI = 0; const putOIBelow = {};
    Object.entries(strikePutOI).forEach(([s, oi]) => { const sn = Number(s); if (sn <= spot * 1.02) { putOIBelow[sn] = oi; if (oi > maxPutOI) { maxPutOI = oi; result.putWall = sn; } } });
    const totalPutBelow = Object.values(putOIBelow).reduce((s, v) => s + v, 0);
    result.putWallConf = totalPutBelow > 0 ? (maxPutOI / totalPutBelow * 100) : 0; result.putWallOI = maxPutOI;

    const nearStrikes = strikes.filter(s => Math.abs(s - spot) / spot < 0.10);
    if (nearStrikes.length === 0) nearStrikes.push(...strikes.filter(s => Math.abs(s - spot) / spot < 0.20));
    let minPayout = Infinity;
    nearStrikes.forEach(pin => {
      let payout = 0;
      Object.entries(strikeCallOI).forEach(([s, oi]) => { if (pin > Number(s)) payout += (pin - Number(s)) * oi * 100; });
      Object.entries(strikePutOI).forEach(([s, oi]) => { if (Number(s) > pin) payout += (Number(s) - pin) * oi * 100; });
      if (payout < minPayout) { minPayout = payout; result.maxPain = pin; }
    });
  }

  // Flow: Total / 0DTE / Open
  let callDF = 0, putDF = 0, zdteCF = 0, zdtePF = 0, openCF = 0, openPF = 0;
  let totalVol = 0, zdteVol = 0, openVol = 0;
  const sweeps = [];

  contracts.forEach(c => {
    const [ey, em, ed] = c.details.expiration_date.split("-").map(Number);
    const expDate = new Date(ey, em - 1, ed);
    const dte = Math.round((expDate - todayMidnight) / 864e5);
    if (dte < 0 || dte > 90) return;
    const isCall = c.details.contract_type === "call";
    const delta = c.greeks.delta || 0;
    const vol = (c.day && c.day.volume) || 0;
    const oi = c.open_interest || 0;
    const ds = Math.abs(delta) * vol * 100;
    const is0 = dte === 0;
    totalVol += vol;
    if (isCall) callDF += ds; else putDF += ds;
    if (is0) { zdteVol += vol; if (isCall) zdteCF += ds; else zdtePF += ds; }
    else { openVol += vol; if (isCall) openCF += ds; else openPF += ds; }
    if (Math.abs(delta) > 0.7 && vol > 100) {
      sweeps.push({ type: isCall?"C":"P", strike: c.details.strike_price, delta, contracts: vol, eqShares: Math.abs(delta)*vol*100*(isCall?1:-1), dte: is0?"0DTE":`${dte}d`, oi, iv: c.implied_volatility||0 });
    }
  });

  result.cdf = callDF; result.pdf = putDF;
  result.dpc = putDF / Math.max(callDF, 1); result.nds = callDF - putDF;
  result.ndf = callDF - putDF;
  result.hvl = result.gammaFlip;
  const zPcp = (result.dpc - 0.8) / 0.35;
  const tPcp = 1 / (1 + 0.2316419 * Math.abs(zPcp));
  const d1Pcp = 0.3989422802 * Math.exp(-zPcp * zPcp / 2);
  const pPcp = 1 - d1Pcp * tPcp * (0.3193815 + tPcp * (-0.3565638 + tPcp * (1.781478 + tPcp * (-1.821256 + tPcp * 1.330274))));
  result.pcp = Math.max(1, Math.min(99, Math.round((zPcp >= 0 ? pPcp : 1 - pPcp) * 100)));
  result.zdteVol = zdteVol; result.zdtePct = totalVol > 0 ? (zdteVol / totalVol * 100) : 0;
  result.zdteCallFlow = zdteCF; result.zdtePutFlow = zdtePF;
  result.zdteDpc = zdtePF / Math.max(zdteCF, 1); result.zdteNetDelta = zdteCF - zdtePF;
  result.openVol = openVol; result.openCallFlow = openCF; result.openPutFlow = openPF;
  result.openDpc = openPF / Math.max(openCF, 1); result.openNetDelta = openCF - openPF;
  result.optVolRaw = totalVol; result.optVolShares = callDF + putDF;
  result.sweeps = sweeps.sort((a, b) => Math.abs(b.eqShares) - Math.abs(a.eqShares)).slice(0, 10);

  // Skew Z-score, 25d skew, smile ratio, skew curve classification
  const puts25d = contracts.filter(c => c.details.contract_type === "put" && c.greeks.delta && Math.abs(c.greeks.delta) > 0.20 && Math.abs(c.greeks.delta) < 0.30 && c.implied_volatility > 0);
  const calls25d = contracts.filter(c => c.details.contract_type === "call" && c.greeks.delta && c.greeks.delta > 0.20 && c.greeks.delta < 0.30 && c.implied_volatility > 0);
  if (puts25d.length > 0 && calls25d.length > 0) {
    const putIV = puts25d.reduce((s, c) => s + c.implied_volatility, 0) / puts25d.length;
    const callIV = calls25d.reduce((s, c) => s + c.implied_volatility, 0) / calls25d.length;
    result.skew25d = (putIV - callIV) * 100;
    result.skewZ = result.skew25d / 3;
    result.skew25dPutIV = putIV * 100;
    result.skew25dCallIV = callIV * 100;
    result.smileRatio = (putIV * 100) / Math.max(callIV * 100, 0.01);
    const putRicher = result.skew25dPutIV > result.skew25dCallIV * 1.03;
    const callRicher = result.skew25dCallIV > result.skew25dPutIV * 1.03;
    result.skewCurve = callRicher ? "forward" : (!putRicher && !callRicher) ? "smile" : "reverse";
    result.skewCurveLabel = callRicher ? "Forward Skew" : (!putRicher && !callRicher) ? "Volatility Smile" : "Reverse Skew";
  }

  // Near-term vs long-term skew term structure
  const byExpSkew = { near: { puts: [], calls: [] }, far: { puts: [], calls: [] } };
  contracts.forEach(c => {
    if (!c.implied_volatility || c.implied_volatility <= 0 || !c.greeks.delta) return;
    const absDelta = Math.abs(c.greeks.delta || 0);
    if (absDelta < 0.18 || absDelta > 0.32) return;
    const [_ey2, _em2, _ed2] = c.details.expiration_date.split("-").map(Number);
    const dte2 = Math.round((new Date(_ey2, _em2 - 1, _ed2) - todayMidnight) / 864e5);
    const bucket = (dte2 >= 3 && dte2 <= 21) ? "near" : (dte2 > 21 && dte2 <= 60) ? "far" : null;
    if (!bucket) return;
    byExpSkew[bucket][c.details.contract_type === "put" ? "puts" : "calls"].push(c.implied_volatility * 100);
  });
  if (byExpSkew.near.puts.length > 0 && byExpSkew.near.calls.length > 0 && byExpSkew.far.puts.length > 0 && byExpSkew.far.calls.length > 0) {
    const nP = byExpSkew.near.puts.reduce((s,v)=>s+v,0) / byExpSkew.near.puts.length;
    const nC = byExpSkew.near.calls.reduce((s,v)=>s+v,0) / byExpSkew.near.calls.length;
    const fP = byExpSkew.far.puts.reduce((s,v)=>s+v,0) / byExpSkew.far.puts.length;
    const fC = byExpSkew.far.calls.reduce((s,v)=>s+v,0) / byExpSkew.far.calls.length;
    result.nearTermSkew = nP - nC;
    result.farTermSkew = fP - fC;
    result.skewTermSpread = result.nearTermSkew - result.farTermSkew;
  }

  // Term structure
  const byExp = {};
  contracts.forEach(c => {
    if (!c.implied_volatility || c.implied_volatility <= 0) return;
    const [_ey, _em, _ed] = c.details.expiration_date.split("-").map(Number); const dte = Math.round((new Date(_ey, _em - 1, _ed) - todayMidnight) / 864e5);
    if (dte < 5 || dte > 90) return;
    const bucket = dte <= 30 ? "front" : "back";
    if (!byExp[bucket]) byExp[bucket] = [];
    byExp[bucket].push(c.implied_volatility);
  });
  if (byExp.front && byExp.front.length > 2 && byExp.back && byExp.back.length > 2) {
    const frontIV = byExp.front.reduce((s, v) => s + v, 0) / byExp.front.length;
    const backIV = byExp.back.reduce((s, v) => s + v, 0) / byExp.back.length;
    result.termSlope = frontIV / Math.max(backIV, 0.01);
  }

  // 25-Delta Risk Reversal: IV(25Δ call) - IV(25Δ put) on 14-45 DTE
  const rr25contracts = contracts.filter(c => {
    if (!c.implied_volatility || c.implied_volatility <= 0 || !c.greeks.delta) return false;
    const [_ey, _em, _ed] = c.details.expiration_date.split("-").map(Number); const dte = Math.round((new Date(_ey, _em - 1, _ed) - todayMidnight) / 864e5);
    return dte >= 14 && dte <= 45;
  });
  const rr25puts = rr25contracts.filter(c => c.details.contract_type === "put" && Math.abs(c.greeks.delta) >= 0.18 && Math.abs(c.greeks.delta) <= 0.32);
  const rr25calls = rr25contracts.filter(c => c.details.contract_type === "call" && c.greeks.delta >= 0.18 && c.greeks.delta <= 0.32);
  if (rr25puts.length > 0 && rr25calls.length > 0) {
    const putIV = rr25puts.reduce((s, c) => s + c.implied_volatility, 0) / rr25puts.length;
    const callIV = rr25calls.reduce((s, c) => s + c.implied_volatility, 0) / rr25calls.length;
    result.rr25d = (callIV - putIV) * 100;
    result.rr25dPutIV = putIV * 100;
    result.rr25dCallIV = callIV * 100;
  }

  // IV
  const atmC = contracts.filter(c => c.implied_volatility > 0 && c.greeks.delta && Math.abs(Math.abs(c.greeks.delta) - 0.5) < 0.15);
  if (atmC.length > 0) {
    result.iv = (atmC.reduce((s, c) => s + c.implied_volatility, 0) / atmC.length) * 100;
  }

  // Squeeze score
  const flipProx = Math.abs(result.flipDist);
  const putWallDist = spot > 0 ? (spot - result.putWall) / spot * 100 : 10;
  result.sq = Math.min(100, Math.max(0,
    (result.regime === "negative" ? 30 : 0) +
    (flipProx < 1 ? 25 : flipProx < 2 ? 15 : flipProx < 5 ? 5 : 0) +
    (putWallDist < 2 ? 20 : putWallDist < 5 ? 10 : 0) +
    (result.skewZ > 1.5 ? 15 : result.skewZ > 1 ? 8 : 0) +
    (result.dpc > 1.3 ? 10 : 0) +
    (result.skewCurve === "forward" ? 10 : 0)
  ));

  result.dspct = Math.abs(result.netGex) / Math.max(spot, 1);
  result._live = true;
  return result;
}

// ─── PROCESS A SINGLE TICKER ───────────────────────────────────────
async function processTicker(ticker, apiKey) {
  const quoteData = await getQuote(ticker, apiKey);
  let spot = 0;
  let equityVolume = 0;
  let prevClose = 0;
  let changePerc = 0;
  if (quoteData && quoteData.results && quoteData.results.length > 0) {
    spot = quoteData.results[0].c || quoteData.results[0].vw || 0;
    equityVolume = quoteData.results[0].v || 0;
    prevClose = quoteData.results[0].prevClose || 0;
    changePerc = quoteData.results[0].changePerc || 0;
    if (!changePerc && prevClose > 0) {
      changePerc = ((spot - prevClose) / prevClose) * 100;
    }
  }
  if (spot <= 0) return { error: { ticker, error: "no quote" } };

  const chainData = await getChain(ticker, spot, apiKey);
  const positioning = computePositioning(ticker, spot, chainData);
  positioning.equityVolume = equityVolume;
  positioning.changePerc = changePerc;
  positioning.prevClose = prevClose;
  // Compute Options % of equity volume (ADV proxy using today's volume)
  if (equityVolume > 0 && positioning.optVolShares > 0) {
    positioning.optVolPctADV = (positioning.optVolShares / equityVolume) * 100;
  }
  return { result: positioning };
}

// ─── PROCESS A BATCH OF TICKERS IN PARALLEL ────────────────────────
async function processBatch(batch, apiKey) {
  const settled = await Promise.allSettled(
    batch.map(ticker => processTicker(ticker, apiKey))
  );

  const results = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled" && s.value.result) {
      results.push(s.value.result);
    } else if (s.status === "fulfilled" && s.value.error) {
      errors.push(s.value.error);
    } else {
      errors.push({ ticker: batch[i], error: s.reason?.message || "unknown" });
    }
  });
  return { results, errors };
}

// ─── WAVE CONFIGURATION ────────────────────────────────────────────
// 112 tickers split into 4 waves of ~28, triggered 2 minutes apart.
// Each wave merges its results into the existing daily snapshot blob.
const WAVE_COUNT = 4;
function getWaveSlice(wave) {
  const size = Math.ceil(TICKERS.length / WAVE_COUNT);
  return TICKERS.slice(wave * size, (wave + 1) * size);
}

// ─── MAIN BACKGROUND FUNCTION ──────────────────────────────────────
export default async (request) => {
  const apiKey = Netlify.env.get("POLYGON_API_KEY");
  if (!apiKey) { console.error("POLYGON_API_KEY not set"); return; }

  // Parse wave from request body (0, 1, or 2)
  let wave = 0;
  try {
    const body = await request.json();
    wave = typeof body.wave === "number" ? body.wave : 0;
  } catch {}

  const store = getStore("snapshots");
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);

  const waveTickers = getWaveSlice(wave);
  console.log(`[${now.toISOString()}] Wave ${wave + 1}/${WAVE_COUNT}: ${waveTickers.length} tickers (${waveTickers[0]}…${waveTickers[waveTickers.length - 1]})`);

  const waveResults = [];
  const waveErrors = [];

  for (let i = 0; i < waveTickers.length; i += BATCH_SIZE) {
    const batch = waveTickers.slice(i, i + BATCH_SIZE);
    const { results, errors } = await processBatch(batch, apiKey);
    waveResults.push(...results);
    waveErrors.push(...errors);

    const processed = Math.min(i + BATCH_SIZE, waveTickers.length);
    console.log(`  Batch: ${processed}/${waveTickers.length} (${waveResults.length} ok, ${waveErrors.length} errors)`);

    if (i + BATCH_SIZE < waveTickers.length) await sleep(INTER_BATCH_DELAY);
  }

  // ─── Merge into existing daily snapshot ───────────────────────────
  let existing = { tickers: [], errors: [], completedWaves: [] };
  try {
    const prev = await store.get(`daily-${dateKey}`, { type: "json" });
    if (prev && prev.tickers) existing = prev;
  } catch {}

  // Replace tickers this wave covers (safe for re-runs), keep the rest
  const waveTkSet = new Set(waveTickers);
  const keptTickers = (existing.tickers || []).filter(t => !waveTkSet.has(t.ticker));
  const keptErrors = (existing.errors || []).filter(e => !waveTkSet.has(e.ticker));

  const mergedTickers = [...keptTickers, ...waveResults];
  const mergedErrors = [...keptErrors, ...waveErrors];

  const completedWaves = [...new Set([...(existing.completedWaves || []), wave])].sort();
  const allDone = completedWaves.length >= WAVE_COUNT;

  const snapshot = {
    date: dateKey, capturedAt: now.toISOString(),
    tickerCount: mergedTickers.length, errorCount: mergedErrors.length,
    complete: allDone, completedWaves,
    errors: mergedErrors.slice(0, 30), tickers: mergedTickers,
  };

  // Run vol divergence scan on complete data
  if (allDone && mergedTickers.length > 10) {
    const volDivs = [];
    for (const t of mergedTickers) {
      if (!t._live || !t.spot || t.spot <= 0) continue;
      const changePct = t.changePerc || 0;

      // Signal 1: Extreme put/call flow imbalance
      const bullishShares = t.dpc < 0.5 && t.nds > 100000;
      const bearishShares = t.dpc > 1.5 && Math.abs(t.nds) > 100000;
      if (bullishShares || bearishShares) {
        volDivs.push({
          ticker: t.ticker, spot: t.spot, shareChg: changePct, isPutDiv: bearishShares,
          divType: "otm",
          type: bearishShares ? "Heavy put flow" : "Heavy call flow",
          signal: bearishShares ? "Bearish options conviction" : "Bullish options conviction",
          severity: Math.min(100, Math.round(Math.abs(t.nds) / 10000)),
          ivJump: t.iv || 0, currentIV: t.iv || 0, priorIV: (t.iv || 0) * 0.85,
          chainStrikesElevated: 0, chainTotalStrikes: 0,
          at: t.ticker, _live: true,
        });
      }

      // Signal 2: Spot-up / Vol-up — call IV richer than put IV while shares rising
      // Uses the 25Δ risk reversal already computed in positioning
      if (changePct > 0.3 && t.rr25d && t.rr25d > 0 && t.rr25dCallIV > 0) {
        // Positive risk reversal = call IV > put IV (abnormal for equities)
        const severity = Math.min(100, Math.round(
          (t.rr25d > 3 ? 25 : t.rr25d > 1 ? 15 : 5) +
          (t.rr25dCallIV > 50 ? 20 : t.rr25dCallIV > 35 ? 12 : 5) +
          (t.dpc < 0.6 ? 15 : t.dpc < 0.8 ? 8 : 0) + // call-dominated flow
          (changePct > 3 ? 15 : changePct > 1.5 ? 10 : 5) +
          10 // base for this signal
        ));
        if (severity >= 30) {
          const alreadyFlagged = volDivs.find(v => v.ticker === t.ticker);
          if (!alreadyFlagged) {
            volDivs.push({
              ticker: t.ticker, spot: t.spot, shareChg: changePct, isPutDiv: false,
              divType: "spotUpVolUp",
              type: "Spot up / vol up",
              signal: "Speculative call chasing — FOMO driving IV higher into rally",
              callIV: t.rr25dCallIV, putIV: t.rr25dPutIV,
              callIVRicher: true, riskRevSpread: t.rr25d,
              ivJump: t.rr25dCallIV, currentIV: t.rr25dCallIV, priorIV: t.rr25dCallIV * 0.85,
              chainStrikesElevated: 0, chainTotalStrikes: 0,
              severity, at: t.ticker, _live: true,
            });
          }
        }
      }

      // Signal 3: Spot-down / Vol-down — put IV compressed while shares falling
      if (changePct < -0.3 && t.iv > 0 && t.iv < 25 && t.rr25d && t.rr25d > -2) {
        const severity = Math.min(100, Math.round(
          (t.iv < 15 ? 25 : t.iv < 20 ? 15 : 5) +
          (Math.abs(changePct) > 3 ? 20 : Math.abs(changePct) > 1.5 ? 12 : 5) +
          15
        ));
        if (severity >= 30) {
          const alreadyFlagged = volDivs.find(v => v.ticker === t.ticker);
          if (!alreadyFlagged) {
            volDivs.push({
              ticker: t.ticker, spot: t.spot, shareChg: changePct, isPutDiv: true,
              divType: "spotDownVolDown",
              type: "Spot down / vol down",
              signal: "IV compressed into selloff — complacency or informed bottom",
              callIV: t.rr25dCallIV || 0, putIV: t.rr25dPutIV || t.iv,
              ivJump: t.iv, currentIV: t.iv, priorIV: t.iv * 1.15,
              chainStrikesElevated: 0, chainTotalStrikes: 0,
              severity, at: t.ticker, _live: true,
            });
          }
        }
      }
    }
    snapshot.volDivergences = volDivs.sort((a, b) => b.severity - a.severity).slice(0, 20);
    if (volDivs.length > 0) console.log(`  Vol divergences: ${volDivs.length} detected`);
  }

  await store.setJSON("latest", snapshot);
  await store.setJSON(`daily-${dateKey}`, snapshot);

  if (allDone) {
    let dateIndex = [];
    try { dateIndex = await store.get("date-index", { type: "json" }) || []; } catch { dateIndex = []; }
    if (!dateIndex.includes(dateKey)) {
      dateIndex.push(dateKey); dateIndex.sort();
      await store.setJSON("date-index", dateIndex);
    }
  }

  const elapsed = ((Date.now() - now.getTime()) / 1000).toFixed(1);
  console.log(`[${now.toISOString()}] Wave ${wave + 1} done in ${elapsed}s: ${waveResults.length} captured, ${waveErrors.length} errors (snapshot total: ${mergedTickers.length})`);
  if (waveErrors.length > 0) console.log(`  Errors: ${waveErrors.map(e => e.ticker).join(", ")}`);
};
