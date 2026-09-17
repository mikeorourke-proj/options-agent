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
      "conviction": "<high | medium | low — read the document's OWN intensity, not your enthusiasm. A source that calls something \"a major negative\" for one asset and \"a mild negative\" for another is stating two different convictions and they must not come back the same. high = the document's central claim, stated forcefully (major, sharply, decisively, the key point); medium = argued plainly, no intensifier; low = hedged, secondary, or an implication the document gestures at rather than asserts. If the document gives you nothing to judge by, say medium.>",
      "subject": "<2-4 words naming what the view is on, e.g. Gold, Semiconductors, US Treasuries. NEVER a position word — no Long, Short, Overweight, Underweight, Buying, Selling. The direction is carried separately and a subject of \"Long US Treasuries\" prints as \"BEARISH Long US Treasuries\", which reads as bearish on a long position. Where you mean maturity, say Long-Dated.>",
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

10b. CONVICTION IS READ, NOT ASSUMED. It is the largest single lever in the scoring — it
   shifts the whole distribution by 0.3, 0.6 or 1.0 sigma — so returning "medium" for
   everything discards the document's own emphasis and prices four different views
   identically. A note saying a development is "a mild negative for equities" but "a major
   negative for the investor class who hold crypto and precious metals" has given you three
   convictions, not one. Read them. Do not inflate: high is for the document's central
   claim, and a document usually has one or two, not six.

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
1. THE VIEW IS STATED. THE TRADE IS PROPOSED. Those are two different sentences and they take
   two different tenses.
   The VIEW is indicative and flat: "We are bearish on IBIT." Nothing else — no numbers, no
   mechanics, its own sentence.
   Everything AFTER it stays conditional: "would cost", "would be worked", "the stop-loss ends
   the trade". Never "we recommend", "we like", "we prefer", and never "buy" or "sell" as a
   bare imperative. The desk gives a view and proposes how to express it; it does not report a
   position it holds.
1a. DIRECTION, NOT POSITION. The view is BEARISH or BULLISH, never short or long. "We are
   bearish on GLD", not "we would be short GLD". This governs the statement of the view only —
   "the short strike on the 16 put wall" and "a naked short leg" are leg mechanics and stay as
   they are.
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
   EVERY THEME PARAGRAPH OPENS THE SAME WAY, in exactly two sentences. The view, then the
   execution. Nothing before them.

     SCALED, BEARISH — "We are bearish on IBIT. Look for the opportunity to scale sales from
     current levels to 48.00 targeting a weighted average execution of 46.96."
     SCALED, BULLISH — "We are bullish on TLT. Look for the opportunity to scale purchases from
     current levels to 92.00 targeting a weighted average execution of 90.40."

     IMMEDIATE, BEARISH — "We are bearish on SLV. The wall leaves no room to scale, so look to
     sell at current levels."
     IMMEDIATE, BULLISH — "We are bullish on SLV. The wall leaves no room to scale, so look to
     buy at current levels."

   Cite scaleTo and targetExecution, nothing before them. SALES on a bearish leg, PURCHASES on
   a bullish one — the verb carries the direction and getting it the wrong way round inverts
   the trade. No band, no ladder and no tranche on an immediate leg.
   Call it the STOP-LOSS, not the stop: "The stop-loss at 48.48 ends the trade, 3.2% of risk."
   Give the structure its own sentence rather than trailing it off the stop with "with":
   "The put wall at 40, the call wall at 48 and an implied range of 39 to 51."
   NO CHAIN. A leg carrying "noChain" has no tradeable option market, so it has no walls and no
   implied range. Never mention a wall for it — there is not one, so it cannot "leave no room to
   scale" either. Write it as: "We are bearish on GRID. There is no wall to scale into, so look
   to sell at current levels." Then say the position is shares only, that the stop-loss is a flat
   percentage from entry because there is no wall to stop beyond, and give the range as the model
   labels it in rangeBasis. Do not treat the absence of
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
  /* "We are bearish|bullish on X" is now the REQUIRED opening, so it is not
     in this list — checkThemeOpening enforces its shape instead. What stays
     banned is reporting a position ("we are short GLD") or advising in the
     first person ("we recommend"). */
  { id: "declarative", re: /\b(we are (short|long|fading|buying|selling)|we recommend|we like|we prefer)\b/i,
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

/* Draft rule 7 REQUIRES this exact construction on an immediate leg — "the
   wall leaves no room to scale, so look to sell at current levels" — and
   LADDER flags the word "scale" inside it. So the drafter wrote precisely
   what the prompt demanded and the guard called it a violation, three runs
   in a row. The template arrived in v0.20.0; this check predates it.
   Neutralise the sanctioned phrases before matching. Anything else carrying
   a ladder word still flags.

   Widened once more after GRID: a leg with NO WALL AT ALL cannot say "the
   wall leaves no room to scale" — there is no wall — and scalePlan's own
   reason for that case reads "no wall to scale into", which the drafter
   echoes. The guard was flagging the only honest phrasing available. */
const SANCTIONED = /\b(no room to scale|no wall to scale(?: into)?|nothing to scale(?: into)?|without a wall to scale(?: into)?)\b/gi;

/* Every theme paragraph opens with the same two sentences: the view, then the
   execution. This is checked rather than trusted because both halves can fail
   silently and neither failure looks like an error.

   The view sentence must name the right direction for the right ticker — a
   paragraph headed "We are bullish on IBIT" under a bearish theme is a
   complete inversion that reads perfectly well.

   The execution verb carries the direction too: SALES on a bearish leg,
   PURCHASES on a bullish one. "Scale purchases" under a bearish theme is the
   same inversion arriving one sentence later. */
const OPENING = /^\s*We are (bearish|bullish) on ([A-Za-z0-9.]{1,6})\b/i;

export function checkThemeOpening(paras, ctx) {
  const hits = {};
  for (const th of ctx?.themes || []) {
    const body = paras?.[th.subject];
    const tk = th?.etf?.ticker;
    if (!body || !tk) continue;
    const add = (msg, phrase) => { (hits[th.subject] ||= []).push({ id: "opening", msg, phrase }); };

    const m = body.match(OPENING);
    if (!m) {
      add(`paragraph must open "We are ${th.direction} on ${tk}." as its own sentence`,
          body.slice(0, 48).trim());
      continue;
    }
    if (m[1].toLowerCase() !== String(th.direction).toLowerCase())
      add(`opens ${m[1]} on a ${th.direction} theme — the view is inverted`, m[0].trim());
    if (m[2].toUpperCase() !== tk.toUpperCase())
      add(`opens on ${m[2]} but the leg is ${tk}`, m[0].trim());

    const bear = String(th.direction).toLowerCase() === "bearish";
    const wrongVerb = bear ? /\bscale\s+purchases\b|\blook to buy\b/i
                           : /\bscale\s+sales\b|\blook to sell\b/i;
    const w = body.match(wrongVerb);
    if (w) add(`${w[0]} on a ${th.direction} leg — the execution verb is inverted`, w[0]);
  }
  return hits;
}

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

    // The theme's own paragraph: no scale language beyond the sanctioned phrase.
    const own = paras[th.subject]?.replace(SANCTIONED, "");
    const m = own && own.match(LADDER);
    if (m) add(th.subject, m[0], `${th.etf.ticker} is immediate — no ladder to describe`);

    /* Shared paragraphs legitimately discuss the scaled legs, so only a
       sentence naming this ticker can offend. */
    for (const k of ["summary", "execution"]) {
      for (const sent of String(paras[k] || "").replace(SANCTIONED, "").split(/(?<=[.!?])\s+/)) {
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
  const dropped = [], quoteHits = [], attrib = [], badAnchors = [], restated = [], conflicts = [];
  if (!parsed || !Array.isArray(parsed.themes)) return { dropped, quoteHits, attrib, badAnchors, restated, conflicts };

  const ok = new Set(vocab);
  const quoted = [...String(sourceText).matchAll(/[\u201C"']([^\u201D"']{25,})[\u201D"']/g)].map(m => m[1]);
  const inQuote = ev => quoted.some(q => q.includes(ev.slice(0, 60)) || ev.includes(q.slice(0, 60)));
  const ATTRIB = /\b(said|stated|wrote|according to|noted that|argues|reports)\b/i;

  /* A subject carrying a position word collides with the direction badge.
     "Long US Treasuries" printed as "BEARISH Long US Treasuries" on 17 Sep,
     which reads as bearish on a long position when Long meant long-DATED.

     Where the position word qualifies a maturity-bearing instrument it means
     tenor, so it becomes explicit: Long -> Long-Dated. Everywhere else it is
     a direction word doing a subject's job and is removed, since the badge
     already says which way the trade runs. */
  const MATURITY = /\b(treasur\w*|bonds?|gilts?|bunds?|jgbs?|notes?|duration|credit|coupons?)\b/i;
  const POSITION = /^(long|short|overweight|underweight|buying|selling|bullish|bearish)\s+/i;
  for (const th of parsed.themes) {
    const before = String(th.subject || "");
    /* "Short Duration Credit" and "Long End Rates" are TENOR phrases — the
       word already qualifies a maturity noun and nobody reads them as
       positions. Leave them alone; rewriting gave "Short-Dated Duration
       Credit", which is both redundant and wrong. */
    const TENOR_NEXT = /^(duration|dated|end|maturity|tenor|bond)\b/i;
    const m = TENOR_NEXT.test(before.replace(POSITION, "")) ? null : before.match(POSITION);
    if (m) {
      const word = m[1].toLowerCase();
      const rest = before.slice(m[0].length);

      /* Maturity first: "Long US Treasuries" is a TENOR, not a position, and
         says nothing about direction. Make it explicit and stop. */
      if ((word === "long" || word === "short") && MATURITY.test(rest)) {
        const after = `${word === "long" ? "Long-Dated" : "Short-Dated"} ${rest}`;
        th.subject = after;
        restated.push({ from: before, to: after, why: `"${m[1]}" here means maturity, not a position` });
        continue;
      }

      /* Otherwise the word IS a position, and it either agrees with the
         theme's direction or contradicts it. Those are not the same event
         and must not be handled the same way.

         Agreement is redundancy — the badge says it already, so the word
         goes. Disagreement is a CONFLICT between two fields, and the tool
         has no basis for deciding which is right. The first version of this
         stripped the word either way, which silently resolved "Long Gold" +
         bearish in favour of the direction field and destroyed the only
         evidence that anything was wrong. On 17 Sep the direction field was
         the one that was wrong, so that assumption is not safe.

         A conflict is left ON THE SUBJECT and raised, so it is visible
         rather than tidied away. The direction toggle on the Themes step is
         how it gets resolved. */
      const implied = /^(long|overweight|buying|bullish)$/.test(word) ? "bullish" : "bearish";
      if (implied !== th.direction) {
        conflicts.push({ id: th.id, subject: before, direction: th.direction, implied,
          why: `the subject says "${m[1]}" but the theme is ${th.direction} — one of the two is wrong, and only you can say which` });
        continue;
      }
      if (rest && rest !== before) {
        th.subject = rest;
        restated.push({ from: before, to: rest,
          why: `"${m[1]}" agrees with the ${th.direction} badge and repeating it reads as a double negative` });
      }
    }
  }

  /* Conviction has to be one of three values because DRIFT indexes on it;
     anything else silently falls back to medium inside scoreShares, which is
     the failure this whole field exists to end. */
  const CONV = new Set(["high", "medium", "low"]);
  for (const th of parsed.themes) {
    if (th.conviction && !CONV.has(String(th.conviction).toLowerCase())) {
      restated.push({ from: `conviction ${th.conviction}`, to: "medium",
        why: "conviction must be high, medium or low — DRIFT indexes on it" });
      th.conviction = "medium";
    } else if (th.conviction) {
      th.conviction = String(th.conviction).toLowerCase();
    }
  }

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
  return { dropped, quoteHits, attrib, badAnchors, restated, conflicts };
}


/* ═══════════════════════════════════════════════════════════════════
   checkSourcedClaims — did the draft invent a market fact?

   Every other guard here polices HOW the note says something. None asked
   whether a factual claim came from the source at all.

   On 17 Sep the summary opened "an unexpected hike restores its
   inflation-fighting credibility". The hike was expected. That word is not
   decoration — an unexpected hike restores credibility far more forcefully
   than an expected one, so the invented fact was carrying the argument.

   The words below are CHECKABLE: each asserts something about how a market
   received an event, and the source either says it or does not. They are
   grouped by meaning, so a draft writing "unexpected" is satisfied by a
   source saying "caught markets off guard" — checking the literal word
   would flag every legitimate paraphrase.

   This FLAGS, it does not block. A source can imply surprise without using
   any of these words, and the analyst is the one who knows. But an
   unsourced claim of this kind should never reach a client silently. */
const CLAIM_GROUPS = [
  { id: "surprise",   draft: /\b(unexpected|unanticipated|surprise[ds]?|surprising|shock(?:ed|ing)?|caught .{0,20}off guard|out of nowhere)\b/i,
    source: /\b(unexpected|unanticipated|surprise[ds]?|surprising|shock(?:ed|ing)?|off guard|unforeseen|caught .{0,20}(?:off guard|flat-?footed)|did not expect|no one expected)\b/i },
  { id: "expected",   draft: /\b(as expected|widely expected|fully priced|priced in|telegraphed|well[- ]flagged|consensus had)\b/i,
    source: /\b(expected|anticipated|priced|telegraph\w*|flagged|consensus|forecast\w*|looked for)\b/i },
  { id: "unanimity",  draft: /\b(unanimous(?:ly)?|dissent(?:ed|ing|s)?|split (?:vote|decision)|divided (?:vote|committee))\b/i,
    source: /\b(unanimous\w*|dissent\w*|split|divided|vote[ds]?|\d+\s*[-to]+\s*\d+)\b/i },
  { id: "magnitude",  draft: /\b(record|unprecedented|first time since|largest since|biggest since|steepest since|most since)\b/i,
    source: /\b(record|unprecedented|first time|largest|biggest|steepest|most since|highest since|lowest since)\b/i },
  { id: "emergency",  draft: /\b(emergency|inter[- ]?meeting|unscheduled|crisis (?:cut|hike|move))\b/i,
    source: /\b(emergency|inter[- ]?meeting|unscheduled|crisis)\b/i },
];

export function checkSourcedClaims(paras, sourceText = "") {
  const src = String(sourceText || "");
  const hits = {};
  if (!src.trim()) return hits;              // nothing to check against
  for (const [k, body] of Object.entries(paras || {})) {
    const text = String(body || "");
    for (const g of CLAIM_GROUPS) {
      const m = text.match(g.draft);
      if (!m) continue;
      if (g.source.test(src)) continue;      // the source supports it
      (hits[k] ||= []).push({
        id: "unsourced", phrase: m[0],
        msg: `"${m[0]}" is a claim about how the market received the event, and nothing in the source says it. Check it before this goes out.`,
      });
    }
  }
  return hits;
}
