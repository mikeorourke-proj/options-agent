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


const DRAFT_SYSTEM = `You draft MARKET COMMENTARY for institutional investors. You are writing AS the desk's
Chief Market Strategist, in the first person plural. This is not a research report: it argues
about markets and offers ways the view could be expressed. It does not rate securities, set price
objectives, project outcomes or rank ideas, and every rule below exists to keep it that way.

THE NOTE GIVES THREE THINGS AND STOPS: the SEED of an idea (the argument about the market), the
INSTRUMENTS that could express it (an ETF, and where one is carried, an option structure), and
FACTS ABOUT THE ENVIRONMENT a reader would want before acting (where the open-interest walls sit,
what the option market is pricing, how the vehicle has been trading). How to execute, how much,
when to exit and how long to hold are the reader's decisions, and the note does not make them.

You receive a JSON model of the note: the themes carried, each with its ETF, the wall that frames
an entry, environment facts, and any derivatives alternative, with every number already computed.
You write prose around those numbers. You do not compute, adjust, round, or invent any figure.

OUTPUT FORMAT — plain text sections, NOT JSON. English prose contains quotation marks and
apostrophes and must never be wrapped in a JSON string. Use exactly these headers, each on
its own line, in this order, and nothing before the first header or after the last section:

### SUMMARY
<one paragraph, 70-110 words>

### THEME: <subject exactly as given in the model>
<one paragraph, 70-110 words; up to 135 where the theme carries more than one ETF>

(repeat a THEME section for every theme in the model, in the order given)

There is NO execution section. Do not write one, and do not close with one.
Word limits are enforced. Do not exceed them. No headings inside sections, no bullet points,
no markdown emphasis, no closing remarks.

VOICE — every rule is checked mechanically after you write:
1. THE VIEW IS STATED. EVERYTHING ELSE IS DESCRIBED.
   The VIEW is indicative and flat, and it is a view on the MARKET, not on a ticker: "We are
   bearish on precious metals." Nothing else — no numbers, no mechanics, its own sentence.
   Everything after it describes: an instrument that could express the view, and facts about
   the environment. Never "we recommend", "we like", "we prefer". Never an instruction: no
   "buy", "sell", "look to buy", "look to sell", "investors should", "we would". Where a
   reader's possible action is mentioned at all it is "may" or "could", never "should".
1a. DIRECTION, NOT POSITION. The view is BEARISH or BULLISH, never short or long. "We are
   bearish on gold", not "we would be short GLD". This governs the statement of the view only —
   "the short strike on the 16 put wall" is leg mechanics and stays as it is.
2. ETF FIRST, DERIVATIVE ALONGSIDE. Each theme paragraph names the ETF, then — where the model
   carries an option structure — presents it as an alternative a reader could consider, with
   its cost and constraint stated plainly. Both appear. Neither is argued out of the note.
3. NO RANKING LANGUAGE. Never "best", "preferred", "lead", "strongest", "top", "superior",
   "ranks", or any comparison between expressions or between themes. The client judges.
4. NO ATTRIBUTION. Never name a person, firm, bank, publication, or research house. Refer to
   positioning or consensus in the abstract.
5. NO PRICE OBJECTIVES AND NO TRADE MANAGEMENT. The model contains no target, no entry price,
   no stop and no holding period, and you must not construct any of them. Never write
   "target", "targeting", "objective", "stop", "stop-loss", "risk of X%", "weighted average",
   "ladder", "tranche", "position size", "take profit", "hold for", or a time frame for the
   trade. Describe the walls as structure and the one-month range as the option market's
   measure of a normal move — not as where price is going.
6. NUMBERS AS GIVEN. Quote the figures from the model verbatim and add none it does not
   contain. For an option cite its debit together with its max loss and max gain — never one
   without the other. Never state a probability of profit, a probability of any outcome, or
   an expected return: a projected outcome is not something market commentary may carry.
7. THE SHAPE OF A THEME PARAGRAPH — five moves, in this order.
     (a) CONDITIONS. One or two sentences on what is happening in the market and why it
         matters for the theme, drawn from the evidence. No ticker, no price, no level.
     (b) VIEW. "We are bearish on <the market, in plain words>." Its own sentence, no ticker.
     (c) INSTRUMENT. Copy the theme's expressionSentence EXACTLY. With one ETF it reads "One
         way to express the view is HYG."; with several, "Ways to express the view include
         HYG and JNK." Every ETF in etfs is named there and nowhere before it. Nothing about
         how to trade them, and no comparison between them — they are alternatives the
         reader chooses among.
     (d) THE WALL SENTENCES. For EVERY entry in etfs, copy its wallSentence EXACTLY, word for
         word, each as its own sentence, in the order given. With several ETFs each sentence
         already names its fund ("In HYG, investors looking to trade the idea have…").
         A wall sentence is one of:
           "Investors looking to trade the idea have put-wall support nearby at 77."
           "With put-wall support 9.2% lower, investors looking to trade the idea may prefer
            to scale in opportunistically."
           "Investors looking to trade the idea have call-wall resistance nearby at 79."
           "With call-wall resistance 12.1% higher, investors looking to trade the idea may
            prefer to scale in opportunistically."
         or, where etf.wall is noWall, the sentence saying there is no wall to frame against. Do not
         reword it, do not strengthen "may prefer" to "should", do not add how to scale, how
         many pieces, over what period or to what level. That sentence is the whole of what
         the note says about entering.
     (e) ENVIRONMENT, then the DERIVATIVE. One or two sentences of fact from the model that
         help a reader frame their own execution (with several ETFs, say which fund each
         fact belongs to and keep to one fact apiece): the other wall, the one-month range (say
         whether it is option-implied or from realised volatility, as rangeBasis labels it),
         implied against realised volatility, the average daily move, where price sits in its
         three-month range, the next concentration of open interest beyond the wall. Choose
         the two or three that matter most for this theme; do not list them all. State them
         as facts and draw no instruction from them. Then, if an option structure is carried:
         "Investors who prefer a defined-risk expression could consider the <expiry in words>
         <legs> <structure>, at a debit of X, a maximum loss of X and a maximum gain of Y."
   NO WALL. A leg whose etf.wall is noWall has no level to cite — never give one. Where it
   is also noChain there is no option-implied range either; give the range as rangeBasis
   labels it. Do not treat the
   absence of a chain as a reason to soften the view.
8. EVIDENCE. Where a theme carries an evidence sentence, the paragraph's argument must be
   consistent with it. Do not contradict the source.
9. THE SUMMARY argues the market view across the themes. It names no ticker, no level and no
   instrument, and says nothing about how or when to trade.
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

D6. Everything else still binds: no instructions, no price objectives, no trade management, no
    names, no ranking language, the paragraph shape, the word counts.`;

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
  /* "We are bearish|bullish on <the market>" is a REQUIRED sentence, so it
     is not in this list — checkThemeOpening enforces its shape instead. What stays
     banned is reporting a position ("we are short GLD") or advising in the
     first person ("we recommend"). */
  { id: "declarative", re: /\b(we are (short|long|fading|buying|selling)|we recommend|we like|we prefer)\b/i,
    msg: "reports a position or advises — state the view, describe the rest" },
  { id: "ranking", re: /\b(best|preferred|lead trade|strongest|superior|top pick|ranks?|outranks?|better than|worse than|the better|better (?:vehicle|fund|choice|expression)|(?:more|most) attractive)\b/i,
    msg: "ranking language" },
  { id: "attribution", re: /\b(said|stated|according to|wrote|reports?|noted that|argues)\b/i,
    msg: "possible attribution" },
  /* NO "TARGET" IN ANY FORM (0.37.0). Until then "targeting a weighted
     average execution" was let through as house phrasing. It is market
     commentary now, and "target" is the word a reader — or a regulator —
     takes as a price objective whatever it is attached to. (The weighted
     average itself left the page in 0.38.0.) */
  /* Policy targets are macro facts, not price objectives — "the 2% inflation
     target" is exactly what this author writes about — so those are let
     through; everything else carrying the word flags. */
  { id: "objective", re: /\b(?:price (?:target|objective)s?|objective of|(?<!\b(?:inflation|policy|rate|funds|deficit|growth|employment|mandate|reserve)\s)(?:targets?|targeting|targeted))\b/i,
    msg: "price objective — market commentary carries none, and 'target' reads as one" },
  /* A projected outcome. POP was taken off the page in 0.37.0; the drafter
     no longer receives it, and this catches it arriving anyway. */
  /* Case-sensitive on purpose: "POP" is the metric, "a pop in yields" is prose. */
  { id: "projection", re: /(?:\b[Pp]robability of (?:profit|success|finishing|a gain)|\bPOP\b|\b\d{1,3}(?:\.\d)?% (?:chance|probability|likelihood)|\b[Ee]xpected (?:return|gain|profit))/,
    msg: "projected outcome — market commentary may not carry one" },
  /* EXECUTION AND TRADE MANAGEMENT ARE THE CLIENT'S (0.38.0). Until then the
     paragraph carried an entry, a scale band, a stop and a risk figure, and
     this list policed how they were worded. Now none of them may appear.
     "Scale in opportunistically" is the one sanctioned use of "scale" and is
     checked for context in checkWallSentence; every other mechanism word is
     an instruction arriving by another route. */
  { id: "instruction", re: /\b(?:look(?:ing)? to (?:buy|sell)|scale (?:sales|purchases)|(?:investors|clients|traders|readers|we) (?:should|must|need to)|we would (?:buy|sell|scale)|weighted[- ]average|tranches?|ladders?|rungs?|position siz\w+|take profits?)\b/i,
    msg: "execution instruction — commentary leaves how to trade to the client" },
  { id: "management", re: /\b(?:stop[- ]loss(?:es)?|stops? (?:at|out|beyond)|stopped out|ends the trade|\d+(?:\.\d+)?% of risk|risk of \d|hold(?:ing)? (?:period|window)|hold for|over the hold|execute (?:over|within))\b/i,
    msg: "trade management — commentary carries no stop, risk figure or holding period" },
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

/* Every theme paragraph opens in three moves (0.37.0): MARKET CONDITIONS,
   then the VIEW on the market, then ONE WAY TO EXPRESS IT through the ETF.
   Until 0.36 it opened "We are bearish on GLD." — a call on a security in
   the first five words, which is what a research report looks like. The
   argument now comes first and the vehicle last.

   Checked rather than trusted, because every failure reads perfectly well:
   - the ticker must not appear before the view sentence (a paragraph that
     opens on the vehicle is the old shape back again);
   - the view sentence must exist and carry the theme's direction — "we are
     bullish on gold" under a bearish theme is a complete inversion;
   - the view must not be stated on a ticker;
   - "One way to express the view is <TK>" must name THIS leg's ticker.
   The execution-verb check that lived here is gone with the verbs: 0.38.0
   bans "look to sell" and "scale purchases" outright (VOICE_CHECKS). */
const VIEW = /\bWe are (bearish|bullish) on ([^.;:]+)[.;:]/i;
/* One fund: "One way to express the view is HYG." Several (0.39.0): "Ways to
   express the view include HYG and JNK." Either way the sentence must name
   every fund the theme carries. */
const EXPRESS = /\b(?:One way to express (?:the|this) view is|Ways to express (?:the|this) view include) ([^.;:]+)[.;:]/i;
const fundsOf = th => (th?.etfs?.length ? th.etfs : [th?.etf]).filter(e => e?.ticker);
const tkRe = t => new RegExp(`\\b${String(t).replace(".", "\\.")}\\b`);

export function checkThemeOpening(paras, ctx) {
  const hits = {};
  const tickers = (ctx?.themes || []).flatMap(t => fundsOf(t).map(e => e.ticker));
  for (const th of ctx?.themes || []) {
    const body = paras?.[th.subject];
    const mine = fundsOf(th).map(e => e.ticker);
    if (!body || !mine.length) continue;
    const add = (msg, phrase) => { (hits[th.subject] ||= []).push({ id: "opening", msg, phrase }); };

    const v = body.match(VIEW);
    if (!v) {
      add(`paragraph needs the view as its own sentence — "We are ${th.direction} on <the market>." — after the market conditions`,
          body.slice(0, 48).trim());
    } else {
      if (v[1].toLowerCase() !== String(th.direction).toLowerCase())
        add(`states a ${v[1].toLowerCase()} view on a ${th.direction} theme — the view is inverted`, v[0].trim());
      /* Case-sensitive: a ticker is upper case, and "grid infrastructure" is
         a market, not GRID. */
      const onTicker = tickers.find(t => new RegExp(`^\\s*${t.replace(".", "\\.")}\\b`).test(v[2]));
      if (onTicker)
        add(`the view is stated on ${onTicker} — state it on the market, and name the ETF as one way to express it`, v[0].trim());
      if (v.index === 0 || !body.slice(0, v.index).trim())
        add("paragraph opens on the view — lead with the market conditions that support it", v[0].trim());
      const early = tickers.find(t => tkRe(t).test(body.slice(0, v.index)));
      if (early) add(`${early} is named before the view — the vehicle comes after the argument`, early);
    }

    const e = body.match(EXPRESS);
    const want = mine.length > 1 ? `Ways to express the view include ${mine.join(", ")}` : `One way to express the view is ${mine[0]}`;
    if (!e) add(`paragraph must name the vehicle${mine.length > 1 ? "s" : ""} as "${want}"`, mine.join(", "));
    else {
      /* Every fund the analyst selected must be offered, and nothing else:
         a fund left out is a selection silently dropped, and a fund added is
         one the model was never given levels for. */
      const missing = mine.filter(t => !tkRe(t).test(e[1]));
      const foreign = (e[1].match(/\b[A-Z][A-Z0-9.]{1,5}\b/g) || []).filter(t => !mine.includes(t));
      if (missing.length) add(`${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} carried but not named as a way to express the view`, e[0].trim());
      if (foreign.length) add(`names ${foreign.join(", ")}, which ${foreign.length > 1 ? "are" : "is"} not carried under this theme (${mine.join(", ")})`, e[0].trim());
      if (v && e.index < v.index) add("the vehicle is named before the view", e[0].trim());
    }
  }
  return hits;
}

/* THE WALL SENTENCE (0.38.0) — the whole of what the note says about
   entering, so it is the one sentence that must not drift.

   compose builds it (environment.js: put wall for a buyer, call wall for a
   seller, "nearby" inside 7%, "scale in opportunistically" beyond) and the
   drafter is told to copy it. Checked rather than trusted, because each way
   of getting it wrong reads perfectly well:
   - the wrong wall for the direction — "call-wall resistance" under a
     bullish theme is the framing for the opposite trade;
   - "nearby" with a scale-in, or a scale-in with no distance: the 7% rule
     applied the wrong way round;
   - "may prefer" hardened into "should" (caught by VOICE_CHECKS as well);
   - a wall level quoted for a vehicle that has no chain;
   - "scale" anywhere outside the sanctioned phrase — the old ladder
     language finding its way back. */
const norm = x => String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
const SCALE_OK = /scale in opportunistically/gi;

export function checkWallSentence(paras, ctx) {
  const hits = {};
  for (const th of ctx?.themes || []) {
    const body = paras?.[th.subject];
    const funds = fundsOf(th).filter(e => e.wall);
    if (!body || !funds.length) continue;
    const add = (msg, phrase) => { (hits[th.subject] ||= []).push({ id: "wall", msg, phrase }); };
    const bull = String(th.direction).toLowerCase() === "bullish";

    const stray = body.replace(SCALE_OK, "").match(/\bscal(?:e|ed|es|ing)\b/i);
    if (stray) add('"scale" outside "scale in opportunistically" — the note describes no scaling mechanics', stray[0]);

    /* The wrong wall for the direction. Every fund under a theme shares the
       theme's direction, so this is a paragraph-level test. */
    const wrong = bull ? /\bcall[- ]wall (?:support|resistance) (?:nearby|\d)/i : /\bput[- ]wall (?:support|resistance) (?:nearby|\d)/i;
    const wr = body.match(wrong);
    if (wr) add(`${wr[0]} frames the entry on the wrong wall for a ${th.direction} view`, wr[0]);

    /* EVERY fund carried has its sentence (0.39.0), verbatim. */
    for (const f of funds) {
      const want = f.wallSentence;
      if (!want || norm(body).includes(norm(want))) continue;
      const mentions = tkRe(f.ticker).test(body) && /\b(?:put|call)[- ]wall\b/i.test(body);
      add(`${funds.length > 1 ? f.ticker + ": " : ""}wall sentence ${mentions && !f.wall.noWall ? "reworded or missing" : "missing"} — the paragraph must carry: "${want}"`,
          (body.match(/[^.]*\b(?:put|call)[- ]wall[^.]*\./i) || [body.slice(0, 48)])[0].trim());
    }

    /* No fund under the theme has a wall, so no LEVEL may be cited at all.
       The sanctioned sentences say "no put-wall support", which is why this
       looks for a level or "nearby" rather than the bare phrase. */
    if (funds.every(f => f.wall.noWall)) {
      const lvl = body.match(/\b(?:put|call)[- ]wall (?:support|resistance) (?:nearby|at|\d)[^.]*/i);
      if (lvl) add(`no fund here has a wall on that side — there is no level to cite`, lvl[0].trim());
    }
    /* "Scale in" belongs to a wall that is AWAY. If none is, the 7% rule
       has been applied the wrong way round. */
    if (!funds.some(f => f.wall.proximity === "away") && SCALE_OK.test(body))
      add("no wall here is beyond the 7% band — the sentence is about the level, not about scaling in", "scale in opportunistically");
    SCALE_OK.lastIndex = 0;
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
