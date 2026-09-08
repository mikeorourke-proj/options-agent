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

  /* A PDF becomes text before it becomes themes. It is deliberately not fed
     to the extractor as a document block: enforce() finds quoted spans by
     scanning the source text it was sent, so with no text the quoted-evidence
     guard would pass everything and say nothing. Transcribing first keeps the
     guard armed and puts what the model read in front of the analyst. */
  transcribe: (pdf, onTick) => api.thinkLong("transcribe", "", { pdf }, onTick),

  /* Poll an existing job. Split out of thinkLong because a client timeout
     does not stop the work: the background function runs to 15 minutes and
     the blob is never deleted, so the answer is usually sitting there a
     minute after the UI gave up. Callers keep the jobId and come back. */
  async pollJob(task, jobId, onTick, limitMs = 240000) {
    const t = RunLog.timer("llm", `${task}.poll`, { jobId });
    const started = Date.now();
    let wait = 1200, polls = 0;
    while (Date.now() - started < limitMs) {
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 1.15, 4000);
      polls++;
      let doc;
      try { doc = await (await fetch(`/.netlify/functions/think-status?id=${jobId}`)).json(); }
      catch { continue; }

      onTick?.(doc.status, polls, Math.round((Date.now() - started) / 1000));

      if (doc.status === "done") {
        if (doc.log) RunLog.absorb(doc.log);
        t.end({ polls, model: doc.result?.model, outTok: doc.result?.usage?.out });
        return doc.result;
      }
      if (doc.status === "failed") {
        if (doc.log) RunLog.absorb(doc.log);
        if (doc.raw) RunLog.warn("llm", "job.raw", { head: String(doc.raw).slice(0, 600) });
        t.fail(new Error(doc.error || "job failed"));
        throw new Error(doc.error || "job failed");
      }
    }
    /* The jobId travels on the error. Without it the wait is unrecoverable
       even though the result exists. */
    const late = new Error(`still running after ${Math.round(limitMs / 60000)} minutes`);
    late.jobId = jobId;
    late.task = task;
    t.fail(late);
    throw late;
  },

  /* Theme extraction runs in the background: Opus takes 25-35s on a full
     note and Netlify kills synchronous functions at 26s. Fire, then poll.

     The draft has grown — 4,358 output tokens and 54s on v0.15.0, 11,548 and
     120s on v0.16.0 for prose the same length — so the window is four
     minutes, not three. */
  async thinkLong(task, text, extra = {}, onTick) {
    const jobId = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + "-" + Date.now();
    RunLog.info("llm", `${task}.job.start`, { jobId, chars: text.length });

    await fetch("/.netlify/functions/think-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, task, text, today: new Date().toISOString().slice(0, 10), ...extra }),
    });
    RunLog.info("llm", "job.queued", { jobId });

    return api.pollJob(task, jobId, onTick);
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
