export default async (request) => {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint") || "quote";
  const ticker = url.searchParams.get("ticker") || "SPY";
  const apiKey = Netlify.env.get("POLYGON_API_KEY");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });
  if (!apiKey) return new Response(JSON.stringify({ error: "POLYGON_API_KEY not set" }), { status: 500, headers });

  let polygonUrl;
  switch (endpoint) {
    case "quote":
      polygonUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`;
      break;
    case "chain":
      polygonUrl = `https://api.polygon.io/v3/snapshot/options/${ticker}?limit=250&apiKey=${apiKey}`;
      break;
    case "snapshot":
      polygonUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`;
      break;
    default:
      return new Response(JSON.stringify({ error: "unknown endpoint" }), { status: 400, headers });
  }

  try {
    const r = await fetch(polygonUrl, { headers: { "Accept": "application/json" } });
    const data = await r.json();
    return new Response(JSON.stringify(data), { status: r.status, headers: { ...headers, "Cache-Control": "public, max-age=15" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
  }
};
