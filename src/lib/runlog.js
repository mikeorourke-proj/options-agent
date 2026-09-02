/* ═══════════════════════════════════════════════════════════════════
   runlog.js — diagnostic run log for the Tactical Note builder

   Design goals
   ------------
   1. Every number that reaches the PDF is traceable to the call that
      produced it (see RunLog.fact).
   2. Nothing that reaches the log can contain an API key (see redact).
   3. The whole run is downloadable as one JSON file, small enough to
      paste into a chat for diagnosis.
   4. Zero build-step dependencies. Works as a <script> block or an
      ES module.

   Usage
   -----
     RunLog.start("note:TLT");                       // begin a run
     const j = await RunLog.fetch("/api/...");       // auto-logged
     const t = RunLog.timer("calc", "gex");          // manual timing
     t.end({ strikes: 42 });
     RunLog.fact("callWall", 102, { src:"opt.chain", n:1247 });
     RunLog.error("pdf", err);
     RunLog.download();                              // → .json file
   ═══════════════════════════════════════════════════════════════════ */

const RunLog = (() => {
  const MAX_ENTRIES = 3000;      // ring buffer cap
  const MAX_PAYLOAD = 1200;      // chars of any single logged value

  let entries = [];
  let facts   = {};
  let runId   = null;
  let runMeta = {};
  let t0      = Date.now();
  let seq     = 0;
  let console_ = true;           // mirror to devtools

  // ── redaction ────────────────────────────────────────────────────
  // Strips credentials from anything before it is stored. Applied to
  // URLs and to string values inside logged payloads.
  const SECRET_KEYS = /(apikey|api_key|authorization|token|secret|password|x-api-key)/i;

  function redactUrl(u) {
    try {
      const url = new URL(u, location.origin);
      for (const k of [...url.searchParams.keys()]) {
        if (SECRET_KEYS.test(k)) url.searchParams.set(k, "***");
      }
      return url.pathname + url.search;
    } catch {
      return String(u).replace(/([?&](apiKey|api_key|token)=)[^&]+/gi, "$1***");
    }
  }

  function redact(v, depth = 0) {
    if (v == null) return v;
    if (typeof v === "string") {
      const s = v.replace(/([?&](apiKey|api_key|token)=)[^&]+/gi, "$1***");
      return s.length > MAX_PAYLOAD ? s.slice(0, MAX_PAYLOAD) + `…(+${s.length - MAX_PAYLOAD})` : s;
    }
    if (typeof v !== "object") return v;
    if (depth > 4) return "[deep]";
    if (Array.isArray(v)) {
      return v.length > 25
        ? [...v.slice(0, 25).map(x => redact(x, depth + 1)), `…(+${v.length - 25} more)`]
        : v.map(x => redact(x, depth + 1));
    }
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SECRET_KEYS.test(k) ? "***" : redact(val, depth + 1);
    }
    return out;
  }

  // ── core write ───────────────────────────────────────────────────
  function push(lvl, ch, msg, data, err) {
    const e = {
      seq: ++seq,
      dt: Date.now() - t0,
      lvl, ch,
      // msg is redacted too: a raw URL passed here must never carry a key
      msg: typeof msg === "string" ? redact(msg) : msg,
    };
    if (data !== undefined) e.data = redact(data);
    if (err) e.err = { name: err.name, message: err.message, stack: (err.stack || "").split("\n").slice(0, 6).join("\n") };
    entries.push(e);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    if (console_) {
      const fn = lvl === "error" ? console.error : lvl === "warn" ? console.warn : console.log;
      fn(`[${String(e.dt).padStart(6)}ms] ${ch}/${msg}`, data ?? "", err ?? "");
    }
    return e;
  }

  // ── public API ───────────────────────────────────────────────────
  const api = {
    start(label, meta = {}) {
      runId = `${label}:${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
      t0 = Date.now(); seq = 0; entries = []; facts = {};
      runMeta = {
        run: runId, label, startedAt: new Date().toISOString(),
        build: (typeof BUILD_ID !== "undefined" ? BUILD_ID : "dev"),
        ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...meta,
      };
      push("info", "sys", "run.start", { label, ...meta });
      return runId;
    },

    debug: (ch, msg, data) => push("debug", ch, msg, data),
    info:  (ch, msg, data) => push("info",  ch, msg, data),
    warn:  (ch, msg, data) => push("warn",  ch, msg, data),
    error: (ch, msgOrErr, err) =>
      typeof msgOrErr === "string"
        ? push("error", ch, msgOrErr, undefined, err)
        : push("error", ch, msgOrErr?.message || "error", undefined, msgOrErr),

    /* Named timer. t.end(data) writes the elapsed ms. */
    timer(ch, msg, data) {
      const started = Date.now();
      push("debug", ch, msg + ".start", data);
      return {
        end(extra) { return push("info", ch, msg, { ms: Date.now() - started, ...(extra || {}) }); },
        fail(err)  { return push("error", ch, msg + ".fail", { ms: Date.now() - started }, err); },
      };
    },

    /* Instrumented fetch. Logs path, status, latency, size, result count. */
    async fetch(url, opts = {}) {
      const started = Date.now();
      const path = redactUrl(url);
      try {
        const r = await fetch(url, opts);
        const text = await r.text();
        let body; try { body = JSON.parse(text); } catch { body = null; }
        const n = Array.isArray(body?.results) ? body.results.length
                : Array.isArray(body?.points)  ? body.points.length
                : body?.count ?? null;
        push(r.ok ? "info" : "error", "api", path, {
          status: r.status, ms: Date.now() - started, kb: +(text.length / 1024).toFixed(1),
          n, paginated: Boolean(body?.next_url),
          msg: body?.message || body?.error || undefined,
        });
        if (!r.ok) throw new Error(`${r.status} ${path}${body?.message ? " — " + body.message : ""}`);
        return body ?? text;
      } catch (e) {
        push("error", "api", path, { ms: Date.now() - started }, e);
        throw e;
      }
    },

    /* Provenance. Every value that lands on the PDF should pass
       through here, so the note can be audited field by field. */
    fact(key, value, src = {}) {
      facts[key] = { value, ...src, at: Date.now() - t0 };
      push("debug", "fact", key, { value, ...src });
      return value;
    },

    /* LLM calls: log shape and cost, never full prompt text. */
    llm(model, purpose, io = {}) {
      push("info", "llm", `${model}/${purpose}`, {
        ms: io.ms, inTok: io.inTok, outTok: io.outTok,
        promptChars: io.prompt ? io.prompt.length : undefined,
        outPreview: io.output ? String(io.output).slice(0, 200) : undefined,
        parsedOk: io.parsedOk,
      });
    },

    /* Assertion that records rather than throws — for the guardrails
       (min episode count, R² floor, liquidity gate). */
    gate(name, passed, detail) {
      push(passed ? "info" : "warn", "gate", `${name}:${passed ? "pass" : "BLOCK"}`, detail);
      return passed;
    },

    // ── export ─────────────────────────────────────────────────────
    report(compact = false) {
      const errs = entries.filter(e => e.lvl === "error");
      const warns = entries.filter(e => e.lvl === "warn");
      const apis = entries.filter(e => e.ch === "api");
      return {
        ...runMeta,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        summary: {
          entries: entries.length,
          errors: errs.length,
          warnings: warns.length,
          apiCalls: apis.length,
          apiMs: apis.reduce((s, e) => s + (e.data?.ms || 0), 0),
          apiKb: +apis.reduce((s, e) => s + (e.data?.kb || 0), 0).toFixed(1),
          gatesBlocked: entries.filter(e => e.ch === "gate" && /BLOCK/.test(e.msg)).map(e => e.msg),
        },
        firstError: errs[0] || null,
        facts,
        entries: compact ? entries.filter(e => e.lvl !== "debug") : entries,
      };
    },

    download(compact = false) {
      const rep = this.report(compact);
      const blob = new Blob([JSON.stringify(rep, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `runlog_${(runId || "run").replace(/[^\w]/g, "_")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return rep.summary;
    },

    async copy(compact = true) {
      const s = JSON.stringify(this.report(compact));
      try { await navigator.clipboard.writeText(s); return `copied ${(s.length / 1024).toFixed(1)}kb`; }
      catch { window.__runlog = this.report(compact); return "clipboard blocked — run copy(JSON.stringify(window.__runlog))"; }
    },

    /* Merge a server-side log returned by a Netlify function. */
    absorb(serverLog = []) {
      for (const e of serverLog) entries.push({ ...e, seq: ++seq, ch: "srv:" + (e.ch || "fn") });
    },

    mute() { console_ = false; },
    get entries() { return entries; },
    get facts() { return facts; },
    get runId() { return runId; },
  };

  // ── global error capture ───────────────────────────────────────
  if (typeof window !== "undefined") {
    window.addEventListener("error", e => push("error", "window", e.message, { src: e.filename, line: e.lineno }, e.error));
    window.addEventListener("unhandledrejection", e => push("error", "promise", "unhandled rejection", undefined, e.reason instanceof Error ? e.reason : new Error(String(e.reason))));
    window.RunLog = api;
  }
  return api;
})();

export default RunLog;
export { RunLog };
