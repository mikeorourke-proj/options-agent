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
import { SYSTEM_PROMPTS, MODELS, MAX_TOKENS, enforce, checkVoice, checkImmediate } from "./_prompts.mjs";

const API = "https://api.anthropic.com/v1/messages";

export default async (request) => {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const L = srvLog("think-bg", apiKey);
  const store = getStore("think-jobs");

  let payload = {};
  try { payload = await request.json(); } catch {}
  const { jobId, task = "themes", text = "", vocab = [], anchors = [], note, today, pdfKey, pdfName } = payload;
  if (!jobId) { L.error("no jobId", new Error("missing jobId")); return; }

  const put = (doc) => store.setJSON(jobId, { ...doc, jobId, task, at: new Date().toISOString() });
  let pdfB64 = null;

  try {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    if (task === "transcribe") {
      /* The PDF arrives by reference. It cannot arrive by value: this
         function is invoked asynchronously and that invoke's body limit is
         far below the 6 MB a synchronous function accepts, so a 1 MB PDF
         base64'd into the payload was rejected before any of this ran.
         pdf-stash puts the bytes in Blobs; only the key travels. */
      if (!pdfKey) throw new Error("no PDF key supplied");
      pdfB64 = await getStore("pdf-uploads").get(pdfKey, { type: "text" });
      if (!pdfB64) throw new Error("the uploaded PDF was not found under its key");
      L.info("pdf.loaded", { key: pdfKey, name: pdfName, b64KB: Math.round(pdfB64.length / 1024) });
    } else {
      if (!text || text.length < 60) throw new Error("source text too short");
      if (text.length > 200000) throw new Error("source text too long");
    }

    await put({ status: "running", log: L.log });
    const MODEL = MODELS[task] || MODELS.themes;
    const system = SYSTEM_PROMPTS[task] || SYSTEM_PROMPTS.themes;
    const user = task === "edit" ? text
      : task === "draft" ? `NOTE MODEL:\n${text}`
      : task === "transcribe" ? "Transcribe this document."
      : task === "spell" ? `SECTIONS:\n${text}`
      : [
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

    /* A PDF goes up as a document block alongside the instruction. Everything
       else is a plain string. */
    const content = task === "transcribe"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
         { type: "text", text: user }]
      : user;

    L.info("prompt", task === "transcribe"
      ? { task, model: MODEL, file: pdfName, b64KB: Math.round(pdfB64.length / 1024) }
      : { task, model: MODEL, chars: text.length, vocabTerms: vocab.length, hasNote: Boolean(note) });
    const t0 = Date.now();

    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS[task] || 8000,
        system,
        messages: [{ role: "user", content }],
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

    const blocks = (body.content || []).map(b => b.type);
    const raw = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!raw) L.warn("model.no.text", { blocks, outTok: body.usage?.output_tokens, stopReason: body.stop_reason });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const truncated = body.stop_reason === "max_tokens";

    let parsed = null, parseError = null;
    if (task === "draft") {
      /* Prose comes back as delimited sections, not JSON — a quotation mark
         in a sentence must not be able to break the whole draft. */
      const secs = [...raw.matchAll(/^###\s*(SUMMARY|EXECUTION|THEME:\s*(.+?))\s*$\n([\s\S]*?)(?=^###\s|\s*$)/gim)];
      if (secs.length) {
        parsed = { summary: "", themes: {}, execution: "" };
        for (const m of secs) {
          const body = m[3].trim().replace(/\s*\n\s*/g, " ");
          if (/^SUMMARY/i.test(m[1])) parsed.summary = body;
          else if (/^EXECUTION/i.test(m[1])) parsed.execution = body;
          else if (m[2]) parsed.themes[m[2].trim()] = body;
        }
        const wc = t => (t || "").split(/\s+/).filter(Boolean).length;
        L.info("draft.sections", { summary: wc(parsed.summary), execution: wc(parsed.execution),
                                   themes: Object.fromEntries(Object.entries(parsed.themes).map(([k, v]) => [k, wc(v)])) });
        /* A truncated draft still has complete sections before the cut.
           Keep them and say which are missing rather than discarding the lot. */
        const missing = [];
        if (!parsed.summary) missing.push("summary");
        if (!parsed.execution) missing.push("execution");
        if (missing.length) {
          L.warn("draft.partial", { missing, got: Object.keys(parsed.themes), truncated });
          parsed.partial = missing;
        }
        if (!parsed.summary && !Object.keys(parsed.themes).length) {
          parseError = "draft returned no usable sections"; parsed = null;
        }
      } else {
        parseError = truncated ? `Output hit the ${MAX_TOKENS[task]}-token cap.` : "draft returned no recognisable sections";
      }
    } else if (task === "transcribe") {
      /* Delimited, not JSON — the same reason the draft is: transcribed prose
         is full of quotation marks and apostrophes and cannot survive being
         wrapped in a JSON string. */
      const m = raw.match(/^###\s*TEXT\s*$\n([\s\S]*)/im);
      const out = (m ? m[1] : raw)
        .replace(/^\s*```[a-z]*\s*$/gim, "")   // a fence the prompt did not ask for
        .trim();
      if (out.length < 200) {
        parseError = truncated
          ? `Output hit the ${MAX_TOKENS.transcribe}-token cap.`
          : "the PDF returned no readable text — it is probably a scan with no text layer";
      } else {
        if (!m) L.warn("transcribe.no.marker", { head: raw.slice(0, 140) });
        parsed = { text: out };
        /* Quote count is provenance, not decoration. The quoted-span guard
           downstream is only as good as the marks that survived this step,
           so a run that reads zero is worth seeing in the log. */
        L.info("transcribe", {
          file: pdfName,
          chars: out.length,
          words: out.split(/\s+/).filter(Boolean).length,
          paras: out.split(/\n\s*\n/).filter(p => p.trim()).length,
          quoteMarks: (out.match(/["\u201C\u201D]/g) || []).length,
          truncated,
        });
      }
    } else {
      try { parsed = JSON.parse(cleaned); }
      catch (e) {
        parseError = truncated
          ? `Output hit the ${MAX_TOKENS[task]}-token cap and was cut off mid-JSON.`
          : e.message;
      }
    }

    const checks = parsed && (task === "themes" || task === "thesis")
                 ? enforce(parsed, { vocab, anchors, sourceText: text })
                 : { dropped: [], quoteHits: [], attrib: [], badAnchors: [] };
    // Draft: run the voice checks on every paragraph and report them back.
    let voice = null;
    if (parsed && task === "draft") {
      voice = {};
      const paras = { summary: parsed.summary, execution: parsed.execution, ...(parsed.themes || {}) };
      for (const [k, v] of Object.entries(paras)) { const h = checkVoice(v); if (h.length) voice[k] = h; }
      /* Whether "scale" is a violation depends on the leg, so this check needs
         the model the draft was written from, not just the paragraph. */
      try {
        const ctx = JSON.parse(text);
        for (const [k, h] of Object.entries(checkImmediate(paras, ctx))) voice[k] = [...(voice[k] || []), ...h];
      } catch (e) { L.warn("immediate.check.skipped", { message: e.message }); }
      if (Object.keys(voice).length) L.warn("voice.violation", voice);
    }
    if (parsed && task === "spell")
      L.info("spell", { findings: Array.isArray(parsed) ? parsed.length : "not an array",
                        words: Array.isArray(parsed) ? parsed.map(x => `${x.section}:${x.wrong}→${x.suggest}`) : undefined });
    if (checks.dropped.length)   L.warn("vocab.violation", { dropped: checks.dropped });
    if (checks.quoteHits.length) L.warn("evidence.quoted", { themes: checks.quoteHits });
    if (checks.attrib.length)    L.warn("attribution.suspected", { fields: checks.attrib });
    if (checks.badAnchors?.length) L.warn("anchor.invalid", { themes: checks.badAnchors });
    if (truncated)               L.warn("output.truncated", { outTok: body.usage?.output_tokens });

    /* Diagnostics must never be able to discard a good result: themes is an
   array for extraction and an object for a draft, and a log line that
   assumed the array killed a complete note. */
    try {
      L.info("model", {
        model: MODEL, ms, stopReason: body.stop_reason, blocks, rawChars: raw.length,
        inTok: body.usage?.input_tokens, outTok: body.usage?.output_tokens,
        parsedOk: Boolean(parsed),
        themes: Array.isArray(parsed?.themes)
          ? parsed.themes.map(t => `${t.direction}:${t.subject}:${t.basis}:${t.anchorTag}:${t.cluster}`)
          : parsed?.themes ? Object.keys(parsed.themes) : undefined,
      });
    } catch (logErr) {
      L.warn("model.log.failed", { message: logErr.message });
    }

    await put({
      status: parsed ? "done" : "failed",
      error: parsed ? undefined : parseError,
      result: parsed ? {
        task, model: MODEL, parsed, truncated,
        droppedTags: checks.dropped, quotedEvidenceRejected: checks.quoteHits,
        attributionFlags: checks.attrib, voice,
        usage: { in: body.usage?.input_tokens, out: body.usage?.output_tokens, ms },
      } : undefined,
      raw: parsed ? undefined : cleaned.slice(0, 3000),
      log: L.log,
    });
  } catch (e) {
    L.error("unhandled", e);
    try { await put({ status: "failed", error: e.message, log: L.log }); } catch {}
  } finally {
    /* The stash is a hand-off, not storage. Clear it whether the read
       succeeded or not so a megabyte per upload does not accumulate. */
    if (pdfKey) { try { await getStore("pdf-uploads").delete(pdfKey); } catch {} }
  }
};
