import { getStore } from "@netlify/blobs";

// ─── 143-TICKER UNIVERSE ───────────────────────────────────────────
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

const RATE_DELAY = 250;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function polyFetch(url) {
  try {
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function getQuote(ticker, apiKey) {
  return await polyFetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`);
}

async function getChain(ticker, spot, apiKey) {
  const low = Math.round(spot * 0.85);
  const high = Math.round(spot * 1.15);
  const data = await polyFetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?limit=250&strike_price.gte=${low}&strike_price.lte=${high}&apiKey=${apiKey}`);
  if (!data || !data.results) return data;
  let nextUrl = data.next_url ? data.next_url + `&apiKey=${apiKey}` : null;
  let pages = 0;
  while (nextUrl && pages < 3) {
    await sleep(RATE_DELAY);
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

// ─── MAIN BACKGROUND FUNCTION ──────────────────────────────────────
export default async (request) => {
  const apiKey = Netlify.env.get("POLYGON_API_KEY");
  if (!apiKey) { console.error("POLYGON_API_KEY not set"); return; }

  const store = getStore("snapshots");
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  console.log(`[${now.toISOString()}] Background capture starting for ${TICKERS.length} tickers...`);

  const results = [];
  const errors = [];

  for (let i = 0; i < TICKERS.length; i++) {
    const ticker = TICKERS[i];
    try {
      const quoteData = await getQuote(ticker, apiKey);
      await sleep(RATE_DELAY);

      let spot = 0;
      if (quoteData && quoteData.results && quoteData.results.length > 0) {
        spot = quoteData.results[0].c || quoteData.results[0].vw || 0;
      }
      if (spot <= 0) { errors.push({ ticker, error: "no quote" }); continue; }

      const chainData = await getChain(ticker, spot, apiKey);
      await sleep(RATE_DELAY);

      const positioning = computePositioning(ticker, spot, chainData);
      results.push(positioning);

      if ((i + 1) % 20 === 0) console.log(`  Processed ${i + 1}/${TICKERS.length}...`);
    } catch (e) {
      errors.push({ ticker, error: e.message });
    }
  }

  const snapshot = {
    date: dateKey, capturedAt: now.toISOString(),
    tickerCount: results.length, errorCount: errors.length,
    errors: errors.slice(0, 20), tickers: results,
  };

  await store.setJSON("latest", snapshot);
  await store.setJSON(`daily-${dateKey}`, snapshot);

  let dateIndex = [];
  try { dateIndex = await store.get("date-index", { type: "json" }) || []; } catch { dateIndex = []; }
  if (!dateIndex.includes(dateKey)) {
    dateIndex.push(dateKey); dateIndex.sort();
    await store.setJSON("date-index", dateIndex);
  }

  console.log(`[${new Date().toISOString()}] Capture complete: ${results.length} tickers, ${errors.length} errors`);
  if (errors.length > 0) console.log(`  Errors: ${errors.map(e => e.ticker).join(", ")}`);
};
