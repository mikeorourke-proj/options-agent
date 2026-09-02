/* ═══════════════════════════════════════════════════════════════════
   _runlog.mjs — server-side companion to runlog.js

   Netlify functions collect their own trace and return it in the
   response envelope as `_log`. The client calls RunLog.absorb(body._log)
   so one downloaded file contains both halves of the run.

   Usage inside a function:

     import { srvLog } from "./_runlog.mjs";

     export default async (request) => {
       const apiKey = Netlify.env.get("POLYGON_API_KEY");
       const L = srvLog("polygon", apiKey);   // secret scoped to the logger
       const data = await L.fetch(url);
       L.info("filter", { before: 1247, after: 412 });
       return L.respond({ results: data });
     };
   ═══════════════════════════════════════════════════════════════════ */

export function srvLog(fnName, secret) {
  const t0 = Date.now();
  const log = [];
  let seq = 0;

  // Every string written to the log passes through here. `secret` is the
  // live API key, scrubbed even when an upstream error echoes it back.
  const strip = (s) => {
    let out = String(s).replace(/([?&](apiKey|api_key|token)=)[^&]+/gi, "$1***");
    if (secret && secret.length > 8) out = out.split(secret).join("***");
    return out;
  };

  const put = (lvl, msg, data, err) => {
    const e = { seq: ++seq, dt: Date.now() - t0, lvl, ch: fnName, msg: strip(msg) };
    if (data !== undefined) e.data = data;
    if (err) e.err = { name: err.name, message: strip(err.message), stack: (err.stack || "").split("\n").slice(0, 4).join("\n") };
    log.push(e);
    // Also emit to Netlify's own function log so it is visible in the dashboard
    console.log(`[${e.dt}ms] ${fnName}/${e.msg}`, data ? JSON.stringify(data).slice(0, 300) : "");
    return e;
  };

  return {
    info:  (m, d) => put("info", m, d),
    warn:  (m, d) => put("warn", m, d),
    error: (m, e) => put("error", m, undefined, e instanceof Error ? e : new Error(String(e))),

    /* Upstream fetch with timing, size, count and key stripping. */
    async fetch(url, opts = {}) {
      const started = Date.now();
      const safe = strip(url);
      try {
        const r = await fetch(url, opts);
        const text = await r.text();
        let body; try { body = JSON.parse(text); } catch { body = null; }
        put(r.ok ? "info" : "error", safe, {
          status: r.status, ms: Date.now() - started,
          kb: +(text.length / 1024).toFixed(1),
          n: Array.isArray(body?.results) ? body.results.length : undefined,
          paginated: Boolean(body?.next_url),
          upstreamMsg: body?.message || undefined,
        });
        return { ok: r.ok, status: r.status, body };
      } catch (e) {
        put("error", safe, { ms: Date.now() - started });
        throw e;
      }
    },

    /* Wrap the payload with the trace and standard CORS/JSON headers. */
    respond(payload, status = 200) {
      return new Response(
        JSON.stringify({ ...payload, _log: log, _ms: Date.now() - t0 }),
        { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    },

    fail(e, status = 500) {
      put("error", "unhandled", undefined, e instanceof Error ? e : new Error(String(e)));
      return this.respond({ error: strip(e?.message || String(e)) }, status);
    },

    get log() { return log; },
  };
}
