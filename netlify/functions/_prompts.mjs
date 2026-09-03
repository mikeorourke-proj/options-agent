/* Shared prompt + enforcement module. Imported by think.mjs (short
   tasks) and think-background.mjs (theme extraction) so the two cannot
   drift apart. */

export const MODELS = {
  themes: "claude-opus-5",
  thesis: "claude-opus-5",
  edit:   "claude-opus-5",
  draft:  "claude-opus-5",
};

export const MAX_TOKENS = { themes: 8000, thesis: 8000, edit: 6000, draft: 6000 };

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
      "anchorTag": "<the ONE vocabulary tag naming the asset this theme trades>",
      "tags": ["<2-5 terms from the supplied vocabulary ONLY, including anchorTag>"],
      "cluster": "<kebab-case id shared by every theme driven by the SAME argument>",
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

8. TRADEABLE SUBJECTS ONLY. Every theme must be a directional view on an asset or asset
   group that can actually be bought or sold, and the direction must be ON THAT ASSET.
   Never create a theme on an abstraction. Translate it into the asset that expresses it:
     "bearish inflation expectations"  -> "bullish US Treasuries"
     "bearish Fed liquidity"           -> "bearish risk assets" or "bullish US Dollar"
     "bullish de-dollarisation"        -> "bearish US Dollar"
   If a driver cannot be translated into a tradeable asset, omit it.

9. ANCHOR TAG. Each theme names the one term identifying the ASSET it trades, chosen from
   the ANCHOR VOCABULARY, which is a separate list from the tag vocabulary. The anchor decides
   which funds are eligible, so it must name what the theme trades, never why.
   Gold -> "gold". Silver -> "silver". Semiconductors -> "semis". Treasuries -> "longbond".
   US Dollar -> "dollar". Bitcoin/crypto -> "crypto". Mega-cap tech -> "nasdaq".
   If no anchor fits the subject, drop the theme rather than forcing a loose one.

10. CLUSTER. Themes that follow from the SAME underlying argument share one cluster id.
   A piece arguing the debasement trade is exhausted yields bearish gold, bearish silver and
   bearish crypto -- three themes, one cluster, because one argument drives all three.

11. LENGTH. At most 6 themes, most tradeable first. "evidence" and "rationale" are ONE
   sentence each. Do not pad.

12. Separate themes by SUBJECT, not by instrument. "Bearish gold" and "bearish silver" are two
   themes. Group instruments of the same underlying asset into one theme.`;

const EDIT_SYSTEM = `You are a copy editor for institutional research at a broker-dealer.
Fix spelling, grammar and punctuation. Tighten wordy phrasing.

Preserve absolutely: the author's voice, all numbers, all tickers, all dates,
every directional claim, and the order of the argument. Do not add facts, do not
add hedging language, do not soften a view, do not introduce new claims.

Return ONLY a JSON object:
{ "edited": "<the corrected text>", "changes": ["<short description of each substantive change>"] }`;


export const SYSTEM_PROMPTS = {
  themes: THEMES_SYSTEM,
  thesis: THEMES_SYSTEM,
  edit:   EDIT_SYSTEM,
};

/* Server-side enforcement of the rules the prompt states. The model is
   told not to break them; this is the check that it did not.

   Quoted spans matter most: in this author's commentary the quoted view
   is usually the one being rebutted, so evidence drawn from inside
   quotation marks is both an attribution risk and an inversion risk. */
export function enforce(parsed, { vocab = [], anchors = [], sourceText = "" } = {}) {
  const dropped = [], quoteHits = [], attrib = [], badAnchors = [];
  if (!parsed || !Array.isArray(parsed.themes)) return { dropped, quoteHits, attrib, badAnchors };

  const ok = new Set(vocab);
  const quoted = [...String(sourceText).matchAll(/[\u201C"']([^\u201D"']{25,})[\u201D"']/g)].map(m => m[1]);
  const inQuote = ev => quoted.some(q => q.includes(ev.slice(0, 60)) || ev.includes(q.slice(0, 60)));
  const ATTRIB = /\b(said|stated|wrote|according to|noted that|argues|reports)\b/i;

  const okAnchor = new Set(anchors);
  for (const th of parsed.themes) {
    if (anchors.length && th.anchorTag && !okAnchor.has(th.anchorTag)) {
      badAnchors.push(`${th.id}:${th.anchorTag}`);
      th.anchorTag = null;      // fall back to tag matching rather than mis-anchor
    }
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
  return { dropped, quoteHits, attrib, badAnchors };
}
