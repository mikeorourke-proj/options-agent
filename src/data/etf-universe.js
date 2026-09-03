/* ═══════════════════════════════════════════════════════════════════
   etf-universe.js — the curated vehicle table

   Why this file exists: ETF Global /taxonomies returns 403 on the
   current plan, and /v1/related-companies returns nothing for funds.
   So classification is retrieval from this table, never LLM recall.
   Claude selects FROM this list; it never invents a ticker.

   `liq` is a qualitative options-liquidity grade, verified against the
   chain probe:
     A  deep chain, tight markets, weeklies       → any structure
     B  usable chain, wider markets               → verticals, outrights
     C  thin chain                                → outrights only, size down
     X  no usable options (empty greeks / zero OI) → shares only

   Keep `lev` honest: decay makes 2x/3x unsuitable beyond a few days.
   ═══════════════════════════════════════════════════════════════════ */

export const ETF_UNIVERSE = [
  // ── Broad US equity ──────────────────────────────────────────────
  { t:"SPY", a:["sp500"],  n:"SPDR S&P 500",                    cls:"Equity", grp:"US Large Cap",   liq:"A", tags:["sp500","beta","core","hedge"] },
  { t:"VOO", a:["sp500"],  n:"Vanguard S&P 500",                cls:"Equity", grp:"US Large Cap",   liq:"C", tags:["sp500","beta","core"] },
  { t:"IVV", a:["sp500"],  n:"iShares Core S&P 500",            cls:"Equity", grp:"US Large Cap",   liq:"C", tags:["sp500","beta","core"] },
  { t:"QQQ", a:["nasdaq"],  n:"Invesco QQQ (Nasdaq 100)",        cls:"Equity", grp:"US Large Cap",   liq:"A", tags:["nasdaq","tech","growth","momentum"] },
  { t:"IWM", a:["smallcap"],  n:"iShares Russell 2000",            cls:"Equity", grp:"US Small Cap",   liq:"A", tags:["smallcap","domestic","highbeta","credit-sensitive"] },
  { t:"DIA", a:["dow"],  n:"SPDR Dow Jones Industrial",       cls:"Equity", grp:"US Large Cap",   liq:"B", tags:["dow","value","industrials"] },
  { t:"RSP", a:["sp500", "equalweight"],  n:"Invesco S&P 500 Equal Weight",    cls:"Equity", grp:"US Large Cap",   liq:"X", tags:["equalweight","breadth","anti-concentration"] },
  { t:"MDY", a:["midcap"],  n:"SPDR S&P MidCap 400",             cls:"Equity", grp:"US Mid Cap",     liq:"C", tags:["midcap","domestic"] },
  { t:"VTV", a:["value"],  n:"Vanguard Value",                  cls:"Equity", grp:"Style",          liq:"C", tags:["value","factor"] },
  { t:"VUG", a:["growth"],  n:"Vanguard Growth",                 cls:"Equity", grp:"Style",          liq:"C", tags:["growth","factor"] },
  { t:"MTUM", a:["momentum"], n:"iShares MSCI USA Momentum",       cls:"Equity", grp:"Style",          liq:"C", tags:["momentum","factor"] },
  { t:"USMV", a:["lowvol"], n:"iShares MSCI USA Min Vol",        cls:"Equity", grp:"Style",          liq:"C", tags:["lowvol","defensive","factor"] },

  // ── US sectors ───────────────────────────────────────────────────
  { t:"XLF", a:["financials"],  n:"Financial Select Sector",         cls:"Equity", grp:"Sector",  liq:"A", tags:["financials","banks","rates","steepener"] },
  { t:"KBWB", a:["banks"], n:"Invesco KBW Bank",                cls:"Equity", grp:"Sector",  liq:"C", tags:["banks","regional","rates"] },
  { t:"KRE", a:["banks"],  n:"SPDR S&P Regional Banking",       cls:"Equity", grp:"Sector",  liq:"B", tags:["banks","regional","credit","rates"] },
  { t:"XLK", a:["tech"],  n:"Technology Select Sector",        cls:"Equity", grp:"Sector",  liq:"A", tags:["tech","software","semis","growth"] },
  { t:"SMH", a:["semis"],  n:"VanEck Semiconductor",            cls:"Equity", grp:"Sector",  liq:"A", tags:["semis","ai","cyclical","taiwan"] },
  { t:"SOXX", a:["semis"], n:"iShares Semiconductor",           cls:"Equity", grp:"Sector",  liq:"B", tags:["semis","ai","cyclical"] },
  { t:"XLE", a:["energy"],  n:"Energy Select Sector",            cls:"Equity", grp:"Sector",  liq:"A", tags:["energy","oil","inflation","commodity"] },
  { t:"OIH", a:["energy"],  n:"VanEck Oil Services",             cls:"Equity", grp:"Sector",  liq:"B", tags:["oil","services","highbeta"] },
  { t:"XOP", a:["energy"],  n:"SPDR Oil & Gas E&P",              cls:"Equity", grp:"Sector",  liq:"B", tags:["oil","shale","highbeta"] },
  { t:"XLV", a:["healthcare"],  n:"Health Care Select Sector",       cls:"Equity", grp:"Sector",  liq:"B", tags:["healthcare","defensive"] },
  { t:"XBI", a:["biotech"],  n:"SPDR S&P Biotech",                cls:"Equity", grp:"Sector",  liq:"B", tags:["biotech","highbeta","rates-sensitive"] },
  { t:"IBB", a:["biotech"],  n:"iShares Biotechnology",           cls:"Equity", grp:"Sector",  liq:"C", tags:["biotech","largecap"] },
  { t:"XLI", a:["industrials"],  n:"Industrial Select Sector",        cls:"Equity", grp:"Sector",  liq:"B", tags:["industrials","cyclical","capex"] },
  { t:"ITA", a:["defense"],  n:"iShares US Aerospace & Defense",  cls:"Equity", grp:"Sector",  liq:"C", tags:["defense","aerospace","geopolitics"] },
  { t:"XLP", a:["staples"],  n:"Consumer Staples Select",         cls:"Equity", grp:"Sector",  liq:"B", tags:["staples","defensive"] },
  { t:"XLY", a:["discretionary"],  n:"Consumer Discretionary Select",   cls:"Equity", grp:"Sector",  liq:"B", tags:["discretionary","consumer","cyclical"] },
  { t:"XRT", a:["retail"],  n:"SPDR S&P Retail",                 cls:"Equity", grp:"Sector",  liq:"B", tags:["retail","consumer","shortinterest"] },
  { t:"XLU", a:["utilities"],  n:"Utilities Select Sector",         cls:"Equity", grp:"Sector",  liq:"B", tags:["utilities","defensive","rates","power","ai-power"] },
  { t:"XLB", a:["materials"],  n:"Materials Select Sector",         cls:"Equity", grp:"Sector",  liq:"B", tags:["materials","commodity","cyclical"] },
  { t:"XLRE", a:["reits"], n:"Real Estate Select Sector",       cls:"Equity", grp:"Sector",  liq:"B", tags:["reits","rates","duration"] },
  { t:"XLC", a:["media"],  n:"Communication Services Select",   cls:"Equity", grp:"Sector",  liq:"B", tags:["media","internet","telecom"] },
  { t:"XME", a:["mining"],  n:"SPDR S&P Metals & Mining",        cls:"Equity", grp:"Sector",  liq:"B", tags:["mining","steel","commodity","china"] },
  { t:"JETS", a:["airlines"], n:"US Global Jets",                  cls:"Equity", grp:"Sector",  liq:"C", tags:["airlines","travel","oil-sensitive"] },
  { t:"IYR", a:["reits"],  n:"iShares US Real Estate",          cls:"Equity", grp:"Sector",  liq:"B", tags:["reits","rates","duration"] },

  // ── Rates & credit ───────────────────────────────────────────────
  { t:"TLT", a:["longbond", "treasuries"],  n:"iShares 20+ Year Treasury",       cls:"Fixed Income", grp:"Rates",  liq:"A", dur:17.4, tags:["duration","longbond","rates","deflation","flight-to-quality"] },
  { t:"IEF", a:["treasuries"],  n:"iShares 7-10 Year Treasury",      cls:"Fixed Income", grp:"Rates",  liq:"B", dur:7.3,  tags:["duration","belly","rates"] },
  { t:"SHY", a:["treasuries"],  n:"iShares 1-3 Year Treasury",       cls:"Fixed Income", grp:"Rates",  liq:"C", dur:1.9,  tags:["frontend","cash","fed"] },
  { t:"VGLT", a:["longbond", "treasuries"], n:"Vanguard Long-Term Treasury",     cls:"Fixed Income", grp:"Rates",  liq:"C", dur:15.2, tags:["duration","longbond","cheap"] },
  { t:"EDV", a:["longbond", "treasuries"],  n:"Vanguard Extended Duration",      cls:"Fixed Income", grp:"Rates",  liq:"C", dur:24.1, tags:["duration","zerocoupon","highbeta-rates"] },
  { t:"ZROZ", a:["longbond", "treasuries"], n:"PIMCO 25+ Yr Zero Coupon",        cls:"Fixed Income", grp:"Rates",  liq:"C", dur:26.0, tags:["duration","zerocoupon","convexity"] },
  { t:"GOVT", a:["treasuries"], n:"iShares US Treasury Bond",        cls:"Fixed Income", grp:"Rates",  liq:"C", dur:6.0,  tags:["broad-treasury"] },
  { t:"TIP", a:["tips"],  n:"iShares TIPS Bond",               cls:"Fixed Income", grp:"Rates",  liq:"C", dur:6.8,  tags:["inflation","breakevens","real-rates"] },
  { t:"STIP", a:["tips"], n:"iShares 0-5 Year TIPS",           cls:"Fixed Income", grp:"Rates",  liq:"C", dur:2.5,  tags:["inflation","frontend"] },
  { t:"LQD", a:["ig-credit"],  n:"iShares iBoxx Inv Grade Corp",    cls:"Fixed Income", grp:"Credit", liq:"B", dur:8.4,  tags:["credit","IG","spread","duration"] },
  { t:"HYG", a:["hy-credit"],  n:"iShares iBoxx High Yield Corp",   cls:"Fixed Income", grp:"Credit", liq:"A", dur:3.2,  tags:["credit","HY","spread","risk-appetite"] },
  { t:"JNK", a:["hy-credit"],  n:"SPDR Bloomberg High Yield",       cls:"Fixed Income", grp:"Credit", liq:"B", dur:3.3,  tags:["credit","HY","spread"] },
  { t:"EMB", a:["em-debt"],  n:"iShares JPM USD EM Bond",         cls:"Fixed Income", grp:"Credit", liq:"C", dur:6.5,  tags:["EM","sovereign","credit","dollar"] },
  { t:"BKLN", a:["loans"], n:"Invesco Senior Loan",             cls:"Fixed Income", grp:"Credit", liq:"C", dur:0.3,  tags:["loans","floating","credit"] },
  { t:"MUB", a:["muni"],  n:"iShares National Muni",           cls:"Fixed Income", grp:"Credit", liq:"C", dur:6.2,  tags:["muni","tax"] },
  { t:"AGG", a:["core-bond"],  n:"iShares Core US Aggregate",       cls:"Fixed Income", grp:"Broad",  liq:"C", dur:6.1,  tags:["core-bond","aggregate"] },
  { t:"BND", a:["core-bond"],  n:"Vanguard Total Bond Market",      cls:"Fixed Income", grp:"Broad",  liq:"C", dur:6.0,  tags:["core-bond","aggregate"] },

  // ── Commodities & metals ─────────────────────────────────────────
  { t:"GLD", a:["gold"],  n:"SPDR Gold Shares",                cls:"Commodity", grp:"Metals",  liq:"A", tags:["gold","dollar","real-rates","debasement","haven"] },
  { t:"IAU", a:["gold"],  n:"iShares Gold Trust",              cls:"Commodity", grp:"Metals",  liq:"C", tags:["gold","cheap"] },
  { t:"SLV", a:["silver"],  n:"iShares Silver Trust",            cls:"Commodity", grp:"Metals",  liq:"A", tags:["silver","industrial","highbeta-gold"] },
  { t:"GDX", a:["gold", "miners"],  n:"VanEck Gold Miners",              cls:"Equity",    grp:"Metals",  liq:"A", tags:["gold","miners","equity-beta","operating-leverage"] },
  { t:"GDXJ", a:["gold", "miners"], n:"VanEck Junior Gold Miners",       cls:"Equity",    grp:"Metals",  liq:"B", tags:["gold","miners","highbeta"] },
  { t:"COPX", a:["copper"], n:"Global X Copper Miners",          cls:"Equity",    grp:"Metals",  liq:"C", tags:["copper","electrification","china"] },
  { t:"USO", a:["oil"],  n:"United States Oil Fund",          cls:"Commodity", grp:"Energy",  liq:"B", tags:["oil","wti","contango","roll-decay"] },
  { t:"UNG", a:["natgas"],  n:"United States Natural Gas",       cls:"Commodity", grp:"Energy",  liq:"B", tags:["natgas","weather","roll-decay"] },
  { t:"DBC", a:["commodity"],  n:"Invesco DB Commodity Index",      cls:"Commodity", grp:"Broad",   liq:"C", tags:["commodity","inflation","broad"] },
  { t:"URA", a:["uranium"],  n:"Global X Uranium",                cls:"Equity",    grp:"Energy",  liq:"C", tags:["uranium","nuclear","power"] },

  // ── International & FX ───────────────────────────────────────────
  { t:"EFA", a:["developed-intl"],  n:"iShares MSCI EAFE",               cls:"Equity", grp:"Intl", liq:"B", tags:["developed","intl","dollar"] },
  { t:"EEM", a:["em-equity"],  n:"iShares MSCI Emerging Markets",   cls:"Equity", grp:"Intl", liq:"A", tags:["EM","dollar","china","risk-appetite"] },
  { t:"VWO", a:["em-equity"],  n:"Vanguard FTSE Emerging Markets",  cls:"Equity", grp:"Intl", liq:"C", tags:["EM","cheap"] },
  { t:"FXI", a:["china"],  n:"iShares China Large-Cap",         cls:"Equity", grp:"Intl", liq:"A", tags:["china","policy","stimulus"] },
  { t:"KWEB", a:["china"], n:"KraneShares CSI China Internet",  cls:"Equity", grp:"Intl", liq:"B", tags:["china","internet","regulation"] },
  { t:"EWJ", a:["japan"],  n:"iShares MSCI Japan",              cls:"Equity", grp:"Intl", liq:"B", tags:["japan","boj","yen"] },
  { t:"EWZ", a:["brazil"],  n:"iShares MSCI Brazil",             cls:"Equity", grp:"Intl", liq:"B", tags:["brazil","commodity","EM"] },
  { t:"INDA", a:["india"], n:"iShares MSCI India",              cls:"Equity", grp:"Intl", liq:"C", tags:["india","EM","growth"] },
  { t:"UUP", a:["dollar"],  n:"Invesco DB US Dollar Bullish",    cls:"Currency", grp:"FX", liq:"C", tags:["dollar","dxy","macro"] },
  { t:"FXE", a:["euro"],  n:"Invesco CurrencyShares Euro",     cls:"Currency", grp:"FX", liq:"C", tags:["euro","ecb","dollar"] },
  { t:"FXY", a:["yen"],  n:"Invesco CurrencyShares Yen",      cls:"Currency", grp:"FX", liq:"C", tags:["yen","boj","carry"] },

  // ── Volatility & crypto ──────────────────────────────────────────
  { t:"VXX", a:["vix"],  n:"iPath Series B VIX Short-Term",   cls:"Volatility", grp:"Vol", liq:"A", tags:["vix","hedge","roll-decay","contango"] },
  { t:"UVXY", a:["vix"], n:"ProShares Ultra VIX Short-Term",  cls:"Volatility", grp:"Vol", liq:"A", lev:1.5, tags:["vix","levered","decay"] },
  { t:"SVXY", a:["vix"], n:"ProShares Short VIX Short-Term",  cls:"Volatility", grp:"Vol", liq:"B", lev:-0.5, tags:["vix","short-vol","carry"] },
  { t:"IBIT", a:["bitcoin", "crypto"], n:"iShares Bitcoin Trust",           cls:"Crypto", grp:"Crypto", liq:"A", tags:["bitcoin","liquidity","risk-appetite"] },
  { t:"ETHA", a:["ethereum", "crypto"], n:"iShares Ethereum Trust",          cls:"Crypto", grp:"Crypto", liq:"B", tags:["ethereum","crypto"] },

  // ── Levered (short-horizon only; feeds the rebalance engine) ──────
  { t:"TQQQ", a:["nasdaq"], n:"ProShares UltraPro QQQ",          cls:"Equity", grp:"Levered", liq:"A", lev:3,  ul:"QQQ", tags:["levered","nasdaq","decay","rebalance"] },
  { t:"SQQQ", a:["nasdaq"], n:"ProShares UltraPro Short QQQ",    cls:"Equity", grp:"Levered", liq:"A", lev:-3, ul:"QQQ", tags:["levered","inverse","nasdaq","rebalance"] },
  { t:"QLD", a:["nasdaq"],  n:"ProShares Ultra QQQ",             cls:"Equity", grp:"Levered", liq:"C", lev:2,  ul:"QQQ", tags:["levered","nasdaq","rebalance"] },
  { t:"UPRO", a:["sp500"], n:"ProShares UltraPro S&P 500",      cls:"Equity", grp:"Levered", liq:"B", lev:3,  ul:"SPY", tags:["levered","sp500","rebalance"] },
  { t:"SPXL", a:["sp500"], n:"Direxion Daily S&P 500 Bull 3X",  cls:"Equity", grp:"Levered", liq:"B", lev:3,  ul:"SPY", tags:["levered","sp500","rebalance"] },
  { t:"SPXS", a:["sp500"], n:"Direxion Daily S&P 500 Bear 3X",  cls:"Equity", grp:"Levered", liq:"B", lev:-3, ul:"SPY", tags:["levered","inverse","rebalance"] },
  { t:"SSO", a:["sp500"],  n:"ProShares Ultra S&P 500",         cls:"Equity", grp:"Levered", liq:"C", lev:2,  ul:"SPY", tags:["levered","sp500","rebalance"] },
  { t:"SDS", a:["sp500"],  n:"ProShares UltraShort S&P 500",    cls:"Equity", grp:"Levered", liq:"C", lev:-2, ul:"SPY", tags:["levered","inverse","rebalance"] },
  { t:"SH", a:["sp500"],   n:"ProShares Short S&P 500",         cls:"Equity", grp:"Levered", liq:"C", lev:-1, ul:"SPY", tags:["inverse","hedge","rebalance"] },
  { t:"SOXL", a:["semis"], n:"Direxion Daily Semis Bull 3X",    cls:"Equity", grp:"Levered", liq:"A", lev:3,  ul:"SMH", tags:["levered","semis","rebalance"] },
  { t:"SOXS", a:["semis"], n:"Direxion Daily Semis Bear 3X",    cls:"Equity", grp:"Levered", liq:"A", lev:-3, ul:"SMH", tags:["levered","inverse","semis","rebalance"] },
  { t:"TNA", a:["smallcap"],  n:"Direxion Daily Small Cap Bull 3X",cls:"Equity", grp:"Levered", liq:"B", lev:3,  ul:"IWM", tags:["levered","smallcap","rebalance"] },
  { t:"TZA", a:["smallcap"],  n:"Direxion Daily Small Cap Bear 3X",cls:"Equity", grp:"Levered", liq:"B", lev:-3, ul:"IWM", tags:["levered","inverse","rebalance"] },
  { t:"TECL", a:["tech"], n:"Direxion Daily Technology Bull 3X",cls:"Equity",grp:"Levered", liq:"C", lev:3,  ul:"XLK", tags:["levered","tech","rebalance"] },
  { t:"TMF", a:["longbond", "treasuries"],  n:"Direxion Daily 20+ Yr Trsy Bull 3X",cls:"Fixed Income",grp:"Levered",liq:"B",lev:3, ul:"TLT", tags:["levered","duration","rebalance"] },
  { t:"TMV", a:["longbond", "treasuries"],  n:"Direxion Daily 20+ Yr Trsy Bear 3X",cls:"Fixed Income",grp:"Levered",liq:"C",lev:-3,ul:"TLT", tags:["levered","inverse","duration","rebalance"] },
  { t:"UGL", a:["gold"],  n:"ProShares Ultra Gold",            cls:"Commodity", grp:"Levered", liq:"C", lev:2,  ul:"GLD", tags:["levered","gold","rebalance"] },
  { t:"NUGT", a:["gold", "miners"], n:"Direxion Daily Gold Miners 2X",   cls:"Equity",    grp:"Levered", liq:"B", lev:2,  ul:"GDX", tags:["levered","miners","rebalance"] },
  { t:"GLL", a:["gold"],  n:"ProShares UltraShort Gold",       cls:"Commodity", grp:"Levered", liq:"C", lev:-2, ul:"GLD", tags:["levered","inverse","gold","rebalance"] },
  { t:"ZSL", a:["silver"],  n:"ProShares UltraShort Silver",     cls:"Commodity", grp:"Levered", liq:"C", lev:-2, ul:"SLV", tags:["levered","inverse","silver","rebalance"] },
  { t:"DUST", a:["gold", "miners"], n:"Direxion Gold Miners Bear 2X",    cls:"Equity",    grp:"Levered", liq:"B", lev:-2, ul:"GDX", tags:["levered","inverse","gold","miners","rebalance"] },
  { t:"BITI", a:["bitcoin", "crypto"], n:"ProShares Short Bitcoin Strategy",cls:"Crypto",    grp:"Levered", liq:"C", lev:-1, ul:"IBIT", tags:["inverse","bitcoin","hedge"] },
  { t:"BITX", a:["bitcoin", "crypto"], n:"Volatility Shares 2x Bitcoin",    cls:"Crypto",    grp:"Levered", liq:"B", lev:2,  ul:"IBIT", tags:["levered","bitcoin","rebalance"] },
  { t:"SOXQ", a:["semis"], n:"Invesco PHLX Semiconductor",      cls:"Equity",    grp:"Sector",  liq:"C", tags:["semis","ai","cyclical"] },
  { t:"PSI", a:["semis"],  n:"Invesco Semiconductors",          cls:"Equity",    grp:"Sector",  liq:"C", tags:["semis","ai"] },
  { t:"IGV", a:["software"],  n:"iShares Expanded Tech-Software",  cls:"Equity",    grp:"Sector",  liq:"B", tags:["software","tech","growth"] },
  { t:"CIBR", a:["cyber"], n:"First Trust Nasdaq Cybersecurity",cls:"Equity",    grp:"Sector",  liq:"C", tags:["cyber","software","tech"] },
  { t:"BUG", a:["cyber"],  n:"Global X Cybersecurity",          cls:"Equity",    grp:"Sector",  liq:"C", tags:["cyber","software"] },
  { t:"AIQ", a:["ai"],  n:"Global X Artificial Intelligence",cls:"Equity",    grp:"Sector",  liq:"C", tags:["ai","tech","datacenter"] },
  { t:"IGF", a:["power"],  n:"iShares Global Infrastructure",   cls:"Equity",    grp:"Sector",  liq:"C", tags:["infrastructure","power"] },
  { t:"GRID", a:["power"], n:"First Trust Clean Edge Grid",     cls:"Equity",    grp:"Sector",  liq:"C", tags:["power","grid","datacenter","ai-power"] },
  { t:"SARK", a:["growth"], n:"AXS Short Innovation Daily",      cls:"Equity",    grp:"Levered", liq:"C", lev:-1, ul:"ARKK", tags:["inverse","growth","hedge"] },
];

export const BY_TICKER = Object.fromEntries(ETF_UNIVERSE.map(e => [e.t, e]));

/* Tag vocabulary handed to Claude so it maps a thesis onto terms that
   actually exist in the table rather than inventing its own. */
export const TAG_VOCAB = [...new Set(ETF_UNIVERSE.flatMap(e => e.tags))].sort();

/* Anchors are ASSET IDENTITIES — what a fund IS. Kept separate from tags,
   which are sensitivities — what a fund RESPONDS TO. GLD carries the tag
   "dollar" because it moves on the dollar, but its asset is gold; anchoring
   on sensitivities put GLD at the top of a US Dollar theme. */
export const ANCHOR_VOCAB = [...new Set(ETF_UNIVERSE.flatMap(e => e.a || []))].sort();

/* Retrieval: score every fund against a set of tags. Pure lookup — no
   model involvement, so a ticker that is not in the table cannot be
   returned.

   Asset class is a RANKING BOOST, never a filter. A debasement thesis
   tags gold, silver, bitcoin and longbond at once; filtering to a
   single class would silently drop the crypto and rates expressions of
   the same idea. Tag fit decides membership; class only breaks ties. */
export function searchUniverse(tags = [], { boostCls, excludeLevered = true, limit = 12, minHits = 1, anchor } = {}) {
  /* Anchor-first retrieval. Without this, a theme on silver pulls in gold
     funds via a shared driver tag like "debasement", and because gold is
     more liquid it then wins the primary slot — relevance losing to size.
     When an anchor is supplied, only funds carrying it are eligible. */
  if (anchor) {
    const anchored = ETF_UNIVERSE
      .filter(e => (!excludeLevered || e.grp !== "Levered") && (e.a || []).includes(anchor));
    if (anchored.length) {
      const want = new Set(tags.map(t => String(t).toLowerCase()));
      const LIQ = { A: 0.9, B: 0.5, C: 0.15, X: 0 };
      return anchored
        .map(e => ({ ...e, hits: e.tags.filter(t => want.has(t)),
                     score: e.tags.filter(t => want.has(t)).length + (LIQ[e.liq] ?? 0) }))
        .sort((a, b) => b.score - a.score || a.t.localeCompare(b.t))
        .slice(0, limit);
    }
  }
  const want = new Set(tags.map(s => String(s).toLowerCase()));
  const LIQ = { A: 0.9, B: 0.5, C: 0.15, X: 0 };
  return ETF_UNIVERSE
    .filter(e => !excludeLevered || e.grp !== "Levered")
    .map(e => {
      const hits = e.tags.filter(t => want.has(t));
      const score = hits.length
                  + (LIQ[e.liq] ?? 0)
                  + (boostCls && e.cls === boostCls ? 0.6 : 0);
      return { ...e, hits, score };
    })
    .filter(e => e.hits.length >= minHits)
    .sort((a, b) => b.score - a.score || a.t.localeCompare(b.t))
    .slice(0, limit);
}

/* Levered funds tracking a given underlying — feeds the rebalance
   estimator (gamma = X(X-1)). */
export function leveredFor(underlying, { direction } = {}) {
  let out = ETF_UNIVERSE.filter(e => e.ul === underlying);
  if (direction === "bearish") out = out.filter(e => (e.lev || 0) < 0);
  if (direction === "bullish") out = out.filter(e => (e.lev || 0) > 0);
  // gamma = X(X-1): the rebalance multiplier from the handbook
  return out.map(e => ({ ...e, gamma: e.lev ? e.lev * (e.lev - 1) : 0 }));
}
