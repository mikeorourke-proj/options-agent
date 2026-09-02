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

const MODEL = "claude-sonnet-4-6";
const API = "https://api.anthropic.com/v1/messages";

const THESIS_SYSTEM = `You are a research assistant on an institutional ETF and options trading desk.
Convert the analyst's written idea into structured trade intent.

Return ONLY a JSON object, no preamble, no markdown fences:
{
  "headline": "<= 9 words, declarative, no ticker symbols>",
  "direction": "long" | "short" | "neutral" | "pair",
  "assetClass": "Equity" | "Fixed Income" | "Commodity" | "Currency" | "Volatility" | "Crypto",
  "tags": ["<3-7 terms drawn ONLY from the supplied vocabulary>"],
  "pairShort": ["<tags describing the short leg, ONLY if direction is pair, else []>"],
  "catalyst": { "description": "<short phrase>", "date": "YYYY-MM-DD or null" },
  "horizon": "days" | "weeks" | "months",
  "conviction": "high" | "medium" | "low",
  "rationale": "<one sentence, why this exposure expresses the idea>",
  "risks": ["<2-4 short phrases naming what invalidates the thesis>"]
}

Rules:
- Every entry in "tags" and "pairShort" MUST appear verbatim in the supplied vocabulary. Never invent a tag.
- NEVER output ticker symbols in any field. Vehicle selection happens downstream.
- If no date is stated or clearly implied, set catalyst.date to null. Do not guess a date.
- "risks" must name things that would make the trade lose, not generic market risk.`;

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
  if (!text || typeof text !== "string") return L.fail(new Error("missing text"), 400);
  if (text.length > 12000) return L.fail(new Error("text too long"), 400);

  let system, user;
  if (task === "thesis") {
    system = THESIS_SYSTEM;
    user = `Today is ${today || new Date().toISOString().slice(0, 10)}.

ALLOWED TAG VOCABULARY (use only these):
${vocab.join(", ")}

ANALYST IDEA:
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
        max_tokens: 1500,
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

    let parsed = null, parseError = null;
    try { parsed = JSON.parse(cleaned); } catch (e) { parseError = e.message; }

    /* Enforce the vocabulary server-side. The model is instructed not to
       invent tags; this is the check that it did not. */
    let dropped = [];
    if (parsed && task === "thesis" && vocab.length) {
      const ok = new Set(vocab);
      for (const field of ["tags", "pairShort"]) {
        if (Array.isArray(parsed[field])) {
          const before = parsed[field];
          parsed[field] = before.filter(t => ok.has(t));
          dropped.push(...before.filter(t => !ok.has(t)));
        }
      }
      parsed.tickersScrubbed = false;
    }

    L.info("model", {
      model: MODEL, ms,
      inTok: body.usage?.input_tokens, outTok: body.usage?.output_tokens,
      parsedOk: Boolean(parsed), parseError,
      droppedTags: dropped.length ? dropped : undefined,
      preview: cleaned.slice(0, 180),
    });
    if (dropped.length) L.warn("vocab.violation", { dropped });

    return L.respond({
      task, parsed, raw: parsed ? undefined : cleaned, parseError,
      droppedTags: dropped,
      usage: { in: body.usage?.input_tokens, out: body.usage?.output_tokens, ms },
    });
  } catch (e) {
    return L.fail(e);
  }
};
