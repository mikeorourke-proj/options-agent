import { renderToStaticMarkup } from "react-dom/server";
import NoteView from "../src/note/NoteView.jsx";

const theme = (id, tk, withOpt, lev) => ({
  id, subject: tk, direction: "bearish", basis: "stated",
  etf: { tk, plan: { execution: "scaled", spot: 100, entry: 102, stop: 105, riskPct: 3, rungs: [{ px: 100, w: 1 }], wall: 104 },
         tgt: { dn: 90, up: 110 }, share: { riskPct: 5, expectancy: 3 } },
  vol: { iv30: 30, rr25: -2, termSlope: 1, putWall: 90, callWall: 104 },
  screening: { considered: [], whyNot: "" }, levered: lev ? [{ tk: "GLL", lev: -2, gamma: 6 }] : [],
  leveredCarried: [], alternatives: [], liq: "A", contracts: 500,
  options: withOpt ? [{ id: "put_spread", name: "Put spread", expiry: "2026-10-30", legText: "+1 95P / -1 90P",
    why: "Baseline.", pricing: { net: 625, maxGain: 875, uncapped: false, breakevens: [93.75], priceSource: "last trade",
      legDetail: [{ action: "Buy", qty: 1, strike: 95, type: "put", mark: 5, moneyness: 0, delta: -0.5, oi: 100 }] },
    econ: { pop: 65 } }] : [],
});
const note = (withOpt, lev) => {
  const themes = [theme("a", "GLD", withOpt, lev), theme("b", "SLV", withOpt, lev)];
  return { meta: { title: "T", subtitle: "", date: "d", executeWindow: "", holdWindow: "", sector: "", subjects: ["GLD","SLV"], direction: "BEARISH", analyst: { name: "A", title: "B", email: "c", phone: "d" } }, themes, correlation: null, weakLegs: [],
    etfOrder: themes.map(t => ({ themeId: t.id, label: t.etf.tk })),
    optOrder: withOpt ? themes.map(t => ({ themeId: t.id, structId: "put_spread" })) : [],
    risks: [], prose: { summary: "s", themes: {}, execution: "" } };
};
/* ═══════════════════════════════════════════════════════════════════
   render.jsx — renders the NOTE and checks what a client actually sees.

   Exhibit numbering became LOGIC in v0.36.0: the derivatives exhibits exist
   only when an option is carried, and they now sit in the middle of page 2,
   so numbers are assigned by what renders. Fixed numbers would have printed
   a shares-only note as Exhibits 1, 2, 5, 6. Nothing else in the suite
   renders JSX, so nothing else could catch that.
   ═══════════════════════════════════════════════════════════════════ */
const EXPECT = {
  "options + levered":       ["Positioning Map", "ETF Expression", "Derivatives Expression", "Structure Notes",
                              "Vehicle Screening", "Levered and Inverse Alternatives", "Option Leg Detail"],
  "shares only, levered":    ["Positioning Map", "ETF Expression", "Vehicle Screening", "Levered and Inverse Alternatives"],
  "shares only, no levered": ["Positioning Map", "ETF Expression", "Vehicle Screening"],
};
let bad = 0;
for (const [label, o, l] of [["options + levered", true, true], ["shares only, levered", false, true], ["shares only, no levered", false, false]]) {
  const html = renderToStaticMarkup(<NoteView note={note(o, l)} />);
  const got = [...html.matchAll(/Exhibit (\d+): ([^<]+)/g)].map(m => [Number(m[1]), m[2].split(" \u2014 ")[0]]);
  const want = EXPECT[label];
  const numbersOk = got.every(([n], i) => n === i + 1);
  const namesOk = got.length === want.length && got.every(([, name], i) => name === want[i]);
  const railDate = o ? html.includes("Put spread \u00b7 October 30th") : true;
  /* Every map row gets its own spot marker, and centred columns get centred
     headers — both visual defects that no data-level test can see. */
  const spots = (html.match(/class="spot"/g) || []).length === 2;
  const heads = !o || html.includes('<th class="c">Expiry</th>');
  const ok = numbersOk && namesOk && railDate && spots && heads;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got.map(([n, x]) => `${n}.${x}`).join(" | ")}${o && !railDate ? "  [rail expiry not long-form]" : ""}${!spots ? "  [spot marker missing]" : ""}${!heads ? "  [headers not aligned]" : ""}`);
}
if (bad) { console.log(`\n${bad} render check(s) failed`); process.exit(1); }
console.log("render checks passed");
