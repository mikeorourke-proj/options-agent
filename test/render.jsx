import { renderToStaticMarkup } from "react-dom/server";
import NoteView from "../src/note/NoteView.jsx";

/* ═══════════════════════════════════════════════════════════════════
   render.jsx — renders the NOTE and checks what a client actually sees.

   Nothing else in the suite renders JSX, so nothing else can catch a
   mis-numbered exhibit, a fund that was selected and not printed, or a
   word that should never reach the page.

   0.39.0: the note is one flow — prose in two columns, exhibits beneath —
   on ONE page when it fits and TWO when it does not. Both layouts are
   rendered here. A theme may carry several funds, each printed on its own
   row. Vehicle Screening, Structure Notes and Option Leg Detail are gone.
   ═══════════════════════════════════════════════════════════════════ */
const env = (o = {}) => ({ rangeBasis: "implied", rangeLo: 92, rangeHi: 108, rangePct: 8.1, putWallDistPct: -10, callWallDistPct: 4,
  iv30: 30, rv30: 25, ivOverRv: 1.2, avgDailyMovePct: 1.4, closeLo: 88, closeHi: 112, rangePosition: 50, ma50: 99, vsMa50Pct: 1, ...o });
const wall = { side: "call", role: "resistance", rel: "higher", level: 104, distancePct: 4, proximity: "nearby" };
const leg = (tk, chain = true) => chain
  ? { tk, price: 100, liq: "A", vol: { iv30: 30, rv30: 25, rr25: -2, putWall: 90, callWall: 104 }, wall, env: env() }
  : { tk, price: 50, liq: "X", vol: { iv30: null, rv30: 12, putWall: null, callWall: null }, wall: { none: true },
      env: env({ rangeBasis: "realised", iv30: null, putWallDistPct: null, callWallDistPct: null }) };
const theme = (id, tks, withOpt, lev) => {
  const legs = tks.map(([tk, chain]) => leg(tk, chain));
  return { id, subject: `Subject ${id.toUpperCase()}`, direction: "bearish", basis: "stated", legs,
    wall: legs[0].wall, env: legs[0].env, vol: legs[0].vol,
    etf: { tk: legs[0].tk, price: 100, plan: {}, tgt: {}, share: {} },
    levered: lev ? [{ tk: "GLL", lev: -2, gamma: 6 }] : [], leveredCarried: [], alternatives: [],
    options: withOpt ? [{ id: "put_spread", name: "Put spread", expiry: "2026-10-30", legText: "+1 95P / -1 90P",
      why: "Baseline.", pricing: { net: 625, maxGain: 875, maxLoss: -625, maxLossFull: -625, lossUnbounded: false, gainUnbounded: false,
        uncapped: false, breakevens: [93.75], priceSource: "last trade", legDetail: [] }, econ: { pop: 65 } }] : [] };
};
const note = (withOpt, lev) => {
  /* Theme A carries TWO funds, one with a chain and one without — the HYG
     and JNK case from 5 Oct, where the second tick was silently dropped. */
  const themes = [theme("a", [["HYG", true], ["JNK", false]], withOpt, lev), theme("b", [["SLV", true]], withOpt, lev)];
  return { meta: { title: "T", subtitle: "", date: "d", sector: "", subjects: ["A", "B"], direction: "BEARISH",
      analyst: { name: "A", title: "B", email: "c", phone: "d" } }, themes, correlation: null, weakLegs: [],
    etfOrder: themes.map(t => ({ themeId: t.id, label: t.etf.tk })),
    optOrder: withOpt ? themes.map(t => ({ themeId: t.id, structId: "put_spread" })) : [],
    risks: ["A risk."], prose: { summary: "s", themes: {}, execution: "" } };
};

const EXPECT = {
  "options + levered":       ["Positioning Map", "ETF Expression", "Derivatives Expression", "Levered and Inverse Funds"],
  "shares only, levered":    ["Positioning Map", "ETF Expression", "Levered and Inverse Funds"],
  "shares only, no levered": ["Positioning Map", "ETF Expression"],
};
let bad = 0;
for (const layout of ["one", "two"])
for (const [label, o, l] of [["options + levered", true, true], ["shares only, levered", false, true], ["shares only, no levered", false, false]]) {
  const html = renderToStaticMarkup(<NoteView note={note(o, l)} layout={layout} />);
  const text = html.replace(/<[^>]+>/g, " ");
  const got = [...html.matchAll(/Exhibit (\d+): ([^<]+)/g)].map(m => [Number(m[1]), m[2].split(" — ")[0]]);
  const want = EXPECT[label];
  const pages = (html.match(/class="page[ "]/g) || []).length;
  const fails = [];
  const need = (name, okv) => { if (!okv) fails.push(name); };

  need("exhibit numbers", got.every(([n], i) => n === i + 1));
  need("exhibit names", got.length === want.length && got.every(([, name], i) => name === want[i]));
  /* The layout is the point of 0.39.0: one content page plus disclosures,
     or two plus disclosures — and the exhibits on the right one. */
  need(`page count ${pages}`, pages === (layout === "one" ? 2 : 3));
  need("footer on every page", (html.match(/not a research report<\/i>/g) || []).length === pages);
  need("legend points at the disclosures page", text.includes(`Important Disclosures on page ${pages}`));
  need("two-column prose", /class="prose2"/.test(html));
  /* Every fund the analyst ticked is printed, each on its own row. */
  for (const tk of ["HYG", "JNK", "SLV"]) need(`${tk} row`, html.includes(`<b>${tk}</b>`));
  need("no-chain fund marked", text.includes("†"));
  /* One spot marker per fund that has two-sided walls: HYG and SLV, not JNK. */
  need("map rows", (html.match(/class="spot"/g) || []).length === 2);
  need("max loss beside max gain", !o || (/>Max loss</.test(html) && />Max gain</.test(html)));
  need("long-form expiry", !o || text.includes("October 30th"));
  need("masthead", /Market Commentary/.test(text) && /For Institutional Investors Only/.test(text));
  need("appendix", /Market Commentary:/.test(text) && /Conflicts:/.test(text) && /theocc\.com/.test(text));

  /* THE ABSENCES. What keeps the note commentary is as much what it leaves
     off the page as what it says. */
  const banned = [/\bPOP\b/, /[Pp]robability of profit/, /\b[Tt]arget/, /[Rr]ecommended/, /Desk Commentary/,
    /Institutional Tactical Note/, /Stop[- ]loss/i, /Stop out/i, /Scale[- ]in/i, /Scale band/i, /Execute /, /\bHold /,
    /Execution strategy/i, /Execution Mode/i, /Option Leg Detail/, /Vehicle Screening/, /Structure Notes/,
    /Alternatives considered/, /weighted average/i, /class="rung"/, /class="avg"/].filter(re => re.test(html)).map(String);
  if (banned.length) fails.push(`printed ${banned.join(", ")}`);

  if (fails.length) bad++;
  console.log(`${fails.length ? "FAIL" : "ok  "} ${layout}-page · ${label}: ${got.map(([n, x]) => `${n}.${x}`).join(" | ")}${fails.length ? "\n       " + fails.join("; ") : ""}`);
}
if (bad) { console.log(`\n${bad} render check(s) failed`); process.exit(1); }
console.log("render checks passed");
