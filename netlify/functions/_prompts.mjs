/* Shared prompt + enforcement module. Imported by think.mjs (short
   tasks) and think-background.mjs (theme extraction) so the two cannot
   drift apart. */

/* Transcription is the one task with no reasoning in it — copy the words out,
   in order, changing nothing. Opus spent more than four minutes on a 1 MB
   news-article PDF and never came back inside the client's window, because
   every PDF page reaches the model as an image as well as text and a printed
   web page is many image-heavy pages. Sonnet does verbatim copying just as
   well and materially faster. Revert this one line to claude-opus-5 if the
   transcripts come back worse. */
export const MODELS = {
  themes:     "claude-opus-5",
  thesis:     "claude-opus-5",
  edit:       "claude-opus-5",
  draft:      "claude-opus-5",
  transcribe: "claude-sonnet-5",
  spell:      "claude-opus-5",
};

/* Budgets cover thinking blocks as well as visible output. A draft is only
   ~700 words, but two runs burned all 5,000 tokens on reasoning and were
   cut off before emitting a single text block — the failure looked like a
   parse error when nothing had been written at all. */
export const MAX_TOKENS = { themes: 12000, thesis: 12000, edit: 8000, draft: 16000, transcribe: 16000, spell: 8000 };

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


const DRAFT_SYSTEM = `You draft the commentary for an institutional Tactical Note. You are writing AS the desk's
Chief Market Strategist, in the first person plural.

You receive a JSON model of the note: the themes carried, each with its ETF expression and any
derivatives alternative, with every number already computed. You write prose around those numbers.
You do not compute, adjust, round, or invent any figure.

OUTPUT FORMAT — plain text sections, NOT JSON. English prose contains quotation marks and
apostrophes and must never be wrapped in a JSON string. Use exactly these headers, each on
its own line, in this order, and nothing before the first header or after the last section:

### SUMMARY
<one paragraph, 70-110 words>

### THEME: <subject exactly as given in the model>
<one paragraph, 60-100 words>

(repeat a THEME section for every theme in the model, in the order given)

### EXECUTION
<one paragraph, 70-110 words>

Word limits are enforced. Do not exceed them. No headings inside sections, no bullet points,
no markdown emphasis, no closing remarks.

VOICE — every rule is checked mechanically after you write:
1. CONDITIONAL. "We would be bearish GLD", "we would scale". Never "we are", "we recommend",
   "we like", "buy", "sell" as imperatives. The desk proposes; it does not report a position.
1a. DIRECTION, NOT POSITION. State the view as BEARISH or BULLISH, never as short or long:
   "we would be bearish GLD", not "we would be short GLD". The note carries a view the client
   expresses; it does not put on a trade. This governs the position statement only — "the short
   strike on the 16 put wall" and "a naked short leg" are leg mechanics and stay as they are.
2. ETF FIRST, DERIVATIVE ALONGSIDE. Each theme paragraph opens with the ETF expression, then
   presents the derivatives alternative with its cost and constraint stated plainly. Both appear.
   Neither is argued out of the note.
3. NO RANKING LANGUAGE. Never "best", "preferred", "lead", "strongest", "top", "superior",
   "ranks", or any comparison between expressions or between themes. The client judges. You
   describe each trade on its own terms.
4. NO ATTRIBUTION. Never name a person, firm, bank, publication, or research house. Refer to
   positioning or consensus in the abstract.
5. NO PRICE OBJECTIVES. The model contains no target and you must not construct one. Never
   write "targeting X", "objective", "price target", or a percentage move to a named level.
   Describe the walls as structure, the implied range as the market's measure of a normal
   move, and the stop as what ends the trade.
6. NUMBERS AS GIVEN. Quote the figures from the model verbatim. Cite the walls, the scale
   band and weighted average where the model supplies them, the stop, the risk, the option
   debit and POP. Do not add figures the model does not contain.
7. EXECUTION MODE. Every ETF leg is either scaled or immediate, and the model says which.
   Neither carries a starting price: the last sale is stale by the time the note is read, so
   both open at "current levels". Never write an entry price, and never mention entry
   improvement — the model no longer contains either.
     SCALED — "We would be bearish IBIT, scaling from current levels to 48.00 targeting a
     weighted average execution of 46.96." Cite scaleTo and targetExecution, nothing before them.
     IMMEDIATE — "We would be bearish IBIT at current levels." No band, no ladder, no tranche.
   Call it the STOP-LOSS, not the stop: "The stop-loss at 48.48 ends the trade, 3.2% of risk."
   Give the structure its own sentence rather than trailing it off the stop with "with":
   "The put wall at 40, the call wall at 48 and an implied range of 39 to 51."
   NO CHAIN. A leg carrying "noChain" has no tradeable option market, so it has no walls and no
   implied range. Never mention a wall for it — there is not one. Say the position is shares
   only, that the stop-loss is a flat percentage from entry because there is no wall to stop
   beyond, and give the range as the model labels it in rangeBasis. Do not treat the absence of
   a chain as a reason to soften the view; it is an execution fact, not an argument.
8. EVIDENCE. Where a theme carries an evidence sentence, the paragraph's argument must be
   consistent with it. Do not contradict the source.
9. EXECUTION paragraph is GENERIC. It states the method, not the itinerary. The theme
   paragraphs have already given every leg its own numbers; repeating them here walks the
   reader through the same figures a second time and buys nothing.
     Describe the CONVENTION: a scaled leg is worked as five price-triggered executions at
     equal intervals from current levels to the open-interest wall, weighted 10 / 15 / 20 /
     25 / 30 toward the wall, so the weighted average is only achieved if the market trades
     up into the band and unfilled size stays unfilled; an immediate leg goes on in full at
     current levels with no ladder to wait for; the stop-loss is a close 1% beyond the wall
     the position was scaled into, price-triggered, and it ends the trade rather than
     qualifying the view; option legs price off the current quote at execution, not off the
     debits printed here.
     NAME NO TICKERS AND NO PRICES in this paragraph. Say "the scaled legs" and "the
     immediate leg", not which ones they are. State only which conventions are in play — if
     every leg is scaled, say so and drop the immediate sentence, and the reverse.
   Reference the execute window and hold window as given.
10. Plain, declarative sentences. No hedging filler, no "it is worth noting", no rhetorical
   questions. British spelling of "realised"; otherwise American.`;

/* Transcription exists so that a PDF still produces a SOURCE TEXT the rest of
   the pipeline can police. Handing the PDF straight to the extractor as a
   document block would leave sourceText empty, and enforce() finds quoted
   spans by scanning sourceText — the quoted-evidence rejection would pass
   everything, silently, with no error. So the PDF becomes text first, the
   analyst reads that text, and extraction runs on it unchanged.

   That makes fidelity the whole job here. A paraphrase that drops a pair of
   quotation marks turns material the author is REBUTTING into material the
   author is asserting, which is the direction inversion this tool is built
   to prevent. */
const TRANSCRIBE_SYSTEM = `You transcribe a PDF of market commentary into plain text. You are a
transcriber. You are not an editor, a summariser, or a proofreader.

Return exactly this, with nothing before or after it — no preamble, no commentary, no markdown fences:

### TEXT
<the transcribed text>

RULES

1. VERBATIM. Reproduce the author's sentences exactly as written. Do not summarise, paraphrase,
   condense, reorder, correct, or improve anything. If something reads like a typo, keep the typo.

2. QUOTATION MARKS ARE LOAD-BEARING. Reproduce every quotation mark exactly where it appears and
   in the form it appears, straight or curly. Later stages treat a quoted sentence as a third
   party's view rather than the author's, so a dropped or invented quotation mark reverses the
   meaning of the piece. Never add quotation marks around a sentence that has none.

3. Keep the piece's own title as the first line. Separate paragraphs with a blank line.

4. Rejoin text the layout broke: words split across a line by a hyphen become one word, and lines
   that continue the same sentence become one continuous line. A paragraph should be one block of
   running text.

5. OMIT page furniture — running headers and footers, page numbers, the firm's address block,
   legal disclaimers, distribution boilerplate, contact details, and any "past performance"
   language. None of it is the argument.

6. OMIT tables, charts, exhibits and their captions. Do not carry a number from an exhibit into
   the prose. Leave the prose exactly as it stands.

7. If the document contains no readable text, return the marker and nothing after it.`;

/* Proofreading returns FINDINGS, never prose. The note's prose is full of
   quotation marks and apostrophes and cannot survive a JSON string — the
   first live draft broke at character 3,084 for exactly that reason. Words
   are short tokens and are safe to wrap. It also keeps the model away from
   the sentences: it can point at a typo, it cannot quietly rewrite a
   directional claim or round a number on the way past. */
const SPELL_SYSTEM = `You proofread an institutional research note for SPELLING and typing errors only.

You receive a JSON object of named sections. Return ONLY a JSON array, no preamble, no markdown:

[{ "section": "<the section key exactly as supplied>",
   "wrong": "<the misspelled word, copied character for character>",
   "suggest": "<the correction>",
   "note": "<at most six words, or empty>" }]

Return [] if there is nothing wrong. Prefer returning nothing to guessing.

RULES

1. SPELLING AND TYPOS ONLY. Not grammar, not punctuation, not style, not word choice, not
   capitalisation of ordinary words. Never suggest a better word for a correctly spelled one,
   and never rewrite a phrase. If a sentence reads awkwardly but every word is spelled
   correctly, say nothing.

2. NEVER FLAG: ticker symbols (IBIT, GLD, SLV, TLT, QQQ and any other all-capital symbol);
   market and options vocabulary (theta, vega, gamma, skew, backwardation, contango, straddle,
   strangle, backspread, moneyness, POP, OI, ETF, ETN, repo, CPI, QE); Greek letters and
   symbols; proper nouns; hyphenated compounds that are obviously intentional.

3. British "realised" and "realise" are HOUSE STYLE and correct. Do not suggest the American
   spelling of those. Everything else is American spelling.

4. "wrong" MUST appear verbatim in the section you name, character for character, including
   case. If you cannot copy it exactly, leave it out. A finding that does not match is worse
   than no finding.

5. Report each distinct misspelling once per section.

6. Never report a number, date, price, strike or percentage.`;

/* CONTRA. The analyst is fading the document rather than agreeing with it.

   This is NOT a flip applied after extraction. Reversing a finished theme
   leaves its evidence sentence arguing against its own direction, which is
   the exact incoherence the direction rules exist to prevent, and it would
   sail past every guard because each field is individually well-formed.
   So the document is read correctly FIRST -- what does the author actually
   conclude -- and the contra view is derived from that reading.

   A contra theme is never "stated". The document does not assert it; the
   analyst infers it. enforce() holds that invariant in code. */
const CONTRA_BLOCK = `

CONTRA MODE — THE ANALYST IS FADING THIS DOCUMENT

The analyst disagrees with the document and wants the trade on the other side of it. This does
not change how you READ the document. It changes which direction you return.

C1. Read the document exactly as the rules above require, and work out what the author actually
    concludes. Getting the author's direction right is the whole job — the contra view is
    derived from it, so an inverted reading produces an inverted trade.

C2. Return each theme with the direction OPPOSITE to the author's conclusion. If the author
    concludes AI compute is scarce and the operators are undervalued, the theme is bearish
    those operators.

C3. BASIS IS ALWAYS "extended". Never "stated". The document does not state the contra view —
    the analyst is inferring it against the document. This is not negotiable.

C4. EVIDENCE is the claim BEING FADED: one verbatim sentence from the author's own unquoted
    prose that makes the case you are taking the other side of. Same verbatim rule, same
    prohibition on quoted material. Leave it empty if there is no such sentence.

C5. RATIONALE argues the FADE, in the analyst's voice — why the document's case is wrong,
    overextended, priced, or late. It must not restate the document's argument approvingly.
    Do not name anyone; "consensus" and "positioning" in the abstract, as rule 3 requires.

C6. RISKS are what would invalidate the FADE — which is broadly the document's case being
    right. Name those.

C7. The tradeable-subject rule still binds. Fading an argument about a theme still has to
    become a direction on an asset that can be sold.`;

/* The contra block is appended, never substituted: reading the document
   correctly is a precondition for fading it. */
export function systemFor(task, { contra = false } = {}) {
  const base = SYSTEM_PROMPTS[task] || SYSTEM_PROMPTS.themes;
  if (!contra) return base;
  if (task === "themes" || task === "thesis") return base + CONTRA_BLOCK;
  if (task === "draft") return base + CONTRA_DRAFT;
  return base;
}

/* CONTRA DRAFT. The extractor already returned the faded directions; without
   this the drafter wrote them up as ordinary bearish views and never engaged
   with the document they were taken against, which is the whole point. */
const CONTRA_DRAFT = `

CONTRA NOTE — THIS NOTE FADES A DOCUMENT

The model carries "contra": true. Every theme here is a position AGAINST a piece the desk has
read. A reader who does not know the source must still understand what is being disputed.

D1. THE SUMMARY NAMES THE CASE BEING FADED. Open by stating the argument on the other side — in
    the abstract, as consensus or the prevailing view, never attributed to a person or a firm —
    and then say plainly why the desk does not accept it. A summary that only asserts the
    desk's direction has failed: the disagreement IS the thesis.

D2. EACH THEME PARAGRAPH ENGAGES ITS OWN COUNTERPOINT. Where a theme carries an evidence
    sentence, that sentence is the claim BEING FADED, not support. Say what the claim is, then
    say what is wrong with it — priced, late, extrapolated from a peak, dependent on financing
    that is itself the tell. Never restate the claim approvingly and move on.

D3. DOUBT THE LOAD-BEARING ASSERTIONS. Pick the specific claims the document rests on and name
    what would have to stay true for them to hold. Superlatives and never/always absolutes ("demand
    may never be sated") are the ones to press hardest — say why the extreme framing is itself
    the signal.

D4. NO STRAW MAN. State the other side at its strongest before disputing it. A fade that
    misrepresents the case it fades is worth nothing to a client who has read the source.

D5. RISKS ARE THE DOCUMENT BEING RIGHT. Say so directly.

D6. Everything else still binds: conditional tense, no price objectives, no names, no ranking
    language, the execution rules, the word counts.`;

export const SYSTEM_PROMPTS = {
  draft:      DRAFT_SYSTEM,
  themes:     THEMES_SYSTEM,
  thesis:     THEMES_SYSTEM,
  edit:       EDIT_SYSTEM,
  transcribe: TRANSCRIBE_SYSTEM,
  spell:      SPELL_SYSTEM,
};

/* Voice checks on a draft. Each returns the offending phrase so the UI can
   point at it. These are the rules the prompt states, enforced. */
export const VOICE_CHECKS = [
  /* bearish|bullish added alongside short|long: now that the house wording
     for the view IS "bearish", "we are bearish" becomes the natural drift,
     and rule 1's "never we are" would quietly stop being enforced. */
  { id: "declarative", re: /\b(we are (short|long|bearish|bullish|fading|buying|selling)|we recommend|we like|we prefer)\b/i,
    msg: "declarative voice — use 'we would'" },
  { id: "ranking", re: /\b(best|preferred|lead trade|strongest|superior|top pick|ranks?|outranks?|better than|worse than)\b/i,
    msg: "ranking language" },
  { id: "attribution", re: /\b(said|stated|according to|wrote|reports?|noted that|argues)\b/i,
    msg: "possible attribution" },
  /* "Targeting" is a price objective everywhere except on the weighted
     average execution, which is a level the ladder is built to achieve
     rather than a level the trade is predicting. The house phrasing is
     "targeting a weighted average execution of 46.96", so the check has to
     let that one construction through or it fires on every scaled leg. */
  { id: "objective", re: /\b(?:price target|objective of|target of|our target|targeting(?!\s+(?:a|the)?\s*weighted\s+average\s+execution\b))\b/i,
    msg: "price objective — the note carries none" },
  { id: "stopword", re: /\bstops? at\b/i,
    msg: "house wording is 'stop-loss'" },
  /* Direction, not position. Deliberately anchored on "we would" so it cannot
     touch "the short strike on the 16 put wall" or "a naked short leg", which
     are leg mechanics rather than a statement of the view. */
  { id: "position", re: /\bwe would\s+(?:be\s+|go\s+)?(short|long)\b/i,
    msg: "state the view as bearish or bullish, not short or long" },
  { id: "filler", re: /\b(it is worth noting|needless to say|importantly|interestingly)\b/i,
    msg: "filler" },
];
export function checkVoice(text) {
  const hits = [];
  for (const c of VOICE_CHECKS) {
    const m = String(text || "").match(c.re);
    if (m) hits.push({ id: c.id, msg: c.msg, phrase: m[0] });
  }
  return hits;
}

/* Contextual check: an immediate leg must not acquire a ladder in the prose.
   The generic VOICE_CHECKS cannot see this — "scale" is correct language on a
   scaled leg and wrong on an immediate one, so the test needs the model the
   draft was written from. `ctx` is the draftContext JSON. */
const LADDER = /\b(ladder|ladders|scale|scaled|scaling|tranche|tranches|rung|rungs|improvement)\b/i;

/* The execution paragraph is meant to state the method, not walk the legs.
   "Name no tickers" is exactly the kind of instruction a model half-keeps, so
   it is counted rather than trusted. Tickers come from the model the draft
   was written from, so this cannot fire on an ordinary capitalised word. */
export function checkExecutionGeneric(paras, ctx) {
  const hits = [];
  const body = paras?.execution;
  if (!body) return hits;
  for (const th of ctx?.themes || []) {
    const tk = th?.etf?.ticker;
    if (tk && new RegExp(`\\b${tk}\\b`).test(body))
      hits.push({ id: "generic", msg: "execution paragraph names a leg — state the convention, not each ticker", phrase: tk });
  }
  return hits;
}

export function checkImmediate(paras, ctx) {
  const hits = {};
  const imm = (ctx?.themes || []).filter(t => t?.etf?.execution === "immediate");
  if (!imm.length) return hits;

  for (const th of imm) {
    const add = (k, phrase, msg) => { (hits[k] ||= []).push({ id: "immediate", msg, phrase }); };

    // The theme's own paragraph: no scale language at all.
    const own = paras[th.subject];
    const m = own && own.match(LADDER);
    if (m) add(th.subject, m[0], `${th.etf.ticker} is immediate — no ladder to describe`);

    /* Shared paragraphs legitimately discuss the scaled legs, so only a
       sentence naming this ticker can offend. */
    for (const k of ["summary", "execution"]) {
      for (const sent of String(paras[k] || "").split(/(?<=[.!?])\s+/)) {
        if (!sent.includes(th.etf.ticker)) continue;
        const s = sent.match(LADDER);
        if (s) add(k, s[0], `${th.etf.ticker} is immediate — no ladder to describe`);
      }
    }
  }
  return hits;
}

/* Server-side enforcement of the rules the prompt states. The model is
   told not to break them; this is the check that it did not.

   Quoted spans matter most: in this author's commentary the quoted view
   is usually the one being rebutted, so evidence drawn from inside
   quotation marks is both an attribution risk and an inversion risk. */
export function enforce(parsed, { vocab = [], anchors = [], sourceText = "", contra = false } = {}) {
  const dropped = [], quoteHits = [], attrib = [], badAnchors = [], restated = [];
  if (!parsed || !Array.isArray(parsed.themes)) return { dropped, quoteHits, attrib, badAnchors, restated };

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
    /* A contra theme cannot be "stated": the document does not assert the
       view being taken against it. The prompt says so (C3) and this is the
       check that it held. Marked here rather than trusted, because a theme
       wrongly labelled stated reads as the author's own conclusion
       everywhere downstream. */
    if (contra) {
      th.contra = true;
      if (th.basis === "stated") { restated.push(th.id); th.basis = "extended"; }
    }
    for (const f of ["rationale", "evidence"]) {
      /* Report the phrase, not just the field. A warning reading
         "bullish-dollar.rationale" cannot be triaged from the log — there is
         no way to tell a real attribution from the verb "reports" used about
         economic data without re-running the extraction. checkVoice already
         returns its match; this now does too. */
      const m = th[f] && th[f].match(ATTRIB);
      if (m) attrib.push(`${th.id}.${f}:${m[0]}`);
    }
  }
  return { dropped, quoteHits, attrib, badAnchors, restated };
}
