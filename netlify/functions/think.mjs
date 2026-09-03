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

const MODELS = {
  themes: "claude-opus-5",
  edit:   "claude-opus-5",
  draft:  "claude-opus-5",
};
const FALLBACK_MODEL = "claude-opus-5";
// Theme extraction returns several objects each carrying a verbatim
// sentence. 1500 truncated mid-string on a 5k-char Closing Print.
const MAX_TOKENS = { themes: 8000, thesis: 8000, edit: 6000, draft: 6000 };
const API = "https://api.anthropic.com/v1/messages";

const THEMES_SYSTEM = `You extract tradeable themes from an institutional strategist's market commentary.

The author is the desk. Everything you output represents THEIR view.

Return ONLY a JSON object, no preamble, no markdown fences:
{
  "sourceTitle": "<the piece's own headline, or a 5-word summary>",
  "themes": [
    {
      "id": "<kebab-case, e.g. bearish-gold>",
      "direction": "bullish" | "bearish" | "neutral",
      "subject": "<2-4 words naming what the view is on, e.g. Gold, Semiconductors, US Treasuries>",
      "tags": ["<2-5 terms from the supplied vocabulary ONLY>"],
      "basis": "stated" | "extended",
      "evidence": "<one verbatim sentence from the AUTHOR'S OWN PROSE supporting this direction; empty string if basis is extended>",
      "rationale": "<one sentence in the author's voice, why this view follows>",
      "catalyst": { "description": "<short phrase or empty>", "date": "YYYY-MM-DD or null" }
    }
  ],
  "primaryThemeId": "<id of the theme carrying the piece's main argument>",
  "risks": ["<2-4 short phrases naming what would invalidate the primary theme>"]
}

CRITICAL RULES

1. DIRECTION. Determine what the AUTHOR concludes, not what the piece describes. Commentary
   frequently sets out a popular view at length in order to reject it. The author's conclusion
   often arrives late in the piece and the title often signals it. If the author argues a trade
   is late, crowded, exhausted, or mistaken, the direction is AGAINST that trade.

2. QUOTED MATERIAL IS NOT EVIDENCE. Any sentence inside quotation marks belongs to a third
   party. It is context only. Never use it as "evidence", and never let it decide direction —
   quoted views are usually the ones being rebutted.

3. NEVER NAME ANYONE. No people, firms, banks, publications, or research houses in ANY field.
   Not in evidence, not in rationale, not in catalyst. Refer to positioning or consensus in the
   abstract. Company names are permitted ONLY where the company is the subject of the trade.

4. EVIDENCE MUST BE VERBATIM from the author's own unquoted prose. Copy it exactly. If no such
   sentence exists, set basis to "extended" and evidence to "".

5. BASIS. "stated" = the author asserts this view. "extended" = a defensible consequence of
   their argument that they did not write. Prefer stated. Mark honestly.

6. TAGS must appear verbatim in the supplied vocabulary. Never invent one.

7. THE ANALYST NOTE, when supplied, is the author speaking directly and is AUTHORITATIVE. It
   overrides the document. It may introduce themes the document never mentions, and those
   themes are basis "stated".

8. LENGTH. Return at most 6 themes, the most tradeable first. "evidence" is ONE sentence.
   "rationale" is ONE sentence. Do not pad.

9. Separate themes by SUBJECT, not by instrument. "Bearish gold" and "bearish silver" are two
   themes. Group instruments of the same underlying asset into one theme.`;

const EDIT_SYSTEM = `You are a copy editor for institutional research at a broker-dealer.
Fix spelling, grammar and punctuation. Tighten wordy phrasing.

Preserve absolutely: the author's voice, all numbers, all tickers, all dates,
every directional claim, and the order of the argument. Do not add facts, do not
add hedging language, do not soften a view, do not introduce new claims.

Return ONLY a JSON object:
{ "edited": "<the corrected text>", "changes": ["<short description of each substantive change>"] }`;

export default async (request) => {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const L = srvLog("think", apiKey);
  if (!apiKey) return L.fail(new Error("ANTHROPIC_API_KEY not set"), 500);
  if (request.method !== "POST") return L.fail(new Error("POST required"), 405);

  let payload;
  try { payload = await request.json(); } catch { return L.fail(new Error("bad JSON body"), 400); }

  const { task, text, vocab = [], today } = payload;
  const MODEL = MODELS[task] || FALLBACK_MODEL;
  if (!text || typeof text !== "string") return L.fail(new Error("missing text"), 400);
  if (text.length > 120000) return L.fail(new Error("text too long"), 400);

  let system, user;
  if (task === "themes" || task === "thesis") {
    system = THEMES_SYSTEM;
    user = `Today is ${today || new Date().toISOString().slice(0, 10)}.

ALLOWED TAG VOCABULARY (use only these):
${vocab.join(", ")}

${payload.note ? `ANALYST NOTE (authoritative — the author speaking directly):\n${payload.note}\n\n` : ""}SOURCE DOCUMENT:
${text}`;
  } else if (task === "edit") {
    system = EDIT_SYSTEM;
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
