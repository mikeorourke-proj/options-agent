import { getStore } from "@netlify/blobs";

// ─── 144-TICKER UNIVERSE ───────────────────────────────────────────
const TICKERS = [
  "NVDA","GOOGL","AAPL","MSFT","AMZN","AVGO","TSLA","META","BRK.B","WMT",
  "LLY","MU","JPM","AMD","INTC","V","XOM","ORCL","JNJ","COST","MA","CAT",
  "CSCO","LRCX","CVX","NFLX","BAC","ABBV","AMAT","UNH","KO","PG","PLTR",
  "GE","HD","MS","GS","GEV","PM","MRK","TXN","QCOM","KLAC","RTX","LIN",
  "SNDK","WFC","C","AXP","IBM","TMUS","ADI","PEP","NEE","VZ","MCD","BA",
  "STX","DIS","GLW","AMGN","WDC","BLK","PANW","T","ANET","TMO","GILD",
  "TJX","ETN","APP","DELL","DE","SCHW","UNP","UBER","WELL","APH","BX",
  "ISRG","PFE","CRM","IBKR","ABT","VRT","COP","HON","CRWD","PLD","NEM",
  "SPGI","LOW","CB","BKNG","SBUX","LMT","DHR","CVS","PWR","PGR","MO",
  "COF","BMY","VRTX","PH","HWM","INTU","CEG","SYK","EQIX","ACN","TT",
  "SO","CME","CDNS","ADBE","SNPS","DUK","CMI","MDT","HCA","NOW","MAR",
  "GD","FCX","BK","WMB","FDX","CMCSA","KKR","ICE","MCK",
  "SPY","QQQ","IWM","DIA","XLF","XLK","XLE","XLV","XLI","XLP","RSP","XBI"
];

// ─── CONCURRENCY & RATE CONTROL ────────────────────────────────────
const BATCH_SIZE = 2;           // tickers processed concurrently per batch
const INTER_BATCH_DELAY = 2000; // ms pause between batches
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
  // 1. Try prev-day aggs (requires stocks tier)
  const prev = await polyFetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`);
  if (prev && prev.results && prev.results.length > 0) return prev;

  // 2. Fallback: stock snapshot (available on options tier)
  const snap = await polyFetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`);
  if (snap && snap.ticker) {
    const s = snap.ticker;
    const price = s.lastTrade?.p || s.prevDay?.c || s.day?.c || s.min?.c || 0;
    if (price > 0) return { results: [{ c: price, vw: s.day?.vw || price }] };
  }

  // 3. Fallback: derive spot from options chain underlying asset
  const probe = await polyFetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?limit=1&apiKey=${apiKey}`);
  if (probe && probe.results && probe.results.length > 0) {
    const ud = probe.results[0].underlying_asset;
    if (ud && ud.price && ud.price > 0) return { results: [{ c: ud.price, vw: ud.price }] };
  }

  return null;
}

async function getChain(ticker, spot, apiKey) {
  const low = Math.round(spot * 0.85);
  const high = Math.round(spot * 1.15);
  const data = await polyFetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?limit=250&strike_price.gte=${low}&strike_price.lte=${high}&apiKey=${apiKey}`);
  if (!data || !data.results) return data;
  let nextUrl = data.next_url ? data.next_url + `&apiKey=${apiKey}` : null;
  let pages = 0;
  while (nextUrl && pages < 3) {
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
    optVolRaw: 0, optVolShares: 0, sweeps: [], _live: false,
  };

  if (!chainData || !chainData.results || !chainData.results.length) return result;
  const contracts = chainData.results.filter(c => c.details && c.greeks && c.details.expiration_date && c.details.strike_price);
  if (contracts.length === 0) return result;

  // Near-term GEX (7-45 DTE)
  const nearTerm = contracts.filter(c => {
    const dte = Math.floor((new Date(c.details.expiration_date) - now) / 864e5);
    return dte >= 7 && dte <= 45;
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
    const dte = Math.floor((new Date(c.details.expiration_date) - now) / 864e5);
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
  result.zdteVol = zdteVol; result.zdtePct = totalVol > 0 ? (zdteVol / totalVol * 100) : 0;
  result.zdteCallFlow = zdteCF; result.zdtePutFlow = zdtePF;
  result.zdteDpc = zdtePF / Math.max(zdteCF, 1); result.zdteNetDelta = zdteCF - zdtePF;
  result.openVol = openVol; result.openCallFlow = openCF; result.openPutFlow = openPF;
  result.openDpc = openPF / Math.max(openCF, 1); result.openNetDelta = openCF - openPF;
  result.optVolRaw = totalVol; result.optVolShares = callDF + putDF;
  result.sweeps = sweeps.sort((a, b) => Math.abs(b.eqShares) - Math.abs(a.eqShares)).slice(0, 10);
  result._live = true;
  return result;
}

// ─── PROCESS A SINGLE TICKER ───────────────────────────────────────
async function processTicker(ticker, apiKey) {
  const quoteData = await getQuote(ticker, apiKey);
  let spot = 0;
  if (quoteData && quoteData.results && quoteData.results.length > 0) {
    spot = quoteData.results[0].c || quoteData.results[0].vw || 0;
  }
  if (spot <= 0) return { error: { ticker, error: "no quote" } };

  const chainData = await getChain(ticker, spot, apiKey);
  const positioning = computePositioning(ticker, spot, chainData);
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
// 144 tickers split into 6 waves of ~24, triggered 2 minutes apart.
// Each wave merges its results into the existing daily snapshot blob.
const WAVE_COUNT = 6;
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
