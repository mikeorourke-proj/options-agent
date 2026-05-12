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
