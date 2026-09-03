/* ═══════════════════════════════════════════════════════════════════
   mkt.mjs — market data proxy (Massive / api.polygon.io)

   Named routes only. The browser never sees the API key and cannot
   request an arbitrary upstream path.

     GET /.netlify/functions/mkt?route=quote&ticker=TLT
     GET /.netlify/functions/mkt?route=chain&ticker=TLT&spot=98.4
     GET /.netlify/functions/mkt?route=shortInterest&ticker=TLT
     GET /.netlify/functions/mkt?route=bars&ticker=TLT&from=2021-01-01&to=2026-09-02
     GET /.netlify/functions/mkt?route=treasury&limit=5
     GET /.netlify/functions/mkt?route=reference&ticker=TLT

   Every response carries `_log` for the client run log.
   ═══════════════════════════════════════════════════════════════════ */

import { srvLog } from "./_runlog.mjs";

const HOST = "https://api.polygon.io";

/* Strike window around spot. ETFs with $1 strikes (SPY/QQQ/TLT) return
   thousands of contracts, so the window has to be tight enough to keep
   pagination sane but wide enough to include both walls. */
function strikeWindow(spot, pct) {
  return { lo: Math.floor(spot * (1 - pct)), hi: Math.ceil(spot * (1 + pct)) };
}

const WIDE_CHAIN = new Set(["SPY", "QQQ", "IWM", "TLT", "HYG", "GLD", "SLV", "XLF", "EEM", "FXI"]);

export default async (request) => {
  const apiKey = Netlify.env.get("POLYGON_API_KEY");
  const L = srvLog("mkt", apiKey);
  if (!apiKey) return L.fail(new Error("POLYGON_API_KEY not set"), 500);

  const q = new URL(request.url).searchParams;
  const route = q.get("route");
  const ticker = (q.get("ticker") || "").toUpperCase().replace(/[^A-Z.\-]/g, "");
  const key = `apiKey=${apiKey}`;

  try {
    switch (route) {
      /* Current price + today's volume. Snapshot first (live/15-min),
         prev-day bar as fallback — the ordering matters, prev returns
         yesterday's close and will silently look plausible. */
      case "quote": {
        const s = await L.fetch(`${HOST}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?${key}`);
        const tk = s.body?.ticker;
        if (tk) {
          const px = tk.day?.c || tk.min?.c || tk.prevDay?.c || 0;
          if (px > 0) {
            return L.respond({
              ticker, price: px, volume: tk.day?.v || 0, vwap: tk.day?.vw || px,
              prevClose: tk.prevDay?.c || 0, changePct: tk.todaysChangePerc ?? null,
              source: tk.day?.c ? "snapshot.day" : "snapshot.prev",
            });
          }
        }
        const p = await L.fetch(`${HOST}/v2/aggs/ticker/${ticker}/prev?adjusted=true&${key}`);
        const r0 = p.body?.results?.[0];
        if (!r0) return L.respond({ ticker, price: 0, error: "no quote" }, 200);
        L.warn("quote.fallback", { ticker, note: "snapshot empty, using prev-day close" });
        return L.respond({ ticker, price: r0.c, volume: r0.v, vwap: r0.vw, source: "aggs.prev" });
      }

      /* Reference: name, type, shares outstanding (→ AUM, → short % ). */
      case "reference": {
        const r = await L.fetch(`${HOST}/v3/reference/tickers/${ticker}?${key}`);
        const d = r.body?.results;
        if (!d) return L.respond({ ticker, error: "not found" });
        return L.respond({
          ticker, name: d.name, type: d.type, exchange: d.primary_exchange,
          sharesOutstanding: d.share_class_shares_outstanding || null,
          listDate: d.list_date || null, cik: d.cik || null,
        });
      }

      /* Options chain, paginated, windowed around spot. */
      case "chain": {
        const spot = Number(q.get("spot")) || 0;
        const pct = Number(q.get("pct")) || (WIDE_CHAIN.has(ticker) ? 0.09 : 0.16);
        const maxDte = Number(q.get("maxDte")) || 150;
        const d0 = new Date(), d1 = new Date(Date.now() + maxDte * 864e5);
        const expLo = d0.toISOString().slice(0, 10), expHi = d1.toISOString().slice(0, 10);

        let url = `${HOST}/v3/snapshot/options/${ticker}?limit=250`
                + `&expiration_date.gte=${expLo}&expiration_date.lte=${expHi}&${key}`;
        if (spot > 0) {
          const { lo, hi } = strikeWindow(spot, pct);
          url += `&strike_price.gte=${lo}&strike_price.lte=${hi}`;
          L.info("chain.window", { ticker, spot, pct, lo, hi, expLo, expHi });
        }
        const all = [];
        let pages = 0;
        while (url && pages < 8) {
          const r = await L.fetch(url);
          const res = r.body?.results || [];
          all.push(...res);
          url = r.body?.next_url ? `${r.body.next_url}&${key}` : null;
          pages++;
          if (url) await new Promise(z => setTimeout(z, 90));
        }
        /* Contracts with no greeks cannot be analysed — RSP returns
           these. Count them so the client can gate on liquidity. */
        const usable = all.filter(c => c.greeks && typeof c.greeks.delta === "number");
        const withOI = all.filter(c => (c.open_interest || 0) > 0);
        // Expiry coverage matters as much as contract count: if pagination
        // truncated before reaching 20+ DTE there is no 30-day ATM vol.
        const exps = [...new Set(all.map(c => c.details?.expiration_date).filter(Boolean))].sort();
        const far = exps.filter(e => (new Date(e) - Date.now()) / 864e5 >= 20).length;
        L.info("chain.quality", {
          ticker, fetched: all.length, pages, expiries: exps.length, expiriesOver20d: far,
          withGreeks: usable.length, withOI: withOI.length,
          truncated: Boolean(url),
          tradable: usable.length > 40 && withOI.length > 40,
        });
        if (url) L.warn("chain.truncated", { ticker, pages, note: "page cap hit; narrow the strike or expiry window" });
        return L.respond({
          ticker, contracts: all, pages,
          quality: { fetched: all.length, withGreeks: usable.length, withOI: withOI.length,
                     expiries: exps.length, expiriesOver20d: far, truncated: Boolean(url) },
        });
      }

      /* Short interest (biweekly) + short volume (daily). */
      case "shortInterest": {
        const si = await L.fetch(`${HOST}/stocks/v1/short-interest?ticker=${ticker}&limit=6&sort=settlement_date.desc&${key}`);
        const sv = await L.fetch(`${HOST}/stocks/v1/short-volume?ticker=${ticker}&limit=10&sort=date.desc&${key}`);
        return L.respond({
          ticker,
          shortInterest: si.body?.results || [],
          shortVolume: (sv.body?.results || []).map(d => ({
            date: d.date, ratio: d.short_volume_ratio,
            shortVolume: d.short_volume, totalVolume: d.total_volume,
          })),
        });
      }

      /* Daily bars. Starter clamps history to ~5y; Advanced gives 20y. */
      case "bars": {
        const from = q.get("from") || "2021-01-01";
        const to = q.get("to") || new Date().toISOString().slice(0, 10);
        const r = await L.fetch(`${HOST}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&limit=50000&sort=asc&${key}`);
        const bars = r.body?.results || [];
        if (bars.length) {
          L.info("bars.range", {
            ticker, n: bars.length,
            first: new Date(bars[0].t).toISOString().slice(0, 10),
            last: new Date(bars[bars.length - 1].t).toISOString().slice(0, 10),
            requestedFrom: from,
          });
        }
        return L.respond({ ticker, bars });
      }

      /* Treasury curve — included on the current plan, back to 1962. */
      case "treasury": {
        const limit = Math.min(Number(q.get("limit")) || 5, 5000);
        const r = await L.fetch(`${HOST}/fed/v1/treasury-yields?limit=${limit}&sort=date.desc&${key}`);
        return L.respond({ yields: r.body?.results || [] });
      }

      /* Listed expiries, for expiry selection against a catalyst date. */
      case "expiries": {
        const r = await L.fetch(`${HOST}/v3/reference/options/contracts?underlying_ticker=${ticker}&limit=1000&expired=false&${key}`);
        const set = [...new Set((r.body?.results || []).map(c => c.expiration_date))].sort();
        return L.respond({ ticker, expiries: set });
      }

      case "news": {
        const r = await L.fetch(`${HOST}/v2/reference/news?ticker=${ticker}&limit=10&${key}`);
        return L.respond({
          ticker,
          articles: (r.body?.results || []).map(a => ({
            title: a.title, publisher: a.publisher?.name, published: a.published_utc,
            url: a.article_url, tickers: a.tickers, insights: a.insights,
          })),
        });
      }

      default:
        return L.fail(new Error(`unknown route: ${route}`), 400);
    }
  } catch (e) {
    return L.fail(e);
  }
};
