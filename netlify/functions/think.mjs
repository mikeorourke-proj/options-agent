/* ═══════════════════════════════════════════════════════════════════
   think.mjs — Claude proxy

   Tasks are named and server-defined. The browser sends a task name and
   payload, never a raw prompt, so the model cannot be steered into
   arbitrary behaviour from the client.

   task="thesis"  → parse a written idea into structured trade intent
   task="edit"    → copy-edit analyst prose, preserving voice

   Vehicle mapping is deliberately NOT a free-text ticker request: the
   model returns TAGS drawn from a fixed vocabulary, and the client
   resolves those tags against the curated ETF table. A ticker that is
   not in the table therefore cannot reach the note.
   ═══════════════════════════════════════════════════════════════════ */

import { srvLog } from "./_runlog.mjs";
import { SYSTEM_PROMPTS, MODELS, MAX_TOKENS, enforce } from "./_prompts.mjs";

const API = "https://api.anthropic.com/v1/messages";

export default async (request) => {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const L = srvLog("think", apiKey);
  if (!apiKey) return L.fail(new Error("ANTHROPIC_API_KEY not set"), 500);
  if (request.method !== "POST") return L.fail(new Error("POST required"), 405);

  let payload;
  try { payload = await request.json(); } catch { return L.fail(new Error("bad JSON body"), 400); }

  const { task, text, vocab = [], today } = payload;
  const MODEL = MODELS[task] || MODELS.themes;
  if (!text || typeof text !== "string") return L.fail(new Error("missing text"), 400);
  if (text.length > 120000) return L.fail(new Error("text too long"), 400);

  let system, user;
  if (task === "themes" || task === "thesis") {
    system = SYSTEM_PROMPTS.themes;
    user = `Today is ${today || new Date().toISOString().slice(0, 10)}.

ALLOWED TAG VOCABULARY (use only these):
${vocab.join(", ")}

${payload.note ? `ANALYST NOTE (authoritative — the author speaking directly):\n${payload.note}\n\n` : ""}SOURCE DOCUMENT:
${text}`;
  } else if (task === "edit") {
    system = SYSTEM_PROMPTS.edit;
    user = text;
  } else {
    return L.fail(new Error(`unknown task: ${task}`), 400);
  }

  L.info("prompt", { task, chars: text.length, vocabTerms: vocab.length });
  const started = Date.now();

  try {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS[task] || 4000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    const body = await r.json();
    const ms = Date.now() - started;

    if (!r.ok) {
      L.error("anthropic", new Error(body?.error?.message || `HTTP ${r.status}`));
      return L.respond({ error: body?.error?.message || "model call failed" }, r.status);
    }

    const raw = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

    const truncated = body.stop_reason === "max_tokens";
    let parsed = null, parseError = null;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      parseError = truncated
        ? `Model output hit the ${MAX_TOKENS[task] || 4000}-token cap and was cut off mid-JSON. Shorten the source or raise MAX_TOKENS.`
        : e.message;
    }
    if (truncated) L.warn("output.truncated", { task, maxTokens: MAX_TOKENS[task], outTok: body.usage?.output_tokens });

    /* Enforce the vocabulary server-side. The model is instructed not to
       invent tags; this is the check that it did not. */
    const dropped = [], attrib = [], quoteHits = [];
    if (parsed && Array.isArray(parsed.themes)) {
      const ok = new Set(vocab);

      // Quoted spans in the source. Evidence overlapping one of these is
      // third-party material and is rejected — in this author's commentary
      // the quoted view is usually the one being rebutted.
      const quoted = [...String(text).matchAll(/[\u201C"']([^\u201D"']{25,})[\u201D"']/g)].map(m => m[1]);
      const inQuote = (ev) => quoted.some(q => q.includes(ev.slice(0, 60)) || ev.includes(q.slice(0, 60)));
      const ATTRIB = /\b(said|stated|wrote|according to|noted|argues|reports|per\s+[A-Z])\b/i;

      for (const th of parsed.themes) {
        if (Array.isArray(th.tags)) {
          const before = th.tags;
          th.tags = before.filter(t => ok.has(t));
          dropped.push(...before.filter(t => !ok.has(t)));
        }
        if (th.evidence && inQuote(th.evidence)) {
          quoteHits.push(th.id); th.evidence = ""; th.basis = "extended";
        }
        for (const f of ["rationale", "evidence"]) {
          if (th[f] && ATTRIB.test(th[f])) attrib.push(`${th.id}.${f}`);
        }
      }
    }

    L.info("model", {
      model: MODEL, ms, stopReason: body.stop_reason,
      themes: parsed?.themes?.map(t => `${t.direction}:${t.subject}:${t.basis}`),
      inTok: body.usage?.input_tokens, outTok: body.usage?.output_tokens,
      parsedOk: Boolean(parsed), parseError,
      droppedTags: dropped.length ? dropped : undefined,
      quotedEvidenceRejected: quoteHits.length ? quoteHits : undefined,
      attributionFlags: attrib.length ? attrib : undefined,
      preview: cleaned.slice(0, 180),
    });
    if (dropped.length) L.warn("vocab.violation", { dropped });
    if (quoteHits.length) L.warn("evidence.quoted", { themes: quoteHits, note: "evidence fell inside quoted material and was rejected" });
    if (attrib.length) L.warn("attribution.suspected", { fields: attrib });

    return L.respond({
      task, model: MODEL, parsed, raw: parsed ? undefined : cleaned, parseError,
      droppedTags: dropped, quotedEvidenceRejected: quoteHits, attributionFlags: attrib,
      truncated,
      usage: { in: body.usage?.input_tokens, out: body.usage?.output_tokens, ms },
    });
  } catch (e) {
    return L.fail(e);
  }
};
