export default async (request) => {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint") || "gex";
  const ticker = url.searchParams.get("ticker") || "SPY";
  const apiKey = Netlify.env.get("FLASHALPHA_API_KEY");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });
  if (!apiKey) return new Response(JSON.stringify({ error: "FLASHALPHA_API_KEY not set" }), { status: 500, headers });

  const paths = {
    gex: `/v1/exposure/gex/${ticker}`,
    levels: `/v1/exposure/levels/${ticker}`,
    summary: `/v1/exposure/summary/${ticker}`,
    narrative: `/v1/exposure/narrative/${ticker}`,
    maxpain: `/v1/exposure/maxpain/${ticker}`,
    stockquote: `/stockquote/${ticker}`,
  };

  const path = paths[endpoint];
  if (!path) return new Response(JSON.stringify({ error: "unknown endpoint" }), { status: 400, headers });

  try {
    const r = await fetch(`https://lab.flashalpha.com${path}`, {
      headers: { "X-Api-Key": apiKey, "Accept": "application/json" }
    });
    const data = await r.json();
    return new Response(JSON.stringify(data), { status: r.status, headers: { ...headers, "Cache-Control": "public, max-age=15" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
  }
};
