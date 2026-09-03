/* ═══════════════════════════════════════════════════════════════════
   think-background.mjs

   Opus takes 25-35s on a full Closing Print. Netlify kills synchronous
   functions at 26s, so extraction runs as a background function (15 min
   budget, returns 202 immediately) and writes the result to Blobs. The
   client polls think-status until it lands.

   Same pattern as capture-background.mjs.
   ═══════════════════════════════════════════════════════════════════ */
import { getStore } from "@netlify/blobs";
import { srvLog } from "./_runlog.mjs";
import { SYSTEM_PROMPTS, MODELS, MAX_TOKENS, enforce } from "./_prompts.mjs";

const API = "https://api.anthropic.com/v1/messages";

export default async (request) => {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const L = srvLog("think-bg", apiKey);
  const store = getStore("think-jobs");

  let payload = {};
  try { payload = await request.json(); } catch {}
  const { jobId, task = "themes", text = "", vocab = [], anchors = [], note, today } = payload;
  if (!jobId) { L.error("no jobId", new Error("missing jobId")); return; }

  const put = (doc) => store.setJSON(jobId, { ...doc, jobId, task, at: new Date().toISOString() });

  try {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    if (!text || text.length < 60) throw new Error("source text too short");
    if (text.length > 200000) throw new Error("source text too long");

    await put({ status: "running", log: L.log });
    const MODEL = MODELS[task] || MODELS.themes;
    const system = SYSTEM_PROMPTS[task] || SYSTEM_PROMPTS.themes;
    const user = task === "edit" ? text : [
      `Today is ${today || new Date().toISOString().slice(0, 10)}.`,
      ``,
      `ALLOWED TAG VOCABULARY (tags = sensitivities; use only these):`,
      vocab.join(", "),
      ``,
      `ANCHOR VOCABULARY (anchorTag = the asset traded; use only these):`,
      anchors.join(", "),
      ``,
      note ? `ANALYST NOTE (authoritative — the author speaking directly):\n${note}\n` : "",
      `SOURCE DOCUMENT:`,
      text,
    ].join("\n");

    L.info("prompt", { task, model: MODEL, chars: text.length, vocabTerms: vocab.length, hasNote: Boolean(note) });
    const t0 = Date.now();

    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS[task] || 8000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    const body = await r.json();
    const ms = Date.now() - t0;

    if (!r.ok) {
      const msg = body?.error?.message || `HTTP ${r.status}`;
      L.error("anthropic", new Error(msg));
      await put({ status: "failed", error: msg, log: L.log });
      return;
    }

    const raw = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const truncated = body.stop_reason === "max_tokens";

    let parsed = null, parseError = null;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      parseError = truncated
        ? `Output hit the ${MAX_TOKENS[task]}-token cap and was cut off mid-JSON.`
        : e.message;
    }

    const checks = parsed ? enforce(parsed, { vocab, anchors, sourceText: text }) : { dropped: [], quoteHits: [], attrib: [], badAnchors: [] };
    if (checks.dropped.length)   L.warn("vocab.violation", { dropped: checks.dropped });
    if (checks.quoteHits.length) L.warn("evidence.quoted", { themes: checks.quoteHits });
    if (checks.attrib.length)    L.warn("attribution.suspected", { fields: checks.attrib });
    if (checks.badAnchors?.length) L.warn("anchor.invalid", { themes: checks.badAnchors });
    if (truncated)               L.warn("output.truncated", { outTok: body.usage?.output_tokens });

    L.info("model", {
      model: MODEL, ms, stopReason: body.stop_reason,
      inTok: body.usage?.input_tokens, outTok: body.usage?.output_tokens,
      parsedOk: Boolean(parsed),
      themes: parsed?.themes?.map(t => `${t.direction}:${t.subject}:${t.basis}:${t.anchorTag}:${t.cluster}`),
    });

    await put({
      status: parsed ? "done" : "failed",
      error: parsed ? undefined : parseError,
      result: parsed ? {
        task, model: MODEL, parsed, truncated,
        droppedTags: checks.dropped, quotedEvidenceRejected: checks.quoteHits,
        attributionFlags: checks.attrib,
        usage: { in: body.usage?.input_tokens, out: body.usage?.output_tokens, ms },
      } : undefined,
      raw: parsed ? undefined : cleaned.slice(0, 2000),
      log: L.log,
    });
  } catch (e) {
    L.error("unhandled", e);
    try { await put({ status: "failed", error: e.message, log: L.log }); } catch {}
  }
};
