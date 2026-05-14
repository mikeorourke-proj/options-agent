export default async (request) => {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint") || "quote";
  const ticker = url.searchParams.get("ticker") || "SPY";
  const spot = url.searchParams.get("spot") || "";
  const apiKey = Netlify.env.get("POLYGON_API_KEY");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });
  if (!apiKey) return new Response(JSON.stringify({ error: "POLYGON_API_KEY not set" }), { status: 500, headers });

  let polygonUrl;
  switch (endpoint) {
    case "quote": {
      // Stock snapshot — returns lastTrade (real-time with stock feed), min bar, day bar
      const snapR = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`, { headers: { "Accept": "application/json" } });
      const snapD = await snapR.json();
      if (snapD && snapD.ticker) {
        const s = snapD.ticker;
        // Priority: lastTrade (real-time tick) > min bar close > day bar close
        const lastTradePrice = s.lastTrade?.p || 0;
        const minBarPrice = s.min?.c || 0;
        const dayBarPrice = s.day?.c || 0;
        const price = lastTradePrice || minBarPrice || dayBarPrice || 0;
        const volume = s.day?.v || 0;
        const prevClose = s.prevDay?.c || 0;
        const changePerc = s.todaysChangePerc || 0;
        const priceSource = lastTradePrice ? "lastTrade" : minBarPrice ? "minBar" : "dayBar";
        if (price > 0) {
          return new Response(JSON.stringify({
            results: [{ c: price, vw: s.day?.vw || price, v: volume, prevClose, changePerc }],
            source: "snapshot",
            priceSource
          }), { headers: { ...headers, "Cache-Control": "public, max-age=15" } });
        }
      }
      // Fallback: prev-day aggs (yesterday's close)
      const prevR = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`, { headers: { "Accept": "application/json" } });
      const prevD = await prevR.json();
      if (prevD && prevD.results && prevD.results.length > 0) {
        return new Response(JSON.stringify(prevD), { headers: { ...headers, "Cache-Control": "public, max-age=15" } });
      }
      // Fallback: derive from options chain underlying
      const probeR = await fetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?limit=1&apiKey=${apiKey}`, { headers: { "Accept": "application/json" } });
      const probeD = await probeR.json();
      if (probeD && probeD.results && probeD.results.length > 0) {
        const ud = probeD.results[0].underlying_asset;
        if (ud && ud.price && ud.price > 0) {
          return new Response(JSON.stringify({ results: [{ c: ud.price, vw: ud.price }], source: "options_underlying" }), { headers: { ...headers, "Cache-Control": "public, max-age=15" } });
        }
      }
      return new Response(JSON.stringify({ results: [] }), { headers });
    }
    case "chain": {
      let chainUrl = `https://api.polygon.io/v3/snapshot/options/${ticker}?limit=250&apiKey=${apiKey}`;
      if (spot && Number(spot) > 0) {
        const s = Number(spot);
        const low = Math.round(s * 0.85);
        const high = Math.round(s * 1.15);
        chainUrl += `&strike_price.gte=${low}&strike_price.lte=${high}`;
      }
      polygonUrl = chainUrl;
      break;
    }
    case "snapshot":
      polygonUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`;
      break;
    default:
      return new Response(JSON.stringify({ error: "unknown endpoint" }), { status: 400, headers });
  }

  try {
    const r = await fetch(polygonUrl, { headers: { "Accept": "application/json" } });
    const data = await r.json();

    if (endpoint === "chain" && data.results && data.next_url) {
      let nextUrl = data.next_url + `&apiKey=${apiKey}`;
      let pages = 0;
      while (nextUrl && pages < 5) {
        try {
          const nr = await fetch(nextUrl, { headers: { "Accept": "application/json" } });
          const nd = await nr.json();
          if (nd.results) data.results.push(...nd.results);
          nextUrl = nd.next_url ? nd.next_url + `&apiKey=${apiKey}` : null;
          pages++;
        } catch { break; }
      }
    }

    return new Response(JSON.stringify(data), { status: r.status, headers: { ...headers, "Cache-Control": "public, max-age=15" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
  }
};
