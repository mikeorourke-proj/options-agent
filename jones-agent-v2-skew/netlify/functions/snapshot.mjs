import { getStore } from "@netlify/blobs";

// Serves snapshot data from Netlify Blobs
// GET /api/snapshot → latest snapshot
// GET /api/snapshot?date=2026-05-12 → specific date
// GET /api/snapshot?dates=true → list of all captured dates
// GET /api/snapshot?ticker=SPY → single ticker from latest
export default async (request) => {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const ticker = url.searchParams.get("ticker");
  const listDates = url.searchParams.get("dates");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });

  const store = getStore("snapshots");

  try {
    // List all captured dates
    if (listDates) {
      let dateIndex = [];
      try { dateIndex = await store.get("date-index", { type: "json" }) || []; } catch { dateIndex = []; }
      return new Response(JSON.stringify({ dates: dateIndex }), { headers });
    }

    // Ticker history across all dates
    const history = url.searchParams.get("history");
    if (ticker && history) {
      let dateIndex = [];
      try { dateIndex = await store.get("date-index", { type: "json" }) || []; } catch { dateIndex = []; }
      const points = [];
      for (const dt of dateIndex.slice(-60)) {
        try {
          const snap = await store.get(`daily-${dt}`, { type: "json" });
          if (snap && snap.tickers) {
            const t = snap.tickers.find(d => d.ticker === ticker.toUpperCase());
            if (t) points.push({ date: dt, spot: t.spot, optVolPctADV: t.optVolPctADV||0, optVolShares: t.optVolShares||0, optVolRaw: t.optVolRaw||0, dpc: t.dpc||0, nds: t.nds||0, netGex: t.netGex||0, regime: t.regime, gammaFlip: t.gammaFlip||0, flipDist: t.flipDist||0, callWall: t.callWall||0, callWallConf: t.callWallConf||0, putWall: t.putWall||0, putWallConf: t.putWallConf||0, maxPain: t.maxPain||0, sq: t.sq||0, zdtePct: t.zdtePct||0, zdteDpc: t.zdteDpc||0, openDpc: t.openDpc||0, skewZ: t.skewZ||0, termSlope: t.termSlope||0, vrp: t.vrp||0, iv: t.iv||0, rv: t.rv||0, pcr: t.pcr||0, dspct: t.dspct||0, zdteNetDelta: t.zdteNetDelta||0, openNetDelta: t.openNetDelta||0, rr25d: t.rr25d||0, rr25dPutIV: t.rr25dPutIV||0, rr25dCallIV: t.rr25dCallIV||0 });
          }
        } catch {}
      }
      return new Response(JSON.stringify({ ticker: ticker.toUpperCase(), points }), { headers });
    }

    // Get specific date or latest
    const key = date ? `daily-${date}` : "latest";
    let snapshot;
    try {
      snapshot = await store.get(key, { type: "json" });
    } catch {
      return new Response(JSON.stringify({ error: "No snapshot found", key }), { status: 404, headers });
    }

    if (!snapshot) {
      return new Response(JSON.stringify({ error: "No snapshot found", key }), { status: 404, headers });
    }

    // Filter to single ticker if requested
    if (ticker && snapshot.tickers) {
      const t = snapshot.tickers.find(d => d.ticker === ticker.toUpperCase());
      if (!t) return new Response(JSON.stringify({ error: `Ticker ${ticker} not found in snapshot` }), { status: 404, headers });
      return new Response(JSON.stringify({ date: snapshot.date, capturedAt: snapshot.capturedAt, ticker: t }), { headers });
    }

    return new Response(JSON.stringify(snapshot), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};
