/* Thin client over the two Netlify functions. Every call goes through
   RunLog.fetch, and any server-side trace returned in `_log` is merged
   into the same run so one download shows both halves. */
import RunLog from "./runlog.js";

async function call(url, opts) {
  const body = await RunLog.fetch(url, opts);
  if (body && body._log) RunLog.absorb(body._log);
  return body;
}

/* Session cache. GLD's chain is 1,500 contracts and was being pulled once
   per theme that resolved to it — three times, 4.1MB. Keyed per route +
   ticker, cleared when a new source is parsed. */
const _cache = new Map();
export const clearCache = () => { _cache.clear(); RunLog.debug("api", "cache.clear"); };

const mkt = (route, params = {}) => {
  // Drop undefined/null so they don't serialise as the string "undefined",
  // which would defeat server-side defaults.
  const clean = Object.fromEntries(
    Object.entries({ route, ...params }).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  const url = "/.netlify/functions/mkt?" + new URLSearchParams(clean);
  const key = `${route}:${params.ticker || ""}:${params.from || ""}`;
  if (_cache.has(key)) {
    RunLog.debug("api", "cache.hit", { key });
    return _cache.get(key);
  }
  const p = call(url);
  _cache.set(key, p);
  return p;
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

  /* Short tasks run synchronously. */
  think: (task, text, extra = {}) =>
    call("/.netlify/functions/think", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, text, today: new Date().toISOString().slice(0, 10), ...extra }),
    }),

  /* Theme extraction runs in the background: Opus takes 25-35s on a full
     note and Netlify kills synchronous functions at 26s. Fire, then poll. */
  async thinkLong(task, text, extra = {}, onTick) {
    const jobId = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + "-" + Date.now();
    const t = RunLog.timer("llm", `${task}.job`, { jobId, chars: text.length });

    await fetch("/.netlify/functions/think-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, task, text, today: new Date().toISOString().slice(0, 10), ...extra }),
    });
    RunLog.info("llm", "job.queued", { jobId });

    const deadline = Date.now() + 180000;   // 3 minutes
    let wait = 1200, polls = 0;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 1.15, 4000);
      polls++;
      let doc;
      try { doc = await (await fetch(`/.netlify/functions/think-status?id=${jobId}`)).json(); }
      catch { continue; }

      onTick?.(doc.status, polls, Math.round((Date.now() - (deadline - 180000)) / 1000));

      if (doc.status === "done") {
        if (doc.log) RunLog.absorb(doc.log);
        t.end({ polls, model: doc.result?.model, outTok: doc.result?.usage?.out });
        return doc.result;
      }
      if (doc.status === "failed") {
        if (doc.log) RunLog.absorb(doc.log);
        t.fail(new Error(doc.error || "extraction failed"));
        throw new Error(doc.error || "extraction failed");
      }
    }
    t.fail(new Error("timed out after 3 minutes"));
    throw new Error("Extraction timed out after 3 minutes.");
  },
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
