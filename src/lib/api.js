/* Thin client over the two Netlify functions. Every call goes through
   RunLog.fetch, and any server-side trace returned in `_log` is merged
   into the same run so one download shows both halves. */
import RunLog from "./runlog.js";

async function call(url, opts) {
  const body = await RunLog.fetch(url, opts);
  if (body && body._log) RunLog.absorb(body._log);
  return body;
}

const mkt = (route, params = {}) => {
  // Drop undefined/null so they don't serialise as the string "undefined",
  // which would defeat server-side defaults.
  const clean = Object.fromEntries(
    Object.entries({ route, ...params }).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  return call("/.netlify/functions/mkt?" + new URLSearchParams(clean));
};

export const api = {
  quote:         (ticker)        => mkt("quote", { ticker }),
  reference:     (ticker)        => mkt("reference", { ticker }),
  chain:         (ticker, spot)  => mkt("chain", { ticker, spot: spot ?? "" }),
  shortInterest: (ticker)        => mkt("shortInterest", { ticker }),
  bars:          (ticker, from, to) => mkt("bars", { ticker, from, to }),
  expiries:      (ticker)        => mkt("expiries", { ticker }),
  news:          (ticker)        => mkt("news", { ticker }),
  treasury:      (limit = 5)     => mkt("treasury", { limit }),

  think: (task, text, extra = {}) =>
    call("/.netlify/functions/think", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, text, today: new Date().toISOString().slice(0, 10), ...extra }),
    }),
};

/* Bounded concurrency — screening a dozen candidates at once would
   otherwise fire 36 upstream calls simultaneously. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); }
        catch (e) { out[idx] = { error: e.message }; }
      }
    })
  );
  return out;
}
